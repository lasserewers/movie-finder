import os
import httpx

from . import config as app_config

BASE_URL = "https://api.themoviedb.org/3"
_client: httpx.AsyncClient | None = None


def _get_api_key() -> str:
    return os.environ.get("TMDB_API_KEY") or app_config.load_config().get("tmdb_api_key", "")


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
        raise RuntimeError("TMDB_API_KEY not set. Export TMDB_API_KEY or add tmdb_api_key to user_config.json.")
    params["api_key"] = api_key
    client = await _get_client()
    resp = await client.get(f"{BASE_URL}{path}", params=params)
    resp.raise_for_status()
    return resp.json()


async def search_movie(query: str, page: int = 1) -> dict:
    return await _get("/search/movie", {"query": query, "page": page})


async def get_watch_providers(movie_id: int) -> dict:
    data = await _get(f"/movie/{movie_id}/watch/providers")
    return data.get("results", {})


async def get_movie_details(movie_id: int) -> dict:
    return await _get(f"/movie/{movie_id}", {"append_to_response": "credits"})


async def get_genres() -> list:
    data = await _get("/genre/movie/list")
    return data.get("genres", [])


async def get_trending(time_window: str = "week", page: int = 1) -> dict:
    return await _get(f"/trending/movie/{time_window}", {"page": page})


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


async def get_available_regions() -> list:
    data = await _get("/watch/providers/regions")
    return data.get("results", [])


async def get_provider_list(country: str | None = None) -> list:
    params = {}
    if country:
        params["watch_region"] = country
    data = await _get("/watch/providers/movie", params)
    return data.get("results", [])
