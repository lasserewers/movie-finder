import os
import re
import time
from datetime import datetime, timezone
from html import unescape
from typing import Any
from urllib.parse import quote

import httpx

OMDB_URL = "https://www.omdbapi.com/"
LETTERBOXD_API_BASE = "https://api.letterboxd.com/api/v0"
LETTERBOXD_BASE_URL = "https://letterboxd.com"
ROTTEN_BASE_URL = "https://www.rottentomatoes.com"
METACRITIC_BASE_URL = "https://www.metacritic.com"
IMDB_BASE_URL = "https://www.imdb.com/title"
SCORES_TTL_SECONDS = 12 * 60 * 60

_cache: dict[tuple[str, int, str], tuple[float, dict]] = {}
_client: httpx.AsyncClient | None = None


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "")
    if raw is None or raw == "":
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _blank_scores() -> dict:
    return {
        "letterboxd": {"display": None, "url": None, "source": None},
        "imdb": {"display": None, "url": None, "source": None},
        "rotten_tomatoes_critics": {"display": None, "url": None, "source": None},
        "rotten_tomatoes_audience": {"display": None, "url": None, "source": None},
        "metacritic": {"display": None, "url": None, "source": None},
        "metacritic_audience": {"display": None, "url": None, "source": None},
    }


def _has_legacy_rotten_fallback(scores: dict | None) -> bool:
    if not isinstance(scores, dict):
        return False
    critics_source = str((scores.get("rotten_tomatoes_critics") or {}).get("source") or "").strip().lower()
    audience_source = str((scores.get("rotten_tomatoes_audience") or {}).get("source") or "").strip().lower()
    # Older builds could cache Rotten values from OMDb fallback.
    return critics_source == "omdb" or audience_source == "omdb"


def _extract_year(value: str | None) -> int | None:
    if not value:
        return None
    head = value.strip()[:4]
    return int(head) if head.isdigit() else None


def _parse_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        text = str(value).strip()
        if not text or text.upper() == "N/A":
            return None
        return float(text)
    except Exception:
        return None


def _parse_int(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.upper() == "N/A":
        return None
    digits = "".join(ch for ch in text if ch.isdigit())
    if not digits:
        return None
    try:
        return int(digits)
    except Exception:
        return None


def _parse_percent(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.upper() == "N/A":
        return None
    if text.endswith("%"):
        text = text[:-1]
    try:
        return int(float(text))
    except Exception:
        return None


def _omdb_api_keys() -> list[str]:
    keys: list[str] = []
    explicit_key = os.environ.get("OMDB_API_KEY", "").strip()
    if explicit_key:
        keys.append(explicit_key)

    # Public dev fallback key. Set OMDB_API_KEY in production.
    fallback_key = os.environ.get("OMDB_FALLBACK_API_KEY", "trilogy").strip()
    if fallback_key and fallback_key not in keys:
        keys.append(fallback_key)
    return keys


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=8,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (X11; Linux x86_64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"
                )
            },
        )
    return _client


async def close_client() -> None:
    global _client
    if _client:
        await _client.aclose()
        _client = None


async def _fetch_omdb(
    *,
    imdb_id: str | None,
    title: str | None,
    year: int | None,
) -> dict | None:
    keys = _omdb_api_keys()
    if not keys:
        return None
    if not imdb_id and not title:
        return None

    base_params: dict[str, str] = {"r": "json"}
    if imdb_id:
        base_params["i"] = imdb_id
    else:
        base_params["t"] = str(title or "").strip()
        if year:
            base_params["y"] = str(year)

    client = await _get_client()
    for api_key in keys:
        params = dict(base_params)
        params["apikey"] = api_key
        try:
            resp = await client.get(OMDB_URL, params=params)
        except Exception:
            continue
        if resp.status_code != 200:
            continue
        try:
            data = resp.json()
        except Exception:
            continue
        if str(data.get("Response", "")).lower() == "true":
            return data
    return None


async def _fetch_imdb_rating(imdb_id: str | None) -> float | None:
    if not imdb_id:
        return None
    client = await _get_client()
    url = f"{IMDB_BASE_URL}/{imdb_id}/"
    try:
        resp = await client.get(
            url,
            follow_redirects=True,
            headers={"Accept-Language": "en-US,en;q=0.9"},
        )
    except Exception:
        return None
    if resp.status_code != 200:
        return None
    html = resp.text

    patterns = (
        r'"aggregateRating"\s*:\s*\{[^{}]*"ratingValue"\s*:\s*"?(?P<score>\d+(?:\.\d+)?)"?',
        r'hero-rating-bar__aggregate-rating__score[^>]*>\s*<span[^>]*>(?P<score>\d+(?:\.\d+)?)<',
    )
    for pattern in patterns:
        match = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
        if not match:
            continue
        parsed = _parse_float(match.group("score"))
        if parsed is not None and 0.0 <= parsed <= 10.0:
            return round(parsed, 1)
    return None


def _build_metacritic_search_url(title: str | None) -> str | None:
    if not title:
        return None
    query = quote(title.strip(), safe="")
    if not query:
        return None
    return f"{METACRITIC_BASE_URL}/search/{query}/"


def _build_rotten_search_url(title: str | None) -> str | None:
    if not title:
        return None
    query = quote(title.strip(), safe="")
    if not query:
        return None
    return f"{ROTTEN_BASE_URL}/search?search={query}"


def _normalize_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _slugify_title(value: str | None) -> str:
    if not value:
        return ""
    text = unescape(value).lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text


def _safe_percent(value: int | None) -> int | None:
    if value is None:
        return None
    if value < 0 or value > 100:
        return None
    return value


def _extract_attr(attrs: str, name: str) -> str | None:
    match = re.search(rf'{name}\s*=\s*"([^"]*)"', attrs, flags=re.IGNORECASE)
    if not match:
        return None
    text = (match.group(1) or "").strip()
    return text or None


def _extract_title_year_from_row(attrs: str) -> int | None:
    for name in ("release-year", "releaseyear", "start-year", "startyear"):
        value = _extract_attr(attrs, name)
        if value and value.isdigit():
            return int(value)
    return None


def _strip_html(value: str) -> str:
    return re.sub(r"<[^>]+>", "", value)


def _extract_rt_scores_from_html(html: str) -> tuple[int | None, int | None]:
    patterns_critics = (
        r'"criticsScore"\s*:\s*\{[^{}]*?"score"\s*:\s*"(\d{1,3})"',
        r'"criticsAll"\s*:\s*\{[^{}]*?"score"\s*:\s*"(\d{1,3})"',
        r'"criticsScore"\s*:\s*\{[^{}]*?"scorePercent"\s*:\s*"(\d{1,3})%"',
        r'"criticsAll"\s*:\s*\{[^{}]*?"scorePercent"\s*:\s*"(\d{1,3})%"',
    )
    patterns_audience = (
        r'"audienceScore"\s*:\s*\{[^{}]*?"score"\s*:\s*"(\d{1,3})"',
        r'"audienceAll"\s*:\s*\{[^{}]*?"score"\s*:\s*"(\d{1,3})"',
        r'"audienceScore"\s*:\s*\{[^{}]*?"scorePercent"\s*:\s*"(\d{1,3})%"',
        r'"audienceAll"\s*:\s*\{[^{}]*?"scorePercent"\s*:\s*"(\d{1,3})%"',
    )

    critics: int | None = None
    audience: int | None = None
    for pattern in patterns_critics:
        match = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
        if match:
            critics = _safe_percent(_parse_int(match.group(1)))
            if critics is not None:
                break
    for pattern in patterns_audience:
        match = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
        if match:
            audience = _safe_percent(_parse_int(match.group(1)))
            if audience is not None:
                break
    return critics, audience


async def _search_rotten_url(
    *,
    title: str | None,
    media_type: str,
    year: int | None,
) -> str | None:
    search_url = _build_rotten_search_url(title)
    if not search_url or not title:
        return None
    client = await _get_client()
    try:
        resp = await client.get(search_url)
    except Exception:
        return None
    if resp.status_code != 200:
        return None
    html = resp.text

    row_pattern = re.compile(
        r"<search-page-media-row(?P<attrs>[^>]*)>(?P<body>.*?)</search-page-media-row>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    link_pattern = re.compile(
        r'href="https://www\.rottentomatoes\.com(?P<path>/(?:m|tv)/[^"#?]+)"[^>]*'
        r'data-qa="info-name"[^>]*>(?P<title>.*?)</a>',
        flags=re.IGNORECASE | re.DOTALL,
    )
    target_prefix = "/tv/" if media_type == "tv" else "/m/"
    wanted = _normalize_title(title)
    if not wanted:
        return None
    best_url: str | None = None
    best_score = -10_000
    for row_match in row_pattern.finditer(html):
        attrs = row_match.group("attrs") or ""
        body = row_match.group("body") or ""
        link_match = link_pattern.search(body)
        if not link_match:
            continue
        path = link_match.group("path") or ""
        if not path.startswith(target_prefix):
            continue
        row_title_raw = _strip_html(unescape(link_match.group("title") or "")).strip()
        row_title_norm = _normalize_title(row_title_raw)
        if not row_title_norm:
            continue

        is_exact = row_title_norm == wanted
        is_prefix_match = row_title_norm.startswith(wanted) or wanted.startswith(row_title_norm)
        if not is_exact and not is_prefix_match:
            continue

        score = 0
        if is_exact:
            score += 200
        elif is_prefix_match:
            score += 120

        row_year = _extract_title_year_from_row(attrs)
        if year and row_year:
            diff = abs(row_year - year)
            if diff == 0:
                score += 30
            elif diff == 1:
                score += 20
            elif diff == 2:
                score += 10
            else:
                score -= 25
        elif year and not is_exact:
            # Prefix matches without a year are too risky.
            continue

        if score > best_score:
            best_score = score
            best_url = f"{ROTTEN_BASE_URL}{path}"
    if best_score < 120:
        return None
    return best_url


async def _resolve_rotten_url(
    *,
    omdb_data: dict | None,
    title: str | None,
    media_type: str,
    year: int | None,
) -> str | None:
    tomato_url = str((omdb_data or {}).get("tomatoURL") or "").strip()
    if tomato_url and tomato_url.upper() != "N/A":
        if tomato_url.startswith("http://") or tomato_url.startswith("https://"):
            return tomato_url
        if tomato_url.startswith("/"):
            return f"{ROTTEN_BASE_URL}{tomato_url}"
    return await _search_rotten_url(title=title, media_type=media_type, year=year)


async def _fetch_rotten_scores(rotten_url: str) -> tuple[int | None, int | None]:
    client = await _get_client()
    try:
        resp = await client.get(rotten_url)
    except Exception:
        return None, None
    if resp.status_code != 200:
        return None, None
    return _extract_rt_scores_from_html(resp.text)


def _extract_metacritic_score_from_html(html: str) -> int | None:
    label_patterns = (
        r'aria-label="Metascore\s+(?P<value>TBD|\d{1,3})(?:\s+out of 100)?"',
        r'title="Metascore\s+(?P<value>TBD|\d{1,3})(?:\s+out of 100)?"',
    )
    for pattern in label_patterns:
        for match in re.finditer(pattern, html, flags=re.IGNORECASE):
            value = str(match.group("value") or "").strip()
            if value.lower() == "tbd":
                return None
            parsed = _parse_int(value)
            if parsed is not None and 0 <= parsed <= 100:
                return parsed

    # Schema.org fallback
    for match in re.finditer(r'"ratingValue"\s*:\s*"?(?P<score>\d{2,3})(?:\.\d+)?"?', html, flags=re.IGNORECASE):
        parsed = _parse_int(match.group("score"))
        if parsed is not None and 0 <= parsed <= 100:
            return parsed
    return None


def _extract_metacritic_user_score_from_html(html: str) -> float | None:
    label_patterns = (
        r'aria-label="User score\s+(?P<value>TBD|\d+(?:\.\d+)?)(?:\s+out of 10)?"',
        r'title="User score\s+(?P<value>TBD|\d+(?:\.\d+)?)(?:\s+out of 10)?"',
    )
    for pattern in label_patterns:
        for match in re.finditer(pattern, html, flags=re.IGNORECASE):
            value = str(match.group("value") or "").strip()
            if value.lower() == "tbd":
                return None
            parsed = _parse_float(value)
            if parsed is not None and 0.0 <= parsed <= 10.0:
                return round(parsed, 1)

    for match in re.finditer(r"User score\s+(?P<score>\d+(?:\.\d+)?)\s+out of 10", html, flags=re.IGNORECASE):
        parsed = _parse_float(match.group("score"))
        if parsed is not None and 0.0 <= parsed <= 10.0:
            return round(parsed, 1)
    return None


def _extract_metacritic_year_from_html(html: str) -> int | None:
    patterns = (
        r'"datePublished"\s*:\s*"(?P<year>\d{4})',
        r'"dateCreated"\s*:\s*"(?P<year>\d{4})',
        r'"releaseDate"\s*:\s*"(?P<year>\d{4})',
    )
    for pattern in patterns:
        match = re.search(pattern, html, flags=re.IGNORECASE)
        if not match:
            continue
        parsed = _parse_int(match.group("year"))
        if parsed is not None and 1870 <= parsed <= 2100:
            return parsed
    return None


def _score_metacritic_year(candidate_year: int | None, target_year: int | None) -> int:
    if target_year is None or candidate_year is None:
        return 0
    diff = abs(candidate_year - target_year)
    if diff == 0:
        return 420
    if diff == 1:
        return 280
    if diff == 2:
        return -120
    if diff == 3:
        return -350
    return -650


def _is_metacritic_year_acceptable(candidate_year: int | None, target_year: int | None) -> bool:
    if target_year is None:
        return True
    if candidate_year is None:
        return False
    # Tight guard for same-title collisions: if we're off by >1 year, treat as mismatch.
    return abs(candidate_year - target_year) <= 1


def _metacritic_kind(media_type: str) -> str:
    return "tv" if media_type == "tv" else "movie"


def _build_metacritic_direct_url(title: str | None, media_type: str) -> str | None:
    slug = _slugify_title(title)
    if not slug:
        return None
    return f"{METACRITIC_BASE_URL}/{_metacritic_kind(media_type)}/{slug}/"


def _extract_metacritic_candidate_paths(html: str, media_type: str) -> list[str]:
    kind = _metacritic_kind(media_type)
    paths = re.findall(rf"/{kind}/[a-z0-9-]+/", html, flags=re.IGNORECASE)
    if not paths:
        return []
    skip_slugs = {
        "all",
        "netflix",
        "hulu",
        "max",
        "prime-video",
        "paramount-plus",
        "disney-plus",
        "apple-tv-plus",
        "current-year",
        "upcoming",
        "best",
        "worst",
    }
    unique: list[str] = []
    seen: set[str] = set()
    for path in paths:
        canonical = path.lower()
        slug = canonical.strip("/").split("/")[-1]
        if slug in skip_slugs:
            continue
        if canonical in seen:
            continue
        seen.add(canonical)
        unique.append(canonical)
    return unique


def _score_metacritic_slug(candidate_slug: str, wanted_slug: str) -> int:
    if not candidate_slug or not wanted_slug:
        return -10_000
    if candidate_slug == wanted_slug:
        return 1_000

    score = 0
    if candidate_slug.startswith(wanted_slug) or wanted_slug.startswith(candidate_slug):
        score += 260

    wanted_tokens = [token for token in wanted_slug.split("-") if len(token) >= 3]
    candidate_tokens = [token for token in candidate_slug.split("-") if len(token) >= 3]
    if wanted_tokens and candidate_tokens:
        overlap = len(set(wanted_tokens).intersection(candidate_tokens))
        score += overlap * 70
        score -= abs(len(candidate_tokens) - len(wanted_tokens)) * 18

    return score


async def _fetch_metacritic_url_and_scores(
    url: str,
) -> tuple[str | None, int | None, float | None, int | None]:
    client = await _get_client()
    try:
        resp = await client.get(url, follow_redirects=True)
    except Exception:
        return None, None, None, None
    if resp.status_code != 200:
        return None, None, None, None
    resolved_url = str(resp.url)
    if not resolved_url.startswith(METACRITIC_BASE_URL):
        return None, None, None, None
    critic_score = _extract_metacritic_score_from_html(resp.text)
    audience_score = _extract_metacritic_user_score_from_html(resp.text)
    published_year = _extract_metacritic_year_from_html(resp.text)
    if not resolved_url.endswith("/"):
        resolved_url = f"{resolved_url}/"
    return resolved_url, critic_score, audience_score, published_year


async def _resolve_metacritic_url_and_score(
    *,
    title: str | None,
    media_type: str,
    year: int | None,
) -> tuple[str | None, int | None, float | None]:
    direct_fallback: tuple[str | None, int | None, float | None] = (None, None, None)
    direct_url = _build_metacritic_direct_url(title, media_type)
    if direct_url:
        resolved_url, critic_score, audience_score, published_year = await _fetch_metacritic_url_and_scores(
            direct_url
        )
        if resolved_url and (critic_score is not None or audience_score is not None):
            if _is_metacritic_year_acceptable(published_year, year):
                return resolved_url, critic_score, audience_score
            if year is None:
                direct_fallback = (resolved_url, critic_score, audience_score)

    search_url = _build_metacritic_search_url(title)
    if not search_url:
        return None, None, None
    client = await _get_client()
    try:
        resp = await client.get(search_url)
    except Exception:
        return None, None, None
    if resp.status_code != 200:
        return None, None, None

    candidates = _extract_metacritic_candidate_paths(resp.text, media_type)
    wanted_slug = _slugify_title(title)
    best_path: str | None = None
    best_score = -10_000
    for candidate in candidates:
        candidate_slug = candidate.strip("/").split("/")[-1]
        score = _score_metacritic_slug(candidate_slug, wanted_slug)
        if score > best_score:
            best_score = score
            best_path = candidate

    if best_path and best_score >= 250:
        ordered_candidates: list[tuple[int, str]] = []
        for candidate in candidates:
            candidate_slug = candidate.strip("/").split("/")[-1]
            score = _score_metacritic_slug(candidate_slug, wanted_slug)
            if score >= 250:
                ordered_candidates.append((score, candidate))
        ordered_candidates.sort(key=lambda item: item[0], reverse=True)

        best_resolved: tuple[str | None, int | None, float | None] = (None, None, None)
        best_total = -10_000
        for slug_score, candidate in ordered_candidates[:6]:
            resolved_url, critic_score, audience_score, published_year = await _fetch_metacritic_url_and_scores(
                f"{METACRITIC_BASE_URL}{candidate}"
            )
            if not resolved_url or (critic_score is None and audience_score is None):
                continue
            if not _is_metacritic_year_acceptable(published_year, year):
                continue
            total = slug_score + _score_metacritic_year(published_year, year)
            if total > best_total:
                best_total = total
                best_resolved = (resolved_url, critic_score, audience_score)
        if best_resolved[0] and best_total >= 250:
            return best_resolved

    if direct_fallback[0]:
        return direct_fallback
    return None, None, None


def _deep_find_first_number(payload: Any, keys: tuple[str, ...]) -> float | None:
    if isinstance(payload, dict):
        for key in keys:
            if key in payload:
                value = payload.get(key)
                parsed = _parse_float(value)
                if parsed is not None:
                    return parsed
        for value in payload.values():
            found = _deep_find_first_number(value, keys)
            if found is not None:
                return found
    elif isinstance(payload, list):
        for item in payload:
            found = _deep_find_first_number(item, keys)
            if found is not None:
                return found
    return None


async def _fetch_letterboxd_score(imdb_id: str | None) -> float | None:
    token = os.environ.get("LETTERBOXD_BEARER_TOKEN", "").strip()
    if not token or not imdb_id:
        return None
    client = await _get_client()
    try:
        resp = await client.get(
            f"{LETTERBOXD_API_BASE}/film/imdb:{imdb_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    except Exception:
        return None
    if resp.status_code != 200:
        return None
    try:
        payload = resp.json()
    except Exception:
        return None

    value = _deep_find_first_number(
        payload,
        (
            "averageRating",
            "average_rating",
            "ratingAverage",
            "rating_average",
            "rating",
            "value",
        ),
    )
    if value is None:
        return None
    if value > 5.0:
        value = value / 2.0
    return max(0.0, min(5.0, round(value, 1)))


def _extract_letterboxd_rating_from_html(html: str) -> float | None:
    match = re.search(
        r'"aggregateRating"\s*:\s*\{[^{}]*?"ratingValue"\s*:\s*(?P<score>\d+(?:\.\d+)?)',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return None
    parsed = _parse_float(match.group("score"))
    if parsed is None or parsed < 0.0 or parsed > 5.0:
        return None
    return round(parsed, 1)


def _extract_letterboxd_imdb_id_from_html(html: str) -> str | None:
    match = re.search(r"imdb\.com/title/(?P<imdb>tt\d+)/", html, flags=re.IGNORECASE)
    if not match:
        return None
    imdb_id = str(match.group("imdb") or "").strip().lower()
    return imdb_id or None


def _build_letterboxd_slug_candidates(title: str | None, year: int | None) -> list[str]:
    slug = _slugify_title(title)
    if not slug:
        return []
    candidates: list[str] = []
    seen: set[str] = set()

    def add(value: str) -> None:
        if not value or value in seen:
            return
        seen.add(value)
        candidates.append(value)

    if year is not None:
        current_year = datetime.now(timezone.utc).year
        for offset in (0, 1, -1):
            candidate_year = year + offset
            if 1888 <= candidate_year <= current_year + 2:
                add(f"{slug}-{candidate_year}")
    add(slug)
    return candidates


async def _fetch_letterboxd_page_score(
    *,
    title: str | None,
    year: int | None,
    imdb_id: str | None,
) -> tuple[float | None, str | None]:
    client = await _get_client()
    imdb_norm = str(imdb_id or "").strip().lower() or None
    for candidate in _build_letterboxd_slug_candidates(title, year):
        url = f"{LETTERBOXD_BASE_URL}/film/{candidate}/"
        try:
            resp = await client.get(
                url,
                follow_redirects=True,
                headers={"Accept-Language": "en-US,en;q=0.9"},
            )
        except Exception:
            continue
        if resp.status_code != 200:
            continue
        resolved_url = str(resp.url)
        if not resolved_url.startswith(f"{LETTERBOXD_BASE_URL}/film/"):
            continue
        html = resp.text
        page_imdb = _extract_letterboxd_imdb_id_from_html(html)
        if imdb_norm and page_imdb != imdb_norm:
            continue
        rating = _extract_letterboxd_rating_from_html(html)
        if not resolved_url.endswith("/"):
            resolved_url = f"{resolved_url}/"
        return rating, resolved_url
    return None, None


def _letterboxd_page_fetch_enabled() -> bool:
    # Disabled by default for compliance. Enable only if you have explicit permission.
    return _env_bool("LETTERBOXD_ENABLE_PAGE_SCRAPE", default=False)


def _scraped_ratings_enabled() -> bool:
    # Disabled by default for compliance. Enable only if you have explicit permission.
    return _env_bool("ENABLE_SCRAPED_RATINGS", default=False)


def _estimate_letterboxd_score(media_type: str, details: dict) -> float | None:
    enable_estimate = os.environ.get("LETTERBOXD_ENABLE_TMDB_ESTIMATE", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if not enable_estimate:
        return None
    if media_type != "movie":
        return None

    vote_average = _parse_float(details.get("vote_average"))
    vote_count = _parse_int(details.get("vote_count"))
    runtime = _parse_int(details.get("runtime"))
    release_year = _extract_year(str(details.get("release_date") or ""))
    current_year = datetime.now(timezone.utc).year
    if vote_average is None or vote_average <= 0:
        return None
    if vote_count is None or vote_count < 2500:
        return None
    if runtime is not None and runtime < 40:
        return None
    if release_year is not None and (release_year < 1888 or release_year > current_year):
        return None
    return max(0.0, min(5.0, round(vote_average / 2.0, 1)))


def _build_letterboxd_search_url(title: str | None) -> str | None:
    if not title:
        return None
    query = quote(title.strip(), safe="")
    if not query:
        return None
    return f"{LETTERBOXD_BASE_URL}/search/{query}/"


async def get_media_scores(media_type: str, details: dict) -> dict:
    tmdb_id = int(details.get("id") or 0)
    imdb_id = str(details.get("imdb_id") or "").strip() or None
    title = str(details.get("title") or details.get("name") or "").strip() or None
    date_text = str(details.get("release_date") or details.get("first_air_date") or "").strip() or None
    year = _extract_year(date_text)

    cache_key = (media_type, tmdb_id, imdb_id or "")
    now = time.time()
    cached = _cache.get(cache_key)
    if cached and (now - cached[0]) < SCORES_TTL_SECONDS:
        if _has_legacy_rotten_fallback(cached[1]):
            _cache.pop(cache_key, None)
        else:
            return cached[1]

    scores = _blank_scores()

    omdb_data = await _fetch_omdb(imdb_id=imdb_id, title=title, year=year)
    if omdb_data:
        imdb_rating = _parse_float(omdb_data.get("imdbRating"))
        if imdb_rating is not None:
            scores["imdb"]["display"] = f"{imdb_rating:.1f}/10"
            scores["imdb"]["source"] = "omdb"

        metascore = _parse_int(omdb_data.get("Metascore"))
        if metascore is not None:
            scores["metacritic"]["display"] = f"{metascore}/100"
            scores["metacritic"]["source"] = "omdb"

        if not imdb_id:
            omdb_imdb = str(omdb_data.get("imdbID") or "").strip()
            if omdb_imdb:
                imdb_id = omdb_imdb

    letterboxd_value = await _fetch_letterboxd_score(imdb_id)
    if letterboxd_value is not None:
        scores["letterboxd"]["source"] = "letterboxd_api"
        scores["letterboxd"]["display"] = f"{letterboxd_value:.1f}/5"
        if imdb_id:
            scores["letterboxd"]["url"] = f"{LETTERBOXD_BASE_URL}/imdb/{imdb_id}/"
    else:
        page_value, page_url = (None, None)
        if _letterboxd_page_fetch_enabled():
            page_value, page_url = await _fetch_letterboxd_page_score(title=title, year=year, imdb_id=imdb_id)
        if page_url:
            scores["letterboxd"]["url"] = page_url
        if page_value is not None:
            scores["letterboxd"]["source"] = "letterboxd_page"
            scores["letterboxd"]["display"] = f"{page_value:.1f}/5"
        else:
            estimate = _estimate_letterboxd_score(media_type, details)
            if estimate is not None:
                scores["letterboxd"]["source"] = "tmdb_estimate"
                scores["letterboxd"]["display"] = f"{estimate:.1f}/5"
                if imdb_id:
                    scores["letterboxd"]["url"] = f"{LETTERBOXD_BASE_URL}/imdb/{imdb_id}/"
                elif page_url is None:
                    scores["letterboxd"]["url"] = _build_letterboxd_search_url(title)

    if imdb_id:
        scores["imdb"]["url"] = f"https://www.imdb.com/title/{imdb_id}/"

    if _scraped_ratings_enabled():
        if imdb_id:
            imdb_rating_live = await _fetch_imdb_rating(imdb_id)
            if imdb_rating_live is not None:
                scores["imdb"]["display"] = f"{imdb_rating_live:.1f}/10"
                scores["imdb"]["source"] = "imdb"

        metacritic_url, metacritic_score, metacritic_user_score = await _resolve_metacritic_url_and_score(
            title=title,
            media_type=media_type,
            year=year,
        )
        if metacritic_url:
            scores["metacritic"]["url"] = metacritic_url
            scores["metacritic_audience"]["url"] = metacritic_url
        if metacritic_score is not None:
            scores["metacritic"]["display"] = f"{metacritic_score}/100"
            scores["metacritic"]["source"] = "metacritic"
        if metacritic_user_score is not None:
            scores["metacritic_audience"]["display"] = f"{metacritic_user_score:.1f}/10"
            scores["metacritic_audience"]["source"] = "metacritic"

        rotten_url = await _resolve_rotten_url(
            omdb_data=omdb_data,
            title=title,
            media_type=media_type,
            year=year,
        )
        if rotten_url:
            scores["rotten_tomatoes_critics"]["url"] = rotten_url
            scores["rotten_tomatoes_audience"]["url"] = rotten_url
            fetched_critics, fetched_audience = await _fetch_rotten_scores(rotten_url)
            if fetched_critics is not None:
                scores["rotten_tomatoes_critics"]["display"] = f"{fetched_critics}%"
                scores["rotten_tomatoes_critics"]["source"] = "rotten_tomatoes"
            if fetched_audience is not None:
                scores["rotten_tomatoes_audience"]["display"] = f"{fetched_audience}%"
                scores["rotten_tomatoes_audience"]["source"] = "rotten_tomatoes"

    _cache[cache_key] = (now, scores)
    return scores
