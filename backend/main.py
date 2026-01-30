from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from . import tmdb, config

app = FastAPI()

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


@app.get("/api/search")
async def search(q: str = Query(..., min_length=1)):
    data = await tmdb.search_movie(q)
    return data


@app.get("/api/movie/{movie_id}/providers")
async def movie_providers(movie_id: int):
    providers = await tmdb.get_watch_providers(movie_id)
    details = await tmdb.get_movie_details(movie_id)
    return {"movie": details, "providers": providers}


@app.get("/api/providers")
async def provider_list(country: str | None = None):
    return await tmdb.get_provider_list(country)


@app.get("/api/regions")
async def regions():
    return await tmdb.get_available_regions()


@app.get("/api/config")
async def get_config():
    return config.load_config()


@app.post("/api/config")
async def set_config(data: dict):
    config.save_config(data)
    return {"ok": True}


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
