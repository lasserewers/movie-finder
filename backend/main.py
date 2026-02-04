import asyncio
import os
import time
from datetime import date, timedelta
from contextlib import asynccontextmanager

import httpx

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
WATCH_PROVIDER_CACHE: dict[tuple[str, int], tuple[float, dict]] = {}
HOME_CACHE_TTL = 10 * 60
HOME_CACHE: dict[str, tuple[float, dict]] = {}
PROVIDER_NAME_TTL = 24 * 60 * 60
PROVIDER_NAME_CACHE: tuple[float, dict[int, str]] | None = None
SECTION_CACHE_TTL = 10 * 60
SECTION_CACHE: dict[str, tuple[float, dict]] = {}
SECTION_CONFIG_CACHE: dict[str, tuple[float, list]] = {}
SECTION_CONFIG_TTL = 10 * 60
SEARCH_CACHE_TTL = 5 * 60
SEARCH_CACHE: dict[str, tuple[float, dict]] = {}
FILTER_CONCURRENCY = 30
VALID_MEDIA_TYPES = ("movie", "tv", "mix")


def _normalize_result(item: dict) -> dict:
    """Unify TV/movie result shape so frontend always sees title + release_date."""
    if "name" in item and "title" not in item:
        item["title"] = item.get("name") or item.get("original_name") or ""
        item["release_date"] = item.get("first_air_date") or ""
        item["media_type"] = "tv"
    elif "title" in item:
        item.setdefault("media_type", "movie")
    # For /trending/all results, TMDB includes media_type already
    if item.get("media_type") == "tv" and "title" not in item:
        item["title"] = item.get("name") or ""
        item["release_date"] = item.get("first_air_date") or ""
    return item

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
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
    )


# Auth routes
app.include_router(auth_router)


@app.get("/api/search")
async def search(
    q: str = Query(..., min_length=1),
    media_type: str = "movie",
    limit: int = Query(10, ge=1, le=20),
):
    if media_type not in VALID_MEDIA_TYPES:
        media_type = "movie"
    q_norm = q.strip().lower()
    cache_key = f"search:{media_type}:{limit}:{q_norm}"
    now = time.time()
    cached = SEARCH_CACHE.get(cache_key)
    if cached and (now - cached[0]) < SEARCH_CACHE_TTL:
        return cached[1]
    if media_type == "tv":
        data = await tmdb.search_tv(q)
        for r in data.get("results", []):
            _normalize_result(r)
        data["results"] = data.get("results", [])[:limit]
        SEARCH_CACHE[cache_key] = (now, data)
        return data
    if media_type == "mix":
        movie_data, tv_data = await asyncio.gather(tmdb.search_movie(q), tmdb.search_tv(q))
        movies = movie_data.get("results", [])
        tv_shows = tv_data.get("results", [])
        for r in movies:
            _normalize_result(r)
        for r in tv_shows:
            _normalize_result(r)
        combined = sorted(movies + tv_shows, key=lambda x: x.get("popularity", 0), reverse=True)[:limit]
        movie_data["results"] = combined
        SEARCH_CACHE[cache_key] = (now, movie_data)
        return movie_data
    data = await tmdb.search_movie(q)
    for r in data.get("results", []):
        _normalize_result(r)
    data["results"] = data.get("results", [])[:limit]
    SEARCH_CACHE[cache_key] = (now, data)
    return data


@app.get("/api/search_filtered")
async def search_filtered(
    q: str = Query(..., min_length=1),
    provider_ids: str | None = None,
    media_type: str = "movie",
    limit: int = Query(20, ge=1, le=20),
    countries: str | None = None,
    vpn: bool = False,
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    if media_type not in VALID_MEDIA_TYPES:
        media_type = "movie"
    target = limit
    max_pages = 4
    prefs = await _get_user_prefs(db, user.id) if user else None
    if provider_ids:
        ids = {int(pid) for pid in provider_ids.split(",") if pid.strip().isdigit()}
    elif prefs:
        ids = set(prefs.provider_ids or [])
    else:
        ids = set()
    user_countries = list(prefs.countries) if prefs and prefs.countries else []
    requested_countries = _normalize_country_codes(countries.split(",")) if countries else None
    allowed_countries = (requested_countries or _normalize_country_codes(user_countries)) if not vpn else None
    if not ids:
        return {"results": [], "filtered": True}
    country_scope_key = ",".join(sorted(allowed_countries)) if allowed_countries else "*"
    cache_key = (
        f"search_filtered:{q.strip().lower()}:{media_type}:{target}:"
        f"{','.join(str(pid) for pid in sorted(ids))}:scope={country_scope_key}"
    )
    now = time.time()
    cached = SEARCH_CACHE.get(cache_key)
    if cached and (now - cached[0]) < SEARCH_CACHE_TTL:
        return cached[1]
    semaphore = asyncio.Semaphore(FILTER_CONCURRENCY)
    flag_cache: dict[tuple[str, int, str], bool] = {}

    async def _search_and_filter(search_fn, mt: str):
        seen = set()
        results: list = []
        page = 1
        total_pages = 0
        base = None
        chunk = 12
        buf: list = []
        while page <= max_pages and len(results) < target:
            data = await search_fn(q, page=page)
            if base is None:
                base = data
            total_pages = data.get("total_pages") or total_pages
            raw = data.get("results", [])
            if not raw:
                break
            for m in raw:
                _normalize_result(m)
                # Search branch determines canonical media type for provider checks.
                m["media_type"] = mt
                mid = m.get("id")
                if not mid or mid in seen:
                    continue
                seen.add(mid)
                buf.append(m)
            while buf and len(results) < target:
                batch = buf[:chunk]
                buf = buf[chunk:]
                filtered = await _filter_results(
                    batch,
                    ids,
                    semaphore,
                    flag_cache,
                    mt,
                    include_paid=False,
                    allowed_countries=allowed_countries,
                )
                for m in filtered:
                    results.append(m)
                    if len(results) >= target:
                        break
                if len(results) >= target:
                    break
            if total_pages and page >= total_pages:
                break
            page += 1
        return base, results

    if media_type == "mix":
        (base_m, res_m), (base_t, res_t) = await asyncio.gather(
            _search_and_filter(tmdb.search_movie, "movie"),
            _search_and_filter(tmdb.search_tv, "tv"),
        )
        combined = sorted(res_m + res_t, key=lambda x: x.get("popularity", 0), reverse=True)[:target]
        base = base_m or base_t or {"results": []}
        base["results"] = combined
        base["filtered"] = True
        SEARCH_CACHE[cache_key] = (now, base)
        return base

    search_fn = tmdb.search_tv if media_type == "tv" else tmdb.search_movie
    base, results = await _search_and_filter(search_fn, media_type)
    if base is None:
        base = {"results": []}
    base["results"] = results
    base["filtered"] = True
    SEARCH_CACHE[cache_key] = (now, base)
    return base


@app.get("/api/movie/{movie_id}/providers")
async def movie_providers(movie_id: int):
    providers = await tmdb.get_watch_providers(movie_id)
    details = await tmdb.get_movie_details(movie_id)
    return {"movie": details, "providers": providers}


@app.get("/api/movie/{movie_id}/links")
async def movie_links(movie_id: int):
    return await streaming_availability.get_streaming_links(movie_id)


@app.get("/api/tv/{tv_id}/providers")
async def tv_providers(tv_id: int):
    providers = await tmdb.get_tv_watch_providers(tv_id)
    details = await tmdb.get_tv_details(tv_id)
    _normalize_result(details)
    return {"movie": details, "providers": providers}


@app.get("/api/tv/{tv_id}/links")
async def tv_links(tv_id: int):
    return await streaming_availability.get_streaming_links(tv_id, media_type="tv")


async def _get_user_prefs(db: AsyncSession, user_id) -> UserPreferences | None:
    result = await db.execute(select(UserPreferences).where(UserPreferences.user_id == user_id))
    return result.scalar_one_or_none()


async def _get_watch_providers_cached(item_id: int, media_type: str = "movie") -> dict:
    cache_key = (media_type, item_id)
    now = time.time()
    cached = WATCH_PROVIDER_CACHE.get(cache_key)
    if cached and (now - cached[0]) < WATCH_PROVIDER_TTL:
        return cached[1]
    if media_type == "tv":
        providers = await tmdb.get_tv_watch_providers(item_id)
    else:
        providers = await tmdb.get_watch_providers(item_id)
    WATCH_PROVIDER_CACHE[cache_key] = (now, providers)
    return providers


def _normalize_country_codes(countries: list[str] | None) -> set[str] | None:
    if not countries:
        return None
    normalized = {
        c.strip().upper()
        for c in countries
        if isinstance(c, str) and len(c.strip()) == 2 and c.strip().isalpha()
    }
    return normalized or None


async def _item_has_provider(
    item_id: int,
    provider_ids: set[int],
    semaphore: asyncio.Semaphore,
    flag_cache: dict[tuple[str, int, str], bool],
    media_type: str = "movie",
    include_paid: bool = False,
    allowed_countries: set[str] | None = None,
    country_scope_key: str = "*",
) -> bool:
    cache_key = (media_type, item_id, country_scope_key)
    if cache_key in flag_cache:
        return flag_cache[cache_key]
    async with semaphore:
        try:
            providers = await _get_watch_providers_cached(item_id, media_type)
        except Exception:
            flag_cache[cache_key] = False
            return False
    monetization_keys = ("flatrate", "free", "ads", "rent", "buy") if include_paid else ("flatrate", "free", "ads")
    for region_code, region in providers.items():
        if allowed_countries and str(region_code).upper() not in allowed_countries:
            continue
        for key in monetization_keys:
            for p in region.get(key, []):
                if p.get("provider_id") in provider_ids:
                    flag_cache[cache_key] = True
                    return True
    flag_cache[cache_key] = False
    return False


async def _filter_results(
    results: list,
    provider_ids: set[int],
    semaphore: asyncio.Semaphore,
    flag_cache: dict[tuple[str, int, str], bool],
    media_type: str = "movie",
    include_paid: bool = False,
    allowed_countries: set[str] | None = None,
) -> list:
    seen = set()
    items = []
    for m in results:
        mid = m.get("id")
        if not mid or mid in seen:
            continue
        seen.add(mid)
        items.append(m)
    if not items:
        return []
    country_scope_key = ",".join(sorted(allowed_countries)) if allowed_countries else "*"
    country_scope_key = f"{country_scope_key}:{'all' if include_paid else 'stream'}"
    flags = await asyncio.gather(
        *(
            _item_has_provider(
                m["id"],
                provider_ids,
                semaphore,
                flag_cache,
                m.get("media_type", media_type),
                include_paid=include_paid,
                allowed_countries=allowed_countries,
                country_scope_key=country_scope_key,
            )
            for m in items
        )
    )
    return [m for m, ok in zip(items, flags) if ok]


async def _home_section_config(provider_ids: set[int] | None = None, countries: list[str] | None = None, media_type: str = "movie"):
    cache_key = f"{','.join(str(p) for p in sorted(provider_ids or []))}:{','.join(sorted(countries or []))}:{media_type}"
    now = time.time()
    cached = SECTION_CONFIG_CACHE.get(cache_key)
    if cached and (now - cached[0]) < SECTION_CONFIG_TTL:
        return cached[1]

    is_movie = media_type in ("movie", "mix")
    is_tv = media_type in ("tv", "mix")

    # Fetch genres for the relevant media type(s)
    if media_type == "mix":
        movie_genres, tv_genres = await asyncio.gather(tmdb.get_genres(), tmdb.get_tv_genres())
        # Merge genres, preferring movie IDs for shared names
        genre_map = {}
        for g in tv_genres:
            genre_map[g["name"].lower()] = g["id"]
        for g in movie_genres:
            genre_map[g["name"].lower()] = g["id"]
        all_genre_names = sorted(genre_map.keys())
        genres = [{"id": genre_map[n], "name": n.title()} for n in all_genre_names]
    elif media_type == "tv":
        genres = await tmdb.get_tv_genres()
        genre_map = {g["name"].lower(): g["id"] for g in genres}
    else:
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

    # Use appropriate date field name for discover params
    # TMDB discover/tv uses first_air_date instead of primary_release_date
    date_gte = "first_air_date.gte" if media_type == "tv" else "primary_release_date.gte"
    date_lte = "first_air_date.lte" if media_type == "tv" else "primary_release_date.lte"
    date_year = "first_air_date_year" if media_type == "tv" else "primary_release_year"

    sections += [
        {
            "id": "new_this_year",
            "title": f"{current_year} Releases",
            "kind": "discover",
            "params": {date_year: current_year},
        },
        {
            "id": "recent_hits",
            "title": "Recent Hits",
            "kind": "discover",
            "params": {
                date_gte: f"{current_year - 1}-01-01",
                date_lte: f"{current_year}-12-31",
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
    ]

    # Runtime filters only apply to movies
    if is_movie:
        sections += [
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

    SECTION_CONFIG_CACHE[cache_key] = (time.time(), sections)
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


def _translate_movie_params_to_tv(params: dict) -> dict:
    """Translate movie-style TMDB discover params to TV-style equivalents."""
    tv_params = {}
    mapping = {
        "primary_release_date.gte": "first_air_date.gte",
        "primary_release_date.lte": "first_air_date.lte",
        "primary_release_year": "first_air_date_year",
    }
    for k, v in params.items():
        tv_params[mapping.get(k, k)] = v
    return tv_params


async def _fetch_section_page(section: dict, page: int, media_type: str = "movie") -> dict:
    """Fetch a single page of raw (unfiltered) results for a section."""
    kind = section.get("kind")

    if kind == "recently_added":
        catalogs = section.get("catalogs", [])
        section_countries = section.get("countries", [])
        show_type = "series" if media_type == "tv" else ("movie" if media_type == "movie" else None)
        data = await streaming_availability.get_recently_added(catalogs, section_countries, None, pages=1, show_type=show_type)
        return {"results": data.get("results", []), "next_cursor": data.get("next_cursor")}

    if kind == "trending":
        data = await tmdb.get_trending(time_window=section.get("time_window", "week"), page=page, media_type=media_type)
        for r in data.get("results", []):
            _normalize_result(r)
        return data

    params = dict(section.get("params", {}))
    if kind == "top_rated":
        params.update({"sort_by": "vote_average.desc", "vote_count.gte": 300})
    elif kind == "genre":
        params["with_genres"] = section.get("genre_id")
    elif kind == "discover":
        pass
    else:
        return {}

    if media_type == "mix":
        tv_params = _translate_movie_params_to_tv(params)
        movie_data, tv_data = await asyncio.gather(
            tmdb.discover(params, page=page),
            tmdb.discover_tv(tv_params, page=page),
        )
        movie_results = [_normalize_result(r) for r in movie_data.get("results", [])]
        tv_results = [_normalize_result(r) for r in tv_data.get("results", [])]
        combined = sorted(movie_results + tv_results, key=lambda x: x.get("popularity", 0), reverse=True)
        total_pages = max(movie_data.get("total_pages", 0), tv_data.get("total_pages", 0))
        return {"results": combined, "total_pages": total_pages}

    if media_type == "tv":
        tv_params = _translate_movie_params_to_tv(params)
        data = await tmdb.discover_tv(tv_params, page=page)
    else:
        data = await tmdb.discover(params, page=page)
    for r in data.get("results", []):
        _normalize_result(r)
    return data


def _normalize_country_code(country: str | None) -> str | None:
    if not country:
        return None
    code = country.strip().upper()
    if len(code) != 2 or not code.isalpha():
        return None
    return code


async def _guest_section_config(media_type: str, country: str) -> list[dict]:
    cache_key = f"guest:{media_type}:{country}"
    now = time.time()
    cached = SECTION_CONFIG_CACHE.get(cache_key)
    if cached and (now - cached[0]) < SECTION_CONFIG_TTL:
        return cached[1]

    base_params = {"watch_region": country}
    sections = [
        {"id": "trending_day", "title": "Trending Today", "kind": "trending", "time_window": "day"},
        {"id": "trending_week", "title": "Trending This Week", "kind": "trending", "time_window": "week"},
        {"id": "top_rated", "title": "Top Rated", "kind": "top_rated", "params": dict(base_params)},
    ]

    if media_type == "mix":
        movie_genres, tv_genres = await asyncio.gather(tmdb.get_genres(), tmdb.get_tv_genres())
        genre_map = {}
        for g in tv_genres:
            genre_map[g["name"].lower()] = g["id"]
        for g in movie_genres:
            genre_map[g["name"].lower()] = g["id"]
        genres = [{"id": genre_map[n], "name": n.title()} for n in sorted(genre_map.keys())]
    elif media_type == "tv":
        genres = await tmdb.get_tv_genres()
    else:
        genres = await tmdb.get_genres()

    for g in genres[:8]:
        sections.append(
            {
                "id": f"genre_{g['id']}",
                "title": g["name"],
                "kind": "genre",
                "genre_id": g["id"],
                "params": dict(base_params),
            }
        )

    SECTION_CONFIG_CACHE[cache_key] = (now, sections)
    return sections


async def _guest_home(page: int, page_size: int, media_type: str, country: str) -> dict:
    cache_key = f"guest:{country}:{page}:{page_size}:{media_type}"
    now = time.time()
    cached = HOME_CACHE.get(cache_key)
    if cached and (now - cached[0]) < HOME_CACHE_TTL:
        return cached[1]

    sections_config = await _guest_section_config(media_type, country)
    total_sections = len(sections_config)
    start = (page - 1) * page_size
    end = start + page_size
    slice_config = sections_config[start:end]

    async def build_guest_section(section: dict):
        data = await _fetch_section_page(section, 1, media_type)
        results = data.get("results", [])[:24]
        return {
            "id": section["id"],
            "title": section["title"],
            "results": results,
            "next_page": 2 if data.get("total_pages", 0) > 1 else None,
            "total_pages": data.get("total_pages", 0),
        }

    built = await asyncio.gather(*(build_guest_section(s) for s in slice_config))
    sections = [s for s in built if s.get("results")]
    has_more = end < total_sections
    payload = {
        "sections": sections,
        "filtered": False,
        "page": page,
        "page_size": page_size,
        "total_sections": total_sections,
        "has_more": has_more,
        "next_page": page + 1 if has_more else None,
    }
    HOME_CACHE[cache_key] = (time.time(), payload)
    return payload


async def _guest_section(section_id: str, page: int, pages: int, media_type: str, country: str) -> dict:
    pages = max(1, min(5, pages))
    cache_key = f"guest:{section_id}:{country}:{page}:{pages}:{media_type}"
    now = time.time()
    cached = SECTION_CACHE.get(cache_key)
    if cached and (now - cached[0]) < SECTION_CACHE_TTL:
        return cached[1]

    sections = await _guest_section_config(media_type, country)
    section_def = next((s for s in sections if s["id"] == section_id), None)
    if not section_def:
        return {"id": section_id, "results": [], "message": "Unknown section."}

    target_count = pages * 20
    results: list = []
    seen_ids: set[int] = set()
    total_pages = 0
    p = page
    scanned = 0
    last_page = page - 1
    while len(results) < target_count and scanned < pages:
        if total_pages and p > total_pages:
            break
        data = await _fetch_section_page(section_def, p, media_type)
        if not total_pages:
            total_pages = data.get("total_pages", 0)
        raw = data.get("results", [])
        if not raw:
            break
        for m in raw:
            mid = m.get("id")
            if not mid or mid in seen_ids:
                continue
            seen_ids.add(mid)
            results.append(m)
            if len(results) >= target_count:
                break
        last_page = p
        scanned += 1
        if total_pages and p >= total_pages:
            break
        p += 1

    next_page = last_page + 1 if total_pages and last_page < total_pages else None
    payload = {
        "id": section_id,
        "title": section_def["title"],
        "results": results[:target_count],
        "page": page,
        "next_page": next_page,
        "total_pages": total_pages,
        "filtered": False,
    }
    SECTION_CACHE[cache_key] = (time.time(), payload)
    return payload


@app.get("/api/home")
async def home(
    provider_ids: str | None = None,
    page: int = 1,
    page_size: int = 6,
    media_type: str = "mix",
    country: str | None = None,
    countries: str | None = None,
    unfiltered: bool = False,
    vpn: bool = False,
    include_paid: bool = False,
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    if media_type not in VALID_MEDIA_TYPES:
        media_type = "mix"
    prefs = await _get_user_prefs(db, user.id) if user else None
    if provider_ids:
        ids = {int(pid) for pid in provider_ids.split(",") if pid.strip().isdigit()}
    elif prefs:
        ids = set(prefs.provider_ids) if prefs.provider_ids else set()
    else:
        ids = set()
    user_countries = list(prefs.countries) if prefs and prefs.countries else []
    requested_countries = _normalize_country_codes(countries.split(",")) if countries else None

    guest_country = _normalize_country_code(country)
    if unfiltered:
        if not guest_country:
            fallback = user_countries[0] if user_countries else "US"
            guest_country = _normalize_country_code(fallback) or "US"
        page = max(1, page)
        page_size = max(3, min(10, page_size))
        return await _guest_home(page, page_size, media_type, guest_country)

    if not ids:
        if guest_country:
            page = max(1, page)
            page_size = max(3, min(10, page_size))
            return await _guest_home(page, page_size, media_type, guest_country)
        return {"sections": [], "filtered": True, "message": "Select streaming services to see available titles."}

    allowed_countries = (requested_countries or _normalize_country_codes(user_countries)) if not vpn else None
    section_countries = sorted(allowed_countries) if allowed_countries else user_countries
    country_scope_key = ",".join(sorted(allowed_countries)) if allowed_countries else "*"
    page = max(1, page)
    page_size = max(3, min(10, page_size))
    cache_key = f"{','.join(str(pid) for pid in sorted(ids))}:{','.join(user_countries)}:{page}:{page_size}:{media_type}:vpn={int(vpn)}:paid={int(include_paid)}:scope={country_scope_key}"
    now = time.time()
    cached = HOME_CACHE.get(cache_key)
    if cached and (now - cached[0]) < HOME_CACHE_TTL:
        return cached[1]
    sections_config = await _home_section_config(ids, section_countries, media_type)
    total_sections = len(sections_config)
    start = (page - 1) * page_size
    end = start + page_size
    slice_config = sections_config[start:end]

    TARGET_ROW = 24
    MAX_PAGES = 3
    semaphore = asyncio.Semaphore(FILTER_CONCURRENCY)
    flag_cache: dict[tuple[str, int, str], bool] = {}

    async def build_section(section: dict):
        if section.get("kind") == "recently_added":
            data = await _fetch_section_page(section, 1, media_type)
            raw = data.get("results", [])
            filtered = await _filter_results(
                raw,
                ids,
                semaphore,
                flag_cache,
                media_type,
                include_paid=include_paid,
                allowed_countries=allowed_countries,
            )
            results = filtered[:TARGET_ROW]
            return {
                "id": section["id"],
                "title": section["title"],
                "results": results,
                "next_cursor": data.get("next_cursor"),
            }
        results = []
        seen_ids = set()
        p = 1
        last_page = 0
        total_pages = 0
        while p <= MAX_PAGES and len(results) < TARGET_ROW:
            data = await _fetch_section_page(section, p, media_type)
            total_pages = data.get("total_pages") or total_pages
            raw = data.get("results", [])
            if not raw:
                break
            filtered = await _filter_results(
                raw,
                ids,
                semaphore,
                flag_cache,
                media_type,
                include_paid=include_paid,
                allowed_countries=allowed_countries,
            )
            for m in filtered:
                mid = m.get("id")
                if not mid or mid in seen_ids:
                    continue
                seen_ids.add(mid)
                results.append(m)
                if len(results) >= TARGET_ROW:
                    break
            last_page = p
            if total_pages and p >= total_pages:
                break
            p += 1
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
    media_type: str = "mix",
    country: str | None = None,
    countries: str | None = None,
    unfiltered: bool = False,
    vpn: bool = False,
    include_paid: bool = False,
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    if media_type not in VALID_MEDIA_TYPES:
        media_type = "mix"
    prefs = await _get_user_prefs(db, user.id) if user else None
    if provider_ids:
        ids = {int(pid) for pid in provider_ids.split(",") if pid.strip().isdigit()}
    elif prefs:
        ids = set(prefs.provider_ids) if prefs.provider_ids else set()
    else:
        ids = set()
    user_countries = list(prefs.countries) if prefs and prefs.countries else []
    requested_countries = _normalize_country_codes(countries.split(",")) if countries else None

    guest_country = _normalize_country_code(country)
    if unfiltered:
        if not guest_country:
            fallback = user_countries[0] if user_countries else "US"
            guest_country = _normalize_country_code(fallback) or "US"
        page = max(1, page)
        return await _guest_section(section_id, page, pages, media_type, guest_country)

    if not ids:
        if guest_country:
            page = max(1, page)
            return await _guest_section(section_id, page, pages, media_type, guest_country)
        return {"id": section_id, "results": [], "filtered": True, "message": "Select streaming services first."}

    allowed_countries = (requested_countries or _normalize_country_codes(user_countries)) if not vpn else None
    section_countries = sorted(allowed_countries) if allowed_countries else user_countries
    country_scope_key = ",".join(sorted(allowed_countries)) if allowed_countries else "*"
    cache_key = f"{section_id}:{','.join(str(pid) for pid in sorted(ids))}:{','.join(sorted(user_countries))}:{page}:{pages}:{cursor or ''}:{media_type}:vpn={int(vpn)}:paid={int(include_paid)}:scope={country_scope_key}"
    now = time.time()
    cached = SECTION_CACHE.get(cache_key)
    if cached and (now - cached[0]) < SECTION_CACHE_TTL:
        return cached[1]

    sections = await _home_section_config(ids, section_countries, media_type)
    section_def = next((s for s in sections if s["id"] == section_id), None)
    if not section_def:
        return {"id": section_id, "results": [], "filtered": True, "message": "Unknown section."}

    if section_def.get("kind") == "recently_added":
        semaphore = asyncio.Semaphore(FILTER_CONCURRENCY)
        flag_cache: dict[tuple[str, int, str], bool] = {}
        show_type = "series" if media_type == "tv" else ("movie" if media_type == "movie" else None)
        data = await streaming_availability.get_recently_added(
            section_def.get("catalogs", []),
            section_def.get("countries", []),
            cursor,
            pages=pages,
            show_type=show_type,
        )
        results = await _filter_results(
            data.get("results", []),
            ids,
            semaphore,
            flag_cache,
            media_type,
            include_paid=include_paid,
            allowed_countries=allowed_countries,
        )
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

    # Fetch raw results, filter each page, accumulate
    semaphore = asyncio.Semaphore(FILTER_CONCURRENCY)
    flag_cache: dict[tuple[str, int, str], bool] = {}
    pages = max(1, min(5, pages))
    target_count = pages * 20
    max_scan_pages = pages * 5
    results: list = []
    seen_ids: set = set()
    total_pages = 0
    last_page = page - 1
    scanned = 0
    p = page
    while len(results) < target_count:
        if total_pages and p > total_pages:
            break
        if scanned >= max_scan_pages:
            break
        data = await _fetch_section_page(section_def, p, media_type)
        if not total_pages:
            total_pages = data.get("total_pages", 0)
        filtered = await _filter_results(
            data.get("results", []),
            ids,
            semaphore,
            flag_cache,
            media_type,
            include_paid=include_paid,
            allowed_countries=allowed_countries,
        )
        for m in filtered:
            mid = m.get("id")
            if not mid or mid in seen_ids:
                continue
            seen_ids.add(mid)
            results.append(m)
            if len(results) >= target_count:
                break
        last_page = p
        scanned += 1
        if not data.get("results"):
            break
        if len(results) >= target_count:
            break
        p += 1
    next_page = last_page + 1 if total_pages and last_page < total_pages else None
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


@app.get("/api/geo")
async def geo(request: Request):
    """Detect user's country from IP address."""
    # Get client IP - check forwarded headers first (for proxies/tunnels)
    client_ip = (
        request.headers.get("CF-Connecting-IP")  # Cloudflare
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.headers.get("X-Real-IP")
        or (request.client.host if request.client else None)
    )
    if not client_ip or client_ip in ("127.0.0.1", "::1", "localhost"):
        return {"country": "US"}
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"http://ip-api.com/json/{client_ip}?fields=countryCode")
            if resp.status_code == 200:
                data = resp.json()
                country = data.get("countryCode", "US")
                if country and len(country) == 2:
                    return {"country": country.upper()}
    except Exception:
        pass
    return {"country": "US"}


@app.get("/api/config")
async def get_config(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    prefs = await _get_user_prefs(db, user.id)
    if not prefs:
        return {"provider_ids": [], "countries": []}
    return {"provider_ids": prefs.provider_ids or [], "countries": prefs.countries or [], "theme": prefs.theme or "dark"}


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

    if "theme" in data:
        prefs.theme = data["theme"] if data["theme"] in ("dark", "light") else "dark"

    await db.commit()
    return {"ok": True}


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
