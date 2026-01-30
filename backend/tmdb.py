import os
import httpx

BASE_URL = "https://api.themoviedb.org/3"
API_KEY = os.environ.get("TMDB_API_KEY", "")


async def _get(path: str, params: dict | None = None) -> dict:
    params = params or {}
    params["api_key"] = API_KEY
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{BASE_URL}{path}", params=params, timeout=10)
        resp.raise_for_status()
        return resp.json()


async def search_movie(query: str, page: int = 1) -> dict:
    return await _get("/search/movie", {"query": query, "page": page})


async def get_watch_providers(movie_id: int) -> dict:
    data = await _get(f"/movie/{movie_id}/watch/providers")
    return data.get("results", {})


async def get_movie_details(movie_id: int) -> dict:
    return await _get(f"/movie/{movie_id}")


async def get_available_regions() -> list:
    data = await _get("/watch/providers/regions")
    return data.get("results", [])


async def get_provider_list(country: str | None = None) -> list:
    params = {}
    if country:
        params["watch_region"] = country
    data = await _get("/watch/providers/movie", params)
    return data.get("results", [])
