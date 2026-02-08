import asyncio
import os
import time
import httpx
import re
import json
import base64
from urllib.parse import urlparse, parse_qs, unquote

BASE_URL = "https://streaming-availability.p.rapidapi.com"

# In-memory cache: (media_type, tmdb_id) -> parsed result
_cache: dict[tuple, dict] = {}
_changes_cache: dict[str, tuple[float, dict]] = {}
_client: httpx.AsyncClient | None = None
_tmdb_watch_link_cache: dict[tuple[str, int, str], tuple[float, list[dict]]] = {}

CHANGES_TTL = 10 * 60
TMDB_WATCH_LINK_TTL = 6 * 60 * 60
_HREF_RE = re.compile(r'href=[\"\']([^\"\']+)[\"\']', re.IGNORECASE)


async def get_streaming_links(
    tmdb_id: int,
    media_type: str = "movie",
    countries: list[str] | None = None,
) -> dict:
    """Return enriched streaming data + movie info."""
    api_key = _get_api_key()
    if not api_key:
        return {}
    cache_key = (media_type, tmdb_id)
    base_result = _cache.get(cache_key)
    if not base_result:
        show_type = "tv" if media_type == "tv" else "movie"
        headers = {"X-RapidAPI-Key": api_key, "X-RapidAPI-Host": "streaming-availability.p.rapidapi.com"}
        client = await _get_client()
        resp = await client.get(
            f"{BASE_URL}/shows/{show_type}/{tmdb_id}",
            headers=headers,
        )
        if resp.status_code != 200:
            return {}
        data = resp.json()

        # Parse streaming options per country
        base_streaming: dict[str, list] = {}
        for country, options in data.get("streamingOptions", {}).items():
            entries = []
            for opt in options:
                service = opt.get("service", {})
                price = opt.get("price", {})
                expires_on = opt.get("expiresOn")
                entry = {
                    "service_id": service.get("id", ""),
                    "service_name": service.get("name", ""),
                    "type": opt.get("type", ""),
                    "link": opt.get("link", ""),
                    "quality": opt.get("quality") or None,
                    "audios": [a.get("language", "") for a in opt.get("audios", [])],
                    "subtitles": [s.get("locale", {}).get("language", "") for s in opt.get("subtitles", [])],
                }
                if expires_on:
                    entry["expires_on"] = expires_on
                if price and price.get("formatted"):
                    entry["price"] = price.get("formatted")
                if price and price.get("amount"):
                    entry["price_amount"] = price.get("amount")
                if price and price.get("currency"):
                    entry["price_currency"] = price.get("currency")
                entries.append(entry)
            if entries:
                base_streaming[country] = entries

        # Parse top-level movie info
        image_set = data.get("imageSet", {})
        # Get best available poster/backdrop
        v_posters = image_set.get("verticalPoster", {})
        h_backdrops = image_set.get("horizontalBackdrop", {})
        poster_url = (v_posters.get("w720") or v_posters.get("w600")
                    or v_posters.get("w480") or v_posters.get("w360")
                    or v_posters.get("w240") or "")
        backdrop_url = (h_backdrops.get("w1440") or h_backdrops.get("w1080")
                        or h_backdrops.get("w720") or h_backdrops.get("w360") or "")

        movie_info = {
            "cast": data.get("cast", []),
            "directors": data.get("directors", []),
            "rating": data.get("rating", 0),
            "poster": poster_url,
            "backdrop": backdrop_url,
        }
        base_result = {"streaming": base_streaming, "movie_info": movie_info}
        _cache[cache_key] = base_result

    streaming = {
        country_code: [dict(item) for item in items]
        for country_code, items in (base_result.get("streaming") or {}).items()
    }
    movie_info = dict(base_result.get("movie_info") or {})

    # Enrich sparse API data with provider-level clickout links from TMDB watch pages.
    # TMDB embeds JustWatch clickouts with providerId + monetizationType, which gives
    # us much wider deeplink coverage (including long-tail regional services).
    if countries:
        clickouts = await _get_tmdb_watch_clickouts(tmdb_id, media_type, countries)
        for country_code, entries in clickouts.items():
            existing = streaming.get(country_code, [])
            seen = {
                (
                    str(item.get("provider_id") or ""),
                    str(item.get("type") or ""),
                    str(item.get("link") or ""),
                )
                for item in existing
            }
            for entry in entries:
                key = (
                    str(entry.get("provider_id") or ""),
                    str(entry.get("type") or ""),
                    str(entry.get("link") or ""),
                )
                if key in seen:
                    continue
                seen.add(key)
                existing.append(entry)
            if existing:
                streaming[country_code] = existing

    return {"streaming": streaming, "movie_info": movie_info}


def _normalize_country_codes(countries: list[str] | None) -> list[str]:
    if not countries:
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for code in countries:
        c = str(code or "").strip().upper()
        if len(c) != 2 or not c.isalpha() or c in seen:
            continue
        seen.add(c)
        normalized.append(c)
        if len(normalized) >= 12:
            break
    return normalized


def _decode_clickout_context(cx_value: str) -> dict | None:
    if not cx_value:
        return None
    try:
        padded = cx_value + "=" * (-len(cx_value) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("utf-8"))
        payload = json.loads(decoded.decode("utf-8"))
    except Exception:
        return None
    data = payload.get("data")
    if not isinstance(data, list):
        return None
    for context in data:
        if not isinstance(context, dict):
            continue
        schema = str(context.get("schema") or "")
        if "clickout_context" not in schema:
            continue
        clickout_data = context.get("data")
        return clickout_data if isinstance(clickout_data, dict) else None
    return None


def _extract_clickout_entries_from_html(html: str) -> list[dict]:
    entries: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for match in _HREF_RE.finditer(html or ""):
        href = match.group(1)
        if "click.justwatch.com/" not in href:
            continue
        parsed = urlparse(href)
        query = parse_qs(parsed.query)
        target = unquote((query.get("r") or [""])[0]).strip()
        if not target:
            continue
        clickout_context = _decode_clickout_context((query.get("cx") or [""])[0])
        provider_id_raw = None if not clickout_context else clickout_context.get("providerId")
        provider_id = None
        if isinstance(provider_id_raw, int):
            provider_id = provider_id_raw
        elif isinstance(provider_id_raw, str) and provider_id_raw.isdigit():
            provider_id = int(provider_id_raw)
        monetization = str((clickout_context or {}).get("monetizationType") or "").strip().lower()
        provider_name = str((clickout_context or {}).get("provider") or "").strip()
        presentation_type = str((clickout_context or {}).get("presentationType") or "").strip().lower()
        key = (str(provider_id or ""), monetization, target)
        if key in seen:
            continue
        seen.add(key)
        entry = {
            "service_id": str(provider_id or ""),
            "service_name": provider_name,
            "type": monetization,
            "link": target,
            "provider_id": provider_id,
        }
        if presentation_type:
            entry["quality"] = presentation_type
        entries.append(entry)
    return entries


async def _fetch_tmdb_watch_clickouts_for_country(
    tmdb_id: int,
    media_type: str,
    country_code: str,
) -> list[dict]:
    cache_key = (media_type, tmdb_id, country_code)
    now = time.time()
    cached = _tmdb_watch_link_cache.get(cache_key)
    if cached and (now - cached[0]) < TMDB_WATCH_LINK_TTL:
        return cached[1]

    media_path = "tv" if media_type == "tv" else "movie"
    url = f"https://www.themoviedb.org/{media_path}/{tmdb_id}/watch?locale={country_code}"
    client = await _get_client()
    try:
        resp = await client.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; FullStreamer/1.0; +https://fullstreamer.com)",
            },
            follow_redirects=True,
        )
    except Exception:
        _tmdb_watch_link_cache[cache_key] = (now, [])
        return []

    if resp.status_code != 200:
        _tmdb_watch_link_cache[cache_key] = (now, [])
        return []

    entries = _extract_clickout_entries_from_html(resp.text)
    _tmdb_watch_link_cache[cache_key] = (now, entries)
    return entries


async def _get_tmdb_watch_clickouts(
    tmdb_id: int,
    media_type: str,
    countries: list[str],
) -> dict[str, list[dict]]:
    normalized = _normalize_country_codes(countries)
    if not normalized:
        return {}
    tasks = [
        _fetch_tmdb_watch_clickouts_for_country(tmdb_id, media_type, country_code)
        for country_code in normalized
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    merged: dict[str, list[dict]] = {}
    for country_code, result in zip(normalized, results):
        if isinstance(result, Exception):
            continue
        if result:
            merged[country_code.lower()] = result
    return merged


def _get_api_key() -> str:
    return os.environ.get("STREAMING_AVAILABILITY_API_KEY", "")


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=10)
    return _client


async def close_client() -> None:
    global _client
    if _client:
        await _client.aclose()
        _client = None


def _extract_tmdb_id(show: dict) -> int | None:
    val = (
        show.get("tmdbId")
        or show.get("tmdb_id")
        or show.get("tmdb")
        or show.get("tmdbID")
    )
    if isinstance(val, dict):
        val = val.get("id") or val.get("tmdb_id")
    if isinstance(val, int):
        return val
    if isinstance(val, str):
        if val.startswith("movie/") or val.startswith("tv/"):
            val = val.split("/", 1)[1]
        if val.isdigit():
            return int(val)
    return None


def _extract_poster_url(show: dict) -> str:
    image_set = show.get("imageSet") or show.get("image_set") or {}
    vertical = image_set.get("verticalPoster") or image_set.get("vertical_poster") or {}
    for key in ("w720", "w600", "w480", "w360", "w240"):
        if vertical.get(key):
            return vertical.get(key)
    return ""


def _extract_release_date(show: dict) -> str:
    for key in ("releaseDate", "release_date", "firstAirDate", "first_air_date"):
        val = show.get(key)
        if isinstance(val, str):
            return val
    year = show.get("releaseYear")
    if isinstance(year, int):
        return f"{year}-01-01"
    year = show.get("year")
    if isinstance(year, int):
        return f"{year}-01-01"
    return ""


def _extract_media_type(show: dict) -> str | None:
    show_type = show.get("showType") or show.get("show_type") or show.get("type")
    if isinstance(show_type, str):
        st = show_type.lower()
        if st in ("movie", "film"):
            return "movie"
        if st in ("series", "tv", "show"):
            return "tv"
    tmdb_val = show.get("tmdbId") or show.get("tmdb_id") or show.get("tmdb")
    if isinstance(tmdb_val, str):
        if tmdb_val.startswith("movie/"):
            return "movie"
        if tmdb_val.startswith("tv/"):
            return "tv"
    return None


async def get_recently_added(
    catalogs: list[str],
    countries: list[str],
    cursor: str | None = None,
    pages: int = 1,
    show_type: str | None = "movie",
) -> dict:
    api_key = _get_api_key()
    if not api_key:
        return {"results": [], "next_cursor": None}
    if not countries:
        countries = ["US"]
    pages = max(1, min(5, pages))
    catalogs = [c for c in catalogs if c]
    catalogs_key = ",".join(sorted(catalogs)) if catalogs else "*"
    cache_key = f"{','.join(sorted(countries))}:{catalogs_key}:{cursor or ''}:{pages}:{show_type or 'all'}"
    now = time.time()
    cached = _changes_cache.get(cache_key)
    if cached and (now - cached[0]) < CHANGES_TTL:
        return cached[1]

    headers = {"X-RapidAPI-Key": api_key, "X-RapidAPI-Host": "streaming-availability.p.rapidapi.com"}
    results: list[dict] = []
    next_cursor: str | None = None
    seen = set()

    for country in countries:
        cur = cursor
        loops = 0
        while loops < pages:
            params = {
                "country": country.lower(),
                "change_type": "new",
                "item_type": "show",
            }
            if show_type:
                params["show_type"] = show_type
            if catalogs:
                params["catalogs"] = ",".join(catalogs)
            if cur:
                params["cursor"] = cur
            client = await _get_client()
            resp = await client.get(f"{BASE_URL}/changes", headers=headers, params=params)
            if resp.status_code != 200:
                break
            data = resp.json() or {}

            shows = []
            if isinstance(data.get("result"), list):
                for item in data.get("result"):
                    show = item.get("show") if isinstance(item, dict) else None
                    if show:
                        shows.append(show)
            elif isinstance(data.get("shows"), dict):
                shows = list(data.get("shows", {}).values())
            elif isinstance(data.get("shows"), list):
                shows = data.get("shows", [])

            for show in shows:
                tmdb_id = _extract_tmdb_id(show)
                if not tmdb_id or tmdb_id in seen:
                    continue
                seen.add(tmdb_id)
                media_type = _extract_media_type(show)
                if show_type == "movie":
                    media_type = "movie"
                elif show_type == "series":
                    media_type = "tv"
                item = {
                    "id": tmdb_id,
                    "title": show.get("title") or show.get("originalTitle") or "",
                    "release_date": _extract_release_date(show),
                    "poster_url": _extract_poster_url(show),
                }
                if media_type in ("movie", "tv"):
                    item["media_type"] = media_type
                results.append(item)

            next_cursor = data.get("nextCursor") or data.get("next_cursor") or next_cursor
            has_more = data.get("hasMore")
            loops += 1
            if not has_more or not next_cursor:
                break
            cur = next_cursor

    payload = {"results": results, "next_cursor": next_cursor}
    _changes_cache[cache_key] = (time.time(), payload)
    return payload
