import os
import httpx

BASE_URL = "https://api.themoviedb.org/3"
_client: httpx.AsyncClient | None = None


def _get_api_key() -> str:
    key = os.environ.get("TMDB_API_KEY", "")
    if not key:
        raise RuntimeError("TMDB_API_KEY environment variable not set.")
    return key


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


async def _get(path: str, params: dict | None = None) -> dict:
    params = params or {}
    api_key = _get_api_key()
    if not api_key:
        raise RuntimeError("TMDB_API_KEY environment variable not set.")
    params["api_key"] = api_key
    client = await _get_client()
    resp = await client.get(f"{BASE_URL}{path}", params=params)
    resp.raise_for_status()
    return resp.json()


async def search_movie(query: str, page: int = 1) -> dict:
    return await _get("/search/movie", {"query": query, "page": page})


async def search_tv(query: str, page: int = 1) -> dict:
    return await _get("/search/tv", {"query": query, "page": page})


async def search_person(query: str, page: int = 1) -> dict:
    return await _get("/search/person", {"query": query, "page": page, "include_adult": "false"})


async def get_watch_providers(movie_id: int) -> dict:
    data = await _get(f"/movie/{movie_id}/watch/providers")
    return data.get("results", {})


async def get_tv_watch_providers(tv_id: int) -> dict:
    data = await _get(f"/tv/{tv_id}/watch/providers")
    return data.get("results", {})


async def get_movie_details(movie_id: int) -> dict:
    return await _get(f"/movie/{movie_id}", {"append_to_response": "credits"})


async def get_movie_score_details(movie_id: int) -> dict:
    return await _get(f"/movie/{movie_id}")


def _pick_primary_role(roles: list[dict] | None) -> str | None:
    if not roles:
        return None
    ranked = sorted(
        (
            ((role.get("episode_count") or 0), str(role.get("character") or "").strip())
            for role in roles
        ),
        key=lambda item: item[0],
        reverse=True,
    )
    for _, character in ranked:
        if character:
            return character
    return None


def _normalize_aggregate_tv_cast(cast_items: list[dict] | None) -> list[dict]:
    if not cast_items:
        return []
    normalized: list[dict] = []
    for person in cast_items:
        entry = dict(person)
        entry["character"] = _pick_primary_role(person.get("roles"))
        normalized.append(entry)
    normalized.sort(
        key=lambda person: (
            person.get("order", 10_000),
            -(person.get("total_episode_count") or 0),
            -(person.get("popularity") or 0),
        )
    )
    return normalized


async def get_tv_details(tv_id: int) -> dict:
    data = await _get(f"/tv/{tv_id}", {"append_to_response": "credits,aggregate_credits,external_ids"})
    aggregate_credits = data.get("aggregate_credits") or {}
    aggregate_cast = _normalize_aggregate_tv_cast(aggregate_credits.get("cast"))
    if aggregate_cast:
        credits = data.get("credits") or {}
        current_cast = credits.get("cast") or []
        # Aggregate credits are usually much more complete for TV series.
        if len(aggregate_cast) >= len(current_cast):
            credits["cast"] = aggregate_cast
            data["credits"] = credits
    external_ids = data.get("external_ids") or {}
    imdb_id = external_ids.get("imdb_id")
    if imdb_id:
        data["imdb_id"] = imdb_id
    return data


async def get_tv_score_details(tv_id: int) -> dict:
    data = await _get(f"/tv/{tv_id}", {"append_to_response": "external_ids"})
    external_ids = data.get("external_ids") or {}
    imdb_id = external_ids.get("imdb_id")
    if imdb_id:
        data["imdb_id"] = imdb_id
    return data


async def get_person_details(person_id: int) -> dict:
    return await _get(f"/person/{person_id}")


async def get_person_combined_credits(person_id: int) -> dict:
    return await _get(f"/person/{person_id}/combined_credits")


async def get_genres() -> list:
    data = await _get("/genre/movie/list")
    return data.get("genres", [])


async def get_tv_genres() -> list:
    data = await _get("/genre/tv/list")
    return data.get("genres", [])


async def get_trending(time_window: str = "week", page: int = 1, media_type: str = "movie") -> dict:
    mt = "all" if media_type == "mix" else media_type
    return await _get(f"/trending/{mt}/{time_window}", {"page": page})


async def get_popular(page: int = 1) -> dict:
    return await _get("/movie/popular", {"page": page})


async def get_top_rated(page: int = 1) -> dict:
    return await _get("/movie/top_rated", {"page": page})


async def get_now_playing(page: int = 1) -> dict:
    return await _get("/movie/now_playing", {"page": page})


async def get_upcoming(page: int = 1) -> dict:
    return await _get("/movie/upcoming", {"page": page})


async def discover_by_genre(genre_id: int, page: int = 1) -> dict:
    return await discover({"with_genres": genre_id}, page=page)


async def discover(params: dict, page: int = 1) -> dict:
    base = {
        "sort_by": "popularity.desc",
        "include_adult": "false",
        "include_video": "false",
        "page": page,
    }
    base.update(params or {})
    return await _get("/discover/movie", base)


async def discover_tv(params: dict, page: int = 1) -> dict:
    base = {
        "sort_by": "popularity.desc",
        "include_adult": "false",
        "page": page,
    }
    base.update(params or {})
    return await _get("/discover/tv", base)


async def get_available_regions() -> list:
    data = await _get("/watch/providers/regions")
    return data.get("results", [])


async def get_provider_list(country: str | None = None) -> list:
    params = {}
    if country:
        params["watch_region"] = country
    data = await _get("/watch/providers/movie", params)
    return data.get("results", [])


async def get_tv_provider_list(country: str | None = None) -> list:
    params = {}
    if country:
        params["watch_region"] = country
    data = await _get("/watch/providers/tv", params)
    return data.get("results", [])
