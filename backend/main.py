import asyncio
import os
import time
from datetime import date
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Query, Depends, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from . import tmdb, streaming_availability
from .database import get_db, init_db, close_db
from .models import User, UserPreferences
from .auth import get_current_user, get_optional_user, verify_csrf
from .routes_auth import router as auth_router

WATCH_PROVIDER_TTL = 6 * 60 * 60
WATCH_PROVIDER_CACHE: dict[int, tuple[float, dict]] = {}
HOME_CACHE_TTL = 10 * 60
HOME_CACHE: dict[str, tuple[float, dict]] = {}
PROVIDER_NAME_TTL = 24 * 60 * 60
PROVIDER_NAME_CACHE: tuple[float, dict[int, str]] | None = None
SECTION_CACHE_TTL = 10 * 60
SECTION_CACHE: dict[str, tuple[float, dict]] = {}
FILTER_CONCURRENCY = 12

FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"
# Fallback to frontend/ if dist/ doesn't exist (dev without build)
if not FRONTEND_DIR.exists():
    FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await tmdb.close_client()
    await streaming_availability.close_client()
    await close_db()


app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter


# Rate limit error handler
@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={"detail": "Too many requests. Please try again later."})


# Security headers middleware
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# CSRF middleware for state-changing requests
@app.middleware("http")
async def csrf_middleware(request: Request, call_next):
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        # Skip CSRF for auth endpoints (login/signup don't have a token yet)
        path = request.url.path
        if path not in ("/api/auth/login", "/api/auth/signup", "/api/auth/logout"):
            if request.cookies.get("access_token"):
                verify_csrf(request)
    return await call_next(request)


# CORS
ALLOWED_ORIGINS = os.environ.get("CORS_ORIGINS", "").split(",")
ALLOWED_ORIGINS = [o.strip() for o in ALLOWED_ORIGINS if o.strip()]
if ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
    )


# Auth routes
app.include_router(auth_router)


@app.get("/api/search")
async def search(q: str = Query(..., min_length=1)):
    data = await tmdb.search_movie(q)
    return data


@app.get("/api/search_filtered")
async def search_filtered(
    q: str = Query(..., min_length=1),
    provider_ids: str | None = None,
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    target = 20
    max_pages = 4
    if provider_ids:
        ids = {int(pid) for pid in provider_ids.split(",") if pid.strip().isdigit()}
    elif user:
        prefs = await _get_user_prefs(db, user.id)
        ids = set(prefs.provider_ids) if prefs else set()
    else:
        ids = set()
    if not ids:
        return {"results": [], "filtered": True}
    ids = await _expand_provider_ids(ids)
    semaphore = asyncio.Semaphore(FILTER_CONCURRENCY)
    flag_cache: dict[int, bool] = {}
    seen = set()
    results: list = []
    page = 1
    total_pages = 0
    base = None
    chunk = 12
    buf: list = []
    while page <= max_pages and len(results) < target:
        data = await tmdb.search_movie(q, page=page)
        if base is None:
            base = data
        total_pages = data.get("total_pages") or total_pages
        raw = data.get("results", [])
        if not raw:
            break
        for m in raw:
            mid = m.get("id")
            if not mid or mid in seen:
                continue
            seen.add(mid)
            buf.append(m)
        while buf and len(results) < target:
            batch = buf[:chunk]
            buf = buf[chunk:]
            filtered = await _filter_results(batch, ids, semaphore, flag_cache)
            for m in filtered:
                results.append(m)
                if len(results) >= target:
                    break
            if len(results) >= target:
                break
        if total_pages and page >= total_pages:
            break
        page += 1
    if base is None:
        base = {"results": []}
    base["results"] = results
    base["filtered"] = True
    return base


@app.get("/api/movie/{movie_id}/providers")
async def movie_providers(movie_id: int):
    providers = await tmdb.get_watch_providers(movie_id)
    details = await tmdb.get_movie_details(movie_id)
    return {"movie": details, "providers": providers}


@app.get("/api/movie/{movie_id}/links")
async def movie_links(movie_id: int):
    return await streaming_availability.get_streaming_links(movie_id)


async def _get_user_prefs(db: AsyncSession, user_id) -> UserPreferences | None:
    result = await db.execute(select(UserPreferences).where(UserPreferences.user_id == user_id))
    return result.scalar_one_or_none()


async def _get_watch_providers_cached(movie_id: int) -> dict:
    now = time.time()
    cached = WATCH_PROVIDER_CACHE.get(movie_id)
    if cached and (now - cached[0]) < WATCH_PROVIDER_TTL:
        return cached[1]
    providers = await tmdb.get_watch_providers(movie_id)
    WATCH_PROVIDER_CACHE[movie_id] = (now, providers)
    return providers


async def _movie_has_provider(
    movie_id: int,
    provider_ids: set[int],
    semaphore: asyncio.Semaphore,
    flag_cache: dict[int, bool],
) -> bool:
    if movie_id in flag_cache:
        return flag_cache[movie_id]
    async with semaphore:
        try:
            providers = await _get_watch_providers_cached(movie_id)
        except Exception:
            flag_cache[movie_id] = False
            return False
    for region in providers.values():
        for key in ("flatrate", "free", "ads"):
            for p in region.get(key, []):
                if p.get("provider_id") in provider_ids:
                    flag_cache[movie_id] = True
                    return True
    flag_cache[movie_id] = False
    return False


async def _filter_results(
    results: list,
    provider_ids: set[int],
    semaphore: asyncio.Semaphore,
    flag_cache: dict[int, bool],
) -> list:
    seen = set()
    movies = []
    for m in results:
        mid = m.get("id")
        if not mid or mid in seen:
            continue
        seen.add(mid)
        movies.append(m)
    if not movies:
        return []
    flags = await asyncio.gather(
        *(_movie_has_provider(m["id"], provider_ids, semaphore, flag_cache) for m in movies)
    )
    return [m for m, ok in zip(movies, flags) if ok]


async def _home_section_config(provider_ids: set[int] | None = None, countries: list[str] | None = None):
    genres = await tmdb.get_genres()
    genre_map = {g["name"].lower(): g["id"] for g in genres}

    def gid(name: str):
        return genre_map.get(name.lower())

    sections = [
        {"id": "trending_week", "title": "Trending Now", "kind": "trending", "time_window": "week"},
        {"id": "top_rated", "title": "Top Rated", "kind": "top_rated"},
        {"id": "recently_added", "title": "Recently Added to Streaming", "kind": "recently_added"},
    ]

    if provider_ids:
        catalogs = await _resolve_streaming_catalogs(provider_ids)
        recent_section = sections[-1]
        recent_section["catalogs"] = catalogs
        recent_section["countries"] = countries or []

    current_year = date.today().year
    sections += [
        {
            "id": "new_this_year",
            "title": f"{current_year} Releases",
            "kind": "discover",
            "params": {"primary_release_year": current_year},
        },
        {
            "id": "recent_hits",
            "title": "Recent Hits",
            "kind": "discover",
            "params": {
                "primary_release_date.gte": f"{current_year - 1}-01-01",
                "primary_release_date.lte": f"{current_year}-12-31",
            },
        },
        {
            "id": "critically_acclaimed",
            "title": "Critically Acclaimed",
            "kind": "discover",
            "params": {"vote_average.gte": 7.5, "vote_count.gte": 1500, "sort_by": "vote_average.desc"},
        },
        {
            "id": "crowd_favorites",
            "title": "Crowd Favorites",
            "kind": "discover",
            "params": {"vote_average.gte": 7.0, "vote_count.gte": 5000},
        },
        {
            "id": "hidden_gems",
            "title": "Hidden Gems",
            "kind": "discover",
            "params": {"vote_average.gte": 7.2, "vote_count.gte": 100, "vote_count.lte": 500},
        },
        {"id": "short_sweet", "title": "Short & Sweet", "kind": "discover", "params": {"with_runtime.lte": 90}},
        {"id": "epic_journeys", "title": "Epic Journeys", "kind": "discover", "params": {"with_runtime.gte": 140}},
    ]

    combo_specs = [
        ("Action & Adventure", [gid("Action"), gid("Adventure")], "combo_action_adventure"),
        ("Sci-Fi & Fantasy", [gid("Science Fiction"), gid("Fantasy")], "combo_scifi_fantasy"),
        ("Mystery & Thriller", [gid("Mystery"), gid("Thriller")], "combo_mystery_thriller"),
        ("Rom-Coms", [gid("Romance"), gid("Comedy")], "combo_romcom"),
        ("Family Animation", [gid("Family"), gid("Animation")], "combo_family_animation"),
    ]
    for title, ids, section_id in combo_specs:
        ids = [i for i in ids if i]
        if len(ids) >= 2:
            sections.append(
                {"id": section_id, "title": title, "kind": "discover", "params": {"with_genres": ",".join(map(str, ids))}}
            )

    language_specs = [
        ("Korean Cinema", "ko"),
        ("Japanese Picks", "ja"),
        ("French Cinema", "fr"),
        ("Spanish Favorites", "es"),
        ("Hindi Hits", "hi"),
        ("German Gems", "de"),
        ("Italian Classics", "it"),
        ("Nordic Noir", "sv"),
    ]
    for title, code in language_specs:
        sections.append(
            {"id": f"lang_{code}", "title": title, "kind": "discover", "params": {"with_original_language": code}}
        )

    for g in sorted(genres, key=lambda x: x["name"].lower()):
        sections.append({"id": f"genre_{g['id']}", "title": g["name"], "kind": "genre", "genre_id": g["id"]})

    return sections


async def _get_tmdb_provider_name_map() -> dict[int, str]:
    global PROVIDER_NAME_CACHE
    now = time.time()
    if PROVIDER_NAME_CACHE and (now - PROVIDER_NAME_CACHE[0]) < PROVIDER_NAME_TTL:
        return PROVIDER_NAME_CACHE[1]
    providers = await tmdb.get_provider_list()
    mapping = {p["provider_id"]: p["provider_name"] for p in providers if "provider_id" in p}
    PROVIDER_NAME_CACHE = (now, mapping)
    return mapping


def _normalize_name(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch.isalnum())


async def _expand_provider_ids(ids: set[int]) -> set[int]:
    if not ids:
        return ids
    name_map = await _get_tmdb_provider_name_map()
    selected = []
    for pid in ids:
        name = name_map.get(pid)
        if name:
            norm = _normalize_name(name)
            if norm:
                selected.append(norm)
    if not selected:
        return ids
    expanded = set(ids)
    for pid, name in name_map.items():
        norm = _normalize_name(name)
        if not norm:
            continue
        for sel in selected:
            if norm in sel or sel in norm:
                expanded.add(pid)
                break
    return expanded


async def _resolve_streaming_catalogs(provider_ids: set[int]) -> list[str]:
    name_map = await _get_tmdb_provider_name_map()
    catalogs = []
    for pid in provider_ids:
        name = name_map.get(pid, "")
        if not name:
            continue
        norm = _normalize_name(name)
        service = None
        option = "subscription"
        if "netflix" in norm:
            service = "netflix"
        elif "primevideo" in norm or "amazonprime" in norm:
            service = "prime"
        elif "disney" in norm:
            service = "disney"
        elif "hbo" in norm or norm == "max":
            service = "hbo"
        elif "hulu" in norm:
            service = "hulu"
        elif "paramount" in norm:
            service = "paramount"
        elif "peacock" in norm:
            service = "peacock"
        elif "apple" in norm and "tv" in norm:
            service = "apple"
        elif "starz" in norm:
            service = "starz"
        elif "mubi" in norm:
            service = "mubi"
        elif "tubi" in norm:
            service = "tubi"
            option = "free"
        elif "pluto" in norm:
            service = "plutotv"
            option = "free"
        elif "crave" in norm:
            service = "crave"
        elif "stan" in norm:
            service = "stan"
        elif "britbox" in norm:
            service = "britbox"
        elif "wow" in norm:
            service = "wow"
        if not service:
            continue
        catalogs.append(f"{service}.{option}" if option else service)
    seen = set()
    unique = []
    for c in catalogs:
        if c in seen:
            continue
        seen.add(c)
        unique.append(c)
    return unique


async def _fetch_section_page(section: dict, page: int) -> dict:
    kind = section.get("kind")
    if kind == "trending":
        return await tmdb.get_trending(time_window=section.get("time_window", "week"), page=page)
    if kind == "popular":
        return await tmdb.get_popular(page=page)
    if kind == "top_rated":
        return await tmdb.get_top_rated(page=page)
    if kind == "now_playing":
        return await tmdb.get_now_playing(page=page)
    if kind == "upcoming":
        return await tmdb.get_upcoming(page=page)
    if kind == "genre":
        return await tmdb.discover({"with_genres": section.get("genre_id")}, page=page)
    if kind == "discover":
        return await tmdb.discover(section.get("params", {}), page=page)
    if kind == "recently_added":
        catalogs = section.get("catalogs", [])
        countries = section.get("countries", [])
        data = await streaming_availability.get_recently_added(catalogs, countries, None, pages=1)
        return {"results": data.get("results", []), "next_cursor": data.get("next_cursor")}
    return {}


@app.get("/api/home")
async def home(
    provider_ids: str | None = None,
    page: int = 1,
    page_size: int = 6,
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    if provider_ids:
        ids = {int(pid) for pid in provider_ids.split(",") if pid.strip().isdigit()}
        countries = []
    elif user:
        prefs = await _get_user_prefs(db, user.id)
        ids = set(prefs.provider_ids) if prefs else set()
        countries = list(prefs.countries) if prefs else []
    else:
        ids = set()
        countries = []

    if not ids:
        return {"sections": [], "filtered": True, "message": "Select streaming services to see available titles."}

    page = max(1, page)
    page_size = max(3, min(10, page_size))
    cache_key = f"{','.join(str(pid) for pid in sorted(ids))}:{','.join(countries)}:{page}:{page_size}"
    now = time.time()
    cached = HOME_CACHE.get(cache_key)
    if cached and (now - cached[0]) < HOME_CACHE_TTL:
        return cached[1]
    sections_config = await _home_section_config(ids, countries)
    total_sections = len(sections_config)
    start = (page - 1) * page_size
    end = start + page_size
    slice_config = sections_config[start:end]

    TARGET_ROW = 24
    MAX_PAGES = 3
    semaphore = asyncio.Semaphore(FILTER_CONCURRENCY)
    flag_cache: dict[int, bool] = {}

    async def build_section(section: dict):
        if section.get("kind") == "recently_added":
            data = await _fetch_section_page(section, 1)
            results = data.get("results", [])[:TARGET_ROW]
            return {
                "id": section["id"],
                "title": section["title"],
                "results": results,
                "next_cursor": data.get("next_cursor"),
            }
        results = []
        seen_ids = set()
        pg = 1
        last_page = 0
        total_pages = 0
        while pg <= MAX_PAGES and len(results) < TARGET_ROW:
            data = await _fetch_section_page(section, pg)
            total_pages = data.get("total_pages") or total_pages
            raw = data.get("results", [])
            if not raw:
                break
            filtered = await _filter_results(raw, ids, semaphore, flag_cache)
            for m in filtered:
                mid = m.get("id")
                if not mid or mid in seen_ids:
                    continue
                seen_ids.add(mid)
                results.append(m)
                if len(results) >= TARGET_ROW:
                    break
            last_page = pg
            if total_pages and pg >= total_pages:
                break
            pg += 1
        next_page = None
        if total_pages and last_page and last_page < total_pages:
            next_page = last_page + 1
        return {
            "id": section["id"],
            "title": section["title"],
            "results": results,
            "next_page": next_page,
            "total_pages": total_pages,
        }

    if not slice_config:
        payload = {
            "sections": [],
            "filtered": True,
            "page": page,
            "page_size": page_size,
            "total_sections": total_sections,
            "has_more": False,
        }
        HOME_CACHE[cache_key] = (time.time(), payload)
        return payload

    sections = await asyncio.gather(*(build_section(section) for section in slice_config))
    has_more = end < total_sections
    payload = {
        "sections": sections,
        "filtered": True,
        "page": page,
        "page_size": page_size,
        "total_sections": total_sections,
        "has_more": has_more,
        "next_page": page + 1 if has_more else None,
    }
    HOME_CACHE[cache_key] = (time.time(), payload)
    return payload


@app.get("/api/section")
async def section(
    section_id: str,
    page: int = 1,
    pages: int = 1,
    provider_ids: str | None = None,
    cursor: str | None = None,
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    if provider_ids:
        ids = {int(pid) for pid in provider_ids.split(",") if pid.strip().isdigit()}
        countries = []
    elif user:
        prefs = await _get_user_prefs(db, user.id)
        ids = set(prefs.provider_ids) if prefs else set()
        countries = list(prefs.countries) if prefs else []
    else:
        ids = set()
        countries = []

    if not ids:
        return {"id": section_id, "results": [], "filtered": True, "message": "Select streaming services first."}

    sections = await _home_section_config(ids, countries)
    section_def = next((s for s in sections if s["id"] == section_id), None)
    if not section_def:
        return {"id": section_id, "results": [], "filtered": True, "message": "Unknown section."}

    cache_key = f"{section_id}:{','.join(str(pid) for pid in sorted(ids))}:{page}:{pages}:{cursor or ''}"
    now = time.time()
    cached = SECTION_CACHE.get(cache_key)
    if cached and (now - cached[0]) < SECTION_CACHE_TTL:
        return cached[1]

    if section_def.get("kind") == "recently_added":
        data = await streaming_availability.get_recently_added(
            section_def.get("catalogs", []),
            section_def.get("countries", []),
            cursor,
            pages=pages,
        )
        results = data.get("results", [])
        target = pages * 20
        if len(results) > target:
            results = results[:target]
        next_cursor = data.get("next_cursor")
        payload = {
            "id": section_id,
            "title": section_def["title"],
            "results": results,
            "next_cursor": next_cursor,
            "filtered": True,
        }
        SECTION_CACHE[cache_key] = (time.time(), payload)
        return payload

    semaphore = asyncio.Semaphore(FILTER_CONCURRENCY)
    flag_cache: dict[int, bool] = {}
    pages = max(1, min(5, pages))
    target_count = pages * 20
    max_scan_pages = pages * 5
    results: list = []
    seen_ids = set()
    total_pages = 0
    last_page = page - 1
    scanned = 0
    p = page
    while len(results) < target_count:
        if total_pages and p > total_pages:
            break
        if scanned >= max_scan_pages:
            break
        data = await _fetch_section_page(section_def, p)
        if not total_pages:
            total_pages = data.get("total_pages", 0)
        filtered = await _filter_results(data.get("results", []), ids, semaphore, flag_cache)
        for m in filtered:
            mid = m.get("id")
            if not mid or mid in seen_ids:
                continue
            seen_ids.add(mid)
            results.append(m)
            if len(results) >= target_count:
                results = results[:target_count]
                break
        last_page = p
        scanned += 1
        if not data.get("results"):
            break
        if len(results) >= target_count:
            break
        p += 1
    next_page = None
    if total_pages and last_page < total_pages:
        next_page = last_page + 1
    payload = {
        "id": section_id,
        "title": section_def["title"],
        "results": results,
        "page": page,
        "next_page": next_page,
        "total_pages": total_pages,
        "filtered": True,
    }
    SECTION_CACHE[cache_key] = (time.time(), payload)
    return payload


@app.get("/api/providers")
async def provider_list(country: str | None = None):
    return await tmdb.get_provider_list(country)


@app.get("/api/regions")
async def regions():
    return await tmdb.get_available_regions()


@app.get("/api/config")
async def get_config(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    prefs = await _get_user_prefs(db, user.id)
    if not prefs:
        return {"provider_ids": [], "countries": []}
    return {"provider_ids": prefs.provider_ids or [], "countries": prefs.countries or []}


@app.post("/api/config")
async def set_config(data: dict, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(UserPreferences).where(UserPreferences.user_id == user.id))
    prefs = result.scalar_one_or_none()
    if not prefs:
        prefs = UserPreferences(user_id=user.id)
        db.add(prefs)

    if "provider_ids" in data:
        incoming = data.get("provider_ids") or []
        provider_ids = []
        for pid in incoming:
            try:
                provider_ids.append(int(pid))
            except (TypeError, ValueError):
                continue
        prefs.provider_ids = provider_ids

    if "countries" in data:
        prefs.countries = data.get("countries") or []

    await db.commit()
    return {"ok": True}


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
