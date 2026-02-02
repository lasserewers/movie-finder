import os
import time
import httpx

BASE_URL = "https://streaming-availability.p.rapidapi.com"

# In-memory cache: (media_type, tmdb_id) -> parsed result
_cache: dict[tuple, dict] = {}
_changes_cache: dict[str, tuple[float, dict]] = {}
_client: httpx.AsyncClient | None = None

CHANGES_TTL = 10 * 60


async def get_streaming_links(tmdb_id: int, media_type: str = "movie") -> dict:
    """Return enriched streaming data + movie info."""
    api_key = _get_api_key()
    if not api_key:
        return {}
    cache_key = (media_type, tmdb_id)
    if cache_key in _cache:
        return _cache[cache_key]

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
    streaming: dict[str, list] = {}
    for country, options in data.get("streamingOptions", {}).items():
        entries = []
        for opt in options:
            service = opt.get("service", {})
            price = opt.get("price", {})
            entry = {
                "service_id": service.get("id", ""),
                "service_name": service.get("name", ""),
                "type": opt.get("type", ""),
                "link": opt.get("link", ""),
                "quality": opt.get("quality", ""),
                "audios": [a.get("language", "") for a in opt.get("audios", [])],
                "subtitles": [s.get("locale", {}).get("language", "") for s in opt.get("subtitles", [])],
                "expires_on": opt.get("expiresOn", 0),
            }
            if price:
                entry["price"] = price.get("formatted", "")
                entry["price_amount"] = price.get("amount", 0)
                entry["price_currency"] = price.get("currency", "")
            entries.append(entry)
        if entries:
            streaming[country] = entries

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

    result = {"streaming": streaming, "movie_info": movie_info}
    _cache[cache_key] = result
    return result


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
