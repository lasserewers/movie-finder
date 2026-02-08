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
    page: int = 1,
    limit: int = Query(10, ge=1, le=40),
):
    if media_type not in VALID_MEDIA_TYPES:
        media_type = "movie"
    page = max(1, page)
    q_norm = q.strip().lower()
    cache_key = f"search:{media_type}:{limit}:{page}:{q_norm}"
    now = time.time()
    cached = SEARCH_CACHE.get(cache_key)
    if cached and (now - cached[0]) < SEARCH_CACHE_TTL:
        return cached[1]
    if media_type == "tv":
        data = await tmdb.search_tv(q, page=page)
        for r in data.get("results", []):
            _normalize_result(r)
        data["results"] = data.get("results", [])[:limit]
        data["page"] = page
        SEARCH_CACHE[cache_key] = (now, data)
        return data
    if media_type == "mix":
        movie_data, tv_data = await asyncio.gather(
            tmdb.search_movie(q, page=page),
            tmdb.search_tv(q, page=page),
        )
        movies = movie_data.get("results", [])
        tv_shows = tv_data.get("results", [])
        for r in movies:
            _normalize_result(r)
        for r in tv_shows:
            _normalize_result(r)
        combined = sorted(movies + tv_shows, key=lambda x: x.get("popularity", 0), reverse=True)[:limit]
        movie_data["results"] = combined
        movie_data["page"] = page
        movie_data["total_pages"] = max(movie_data.get("total_pages", 0), tv_data.get("total_pages", 0))
        movie_data["total_results"] = (movie_data.get("total_results") or 0) + (tv_data.get("total_results") or 0)
        SEARCH_CACHE[cache_key] = (now, movie_data)
        return movie_data
    data = await tmdb.search_movie(q, page=page)
    for r in data.get("results", []):
        _normalize_result(r)
    data["results"] = data.get("results", [])[:limit]
    data["page"] = page
    SEARCH_CACHE[cache_key] = (now, data)
    return data


@app.get("/api/search_page")
async def search_page(
    q: str = Query(..., min_length=1),
    media_type: str = "movie",
    page: int = 1,
    limit: int = Query(20, ge=1, le=40),
):
    if media_type not in VALID_MEDIA_TYPES:
        media_type = "movie"
    page = max(1, page)
    limit = max(1, min(40, limit))
    if media_type == "tv":
        data = await tmdb.search_tv(q, page=page)
        for r in data.get("results", []):
            _normalize_result(r)
            r["media_type"] = "tv"
        data["results"] = data.get("results", [])[:limit]
        data["page"] = page
        return data
    if media_type == "mix":
        movie_data, tv_data = await asyncio.gather(
            tmdb.search_movie(q, page=page),
            tmdb.search_tv(q, page=page),
        )
        movies = movie_data.get("results", [])
        tv_shows = tv_data.get("results", [])
        for r in movies:
            _normalize_result(r)
            r["media_type"] = "movie"
        for r in tv_shows:
            _normalize_result(r)
            r["media_type"] = "tv"
        combined = sorted(movies + tv_shows, key=lambda x: x.get("popularity", 0), reverse=True)[:limit]
        base = movie_data or tv_data or {"results": []}
        base["results"] = combined
        base["page"] = page
        base["total_pages"] = max(movie_data.get("total_pages", 0), tv_data.get("total_pages", 0))
        base["total_results"] = (movie_data.get("total_results") or 0) + (tv_data.get("total_results") or 0)
        return base
    data = await tmdb.search_movie(q, page=page)
    for r in data.get("results", []):
        _normalize_result(r)
        r["media_type"] = "movie"
    data["results"] = data.get("results", [])[:limit]
    data["page"] = page
    return data


@app.get("/api/search_filtered")
async def search_filtered(
    q: str = Query(..., min_length=1),
    provider_ids: str | None = None,
    media_type: str = "movie",
    limit: int = Query(20, ge=1, le=20),
    page: int = 1,
    paged: bool = False,
    countries: str | None = None,
    vpn: bool = False,
    include_paid: bool = False,
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
    if paged:
        return await search_filtered_page(
            q=q,
            provider_ids=provider_ids,
            media_type=media_type,
            page=page,
            limit=limit,
            countries=countries,
            vpn=vpn,
            include_paid=include_paid,
            user=user,
            db=db,
        )
    country_scope_key = ",".join(sorted(allowed_countries)) if allowed_countries else "*"
    cache_key = (
        f"search_filtered:{q.strip().lower()}:{media_type}:{target}:"
        f"{','.join(str(pid) for pid in sorted(ids))}:scope={country_scope_key}:paid={int(include_paid)}"
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
                    include_paid=include_paid,
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


@app.get("/api/search_filtered_page")
async def search_filtered_page(
    q: str = Query(..., min_length=1),
    provider_ids: str | None = None,
    media_type: str = "movie",
    page: int = 1,
    limit: int = Query(20, ge=1, le=40),
    countries: str | None = None,
    vpn: bool = False,
    include_paid: bool = False,
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    if media_type not in VALID_MEDIA_TYPES:
        media_type = "movie"
    page = max(1, page)
    limit = max(1, min(40, limit))
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
        return {"results": [], "filtered": True, "page": page, "total_pages": 0}
    semaphore = asyncio.Semaphore(FILTER_CONCURRENCY)
    flag_cache: dict[tuple[str, int, str], bool] = {}

    async def _search_and_filter_page(search_fn, mt: str):
        data = await search_fn(q, page=page)
        raw = data.get("results", [])
        for m in raw:
            _normalize_result(m)
            m["media_type"] = mt
        filtered = await _filter_results(
            raw,
            ids,
            semaphore,
            flag_cache,
            mt,
            include_paid=include_paid,
            allowed_countries=allowed_countries,
        )
        data["results"] = filtered[:limit]
        data["filtered"] = True
        data["page"] = page
        return data

    if media_type == "mix":
        data_m, data_t = await asyncio.gather(
            _search_and_filter_page(tmdb.search_movie, "movie"),
            _search_and_filter_page(tmdb.search_tv, "tv"),
        )
        combined = sorted(
            (data_m.get("results") or []) + (data_t.get("results") or []),
            key=lambda x: x.get("popularity", 0),
            reverse=True,
        )[:limit]
        base = data_m or data_t or {"results": []}
        base["results"] = combined
        base["filtered"] = True
        base["page"] = page
        base["total_pages"] = max(data_m.get("total_pages", 0), data_t.get("total_pages", 0))
        base["total_results"] = (data_m.get("total_results") or 0) + (data_t.get("total_results") or 0)
        return base

    search_fn = tmdb.search_tv if media_type == "tv" else tmdb.search_movie
    return await _search_and_filter_page(search_fn, media_type)


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


def _normalize_person_credit_item(item: dict) -> dict | None:
    media_type = item.get("media_type")
    if media_type not in ("movie", "tv"):
        return None
    item_id = item.get("id")
    if not item_id:
        return None
    title = item.get("title") or item.get("name") or item.get("original_title") or item.get("original_name") or ""
    release_date = item.get("release_date") or item.get("first_air_date") or ""
    if not title:
        return None
    return {
        "id": item_id,
        "title": title,
        "poster_path": item.get("poster_path"),
        "release_date": release_date,
        "media_type": media_type,
        "popularity": item.get("popularity") or 0,
        "vote_count": item.get("vote_count") or 0,
        "vote_average": item.get("vote_average") or 0,
        "genre_ids": item.get("genre_ids") or [],
        "role_details": [],
        "role_categories": [],
    }


UNSCRIPTED_TV_GENRE_IDS = {10763, 10764, 10767}  # News, Reality, Talk
AWARDS_EVENT_HINTS = (
    "award",
    "awards",
    "oscars",
    "academy awards",
    "golden globes",
    "emmy",
    "grammy",
    "bafta",
    "red carpet",
    "ceremony",
    "tony awards",
)


def _looks_like_self_role(role: str) -> bool:
    norm = role.strip().lower()
    if not norm:
        return False
    return (
        norm == "self"
        or norm.startswith("self ")
        or norm.endswith(" self")
        or "(self)" in norm
        or " as self" in norm
    )


ROLE_CATEGORY_PRIORITY = {
    "Actor": 0,
    "Director": 1,
    "Producer": 2,
    "Writer": 3,
    "Creator": 4,
    "Composer": 5,
    "Cinematographer": 6,
    "Editor": 7,
    "Self": 8,
    "Other": 9,
}


def _role_category_sort_key(role: str) -> tuple[int, str]:
    return (ROLE_CATEGORY_PRIORITY.get(role, 50), role.lower())


def _canonical_role_category(source: str, role: str | None) -> str:
    role_text = (role or "").strip()
    role_norm = role_text.lower()

    if source == "cast":
        if _looks_like_self_role(role_text):
            return "Self"
        return "Actor"

    if not role_text:
        return "Other"
    if "director" in role_norm:
        return "Director"
    if "producer" in role_norm:
        return "Producer"
    if role_norm in {"writer", "screenplay", "story", "teleplay", "novel", "characters", "adaptation"}:
        return "Writer"
    if any(k in role_norm for k in ("writer", "screenplay", "story", "teleplay", "adaptation")):
        return "Writer"
    if any(k in role_norm for k in ("creator", "created by")):
        return "Creator"
    if any(k in role_norm for k in ("composer", "music", "score")):
        return "Composer"
    if any(k in role_norm for k in ("cinematography", "director of photography", "photography")):
        return "Cinematographer"
    if "editor" in role_norm:
        return "Editor"
    if _looks_like_self_role(role_text):
        return "Self"

    return role_text


def _person_work_rank_score(item: dict, roles: list[str]) -> float:
    title = str(item.get("title") or "").lower()
    popularity = float(item.get("popularity") or 0)
    vote_average = float(item.get("vote_average") or 0)
    vote_count = int(item.get("vote_count") or 0)
    genre_ids = item.get("genre_ids") or []
    media_type = item.get("media_type")

    # Base quality signal.
    score = popularity + (vote_average * 4.0) + min(vote_count, 20000) / 220.0

    # Prefer substantive roles over interview/guest "Self" appearances.
    role_lowers = [r.lower() for r in roles if isinstance(r, str)]
    if any(_looks_like_self_role(r) for r in role_lowers):
        score -= 120.0

    # Push unscripted/news/talk items down, but keep them available.
    if media_type == "tv" and any(gid in UNSCRIPTED_TV_GENRE_IDS for gid in genre_ids):
        score -= 140.0

    # De-prioritize ceremony/special-event titles.
    if any(hint in title for hint in AWARDS_EVENT_HINTS):
        score -= 120.0

    # Slight preference toward movies and high-quality TV.
    if media_type == "movie":
        score += 10.0

    return score


@app.get("/api/person/{person_id}/works")
async def person_works(person_id: int):
    details, credits = await asyncio.gather(
        tmdb.get_person_details(person_id),
        tmdb.get_person_combined_credits(person_id),
    )

    works_by_key: dict[tuple[str, int], dict] = {}

    def _upsert(item: dict, role: str | None, source: str):
        normalized = _normalize_person_credit_item(item)
        if not normalized:
            return
        key = (normalized["media_type"], normalized["id"])
        existing = works_by_key.get(key)
        if not existing:
            works_by_key[key] = normalized
            existing = normalized

        category = _canonical_role_category(source, role)
        role_categories = existing["role_categories"]
        if category not in role_categories:
            role_categories.append(category)

        if role:
            role_details = existing["role_details"]
            if role not in role_details:
                role_details.append(role)

    for item in credits.get("cast", []) or []:
        _upsert(item, item.get("character"), "cast")
    for item in credits.get("crew", []) or []:
        _upsert(item, item.get("job"), "crew")

    works = list(works_by_key.values())
    for item in works:
        role_details = item.pop("role_details", [])
        role_categories = item.pop("role_categories", [])
        role_categories = sorted(role_categories, key=_role_category_sort_key) or ["Other"]
        item["role_summary"] = ", ".join(role_details[:3]) if role_details else ""
        item["role_categories"] = role_categories
        item["_rank_score"] = _person_work_rank_score(item, role_details)
        item.pop("genre_ids", None)

    works.sort(
        key=lambda x: (
            x.get("_rank_score", 0),
            x.get("release_date") or "",
            x.get("vote_count", 0),
            x.get("popularity", 0),
            x.get("vote_average", 0),
        ),
        reverse=True,
    )
    for item in works:
        item.pop("_rank_score", None)

    person = {
        "id": details.get("id"),
        "name": details.get("name") or "",
        "profile_path": details.get("profile_path"),
        "known_for_department": details.get("known_for_department") or "",
    }
    return {"person": person, "works": works}


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


def _discover_provider_filter_params(
    provider_ids: set[int],
    allowed_countries: set[str] | None,
    include_paid: bool,
) -> dict | None:
    """Build TMDB discover watch-provider params when we have a single explicit country."""
    if not provider_ids or not allowed_countries or len(allowed_countries) != 1:
        return None
    region = next(iter(allowed_countries))
    provider_expr = "|".join(str(pid) for pid in sorted(provider_ids))
    monetization = "flatrate|free|ads"
    if include_paid:
        monetization += "|rent|buy"
    return {
        "watch_region": region,
        "with_watch_providers": provider_expr,
        "with_watch_monetization_types": monetization,
    }


def _trending_discover_fallback_params(media_type: str, base_params: dict) -> dict:
    params = dict(base_params or {})
    recent_floor = (date.today() - timedelta(days=365)).isoformat()
    if media_type == "tv":
        params["first_air_date.gte"] = recent_floor
    else:
        params["primary_release_date.gte"] = recent_floor
    params["vote_count.gte"] = 50
    params["sort_by"] = "popularity.desc"
    return params


GENRE_PRIORITY_ORDER = [
    "Action",
    "Adventure",
    "Science Fiction",
    "Fantasy",
    "Thriller",
    "Crime",
    "Mystery",
    "Drama",
    "Comedy",
    "Romance",
    "Animation",
    "Family",
    "Documentary",
    "History",
    "War",
    "Horror",
    "Western",
    "Music",
    "TV Movie",
    "Action & Adventure",
    "Sci-Fi & Fantasy",
    "War & Politics",
    "Kids",
    "News",
    "Reality",
    "Talk",
    "Soap",
]


LANGUAGE_SPOTLIGHTS = [
    ("Korean Picks", "ko"),
    ("Japanese Stories", "ja"),
    ("Spanish Favorites", "es"),
    ("French Cinema", "fr"),
    ("Hindi Hits", "hi"),
    ("German Gems", "de"),
    ("Italian Classics", "it"),
    ("Portuguese Picks", "pt"),
    ("Turkish Dramas", "tr"),
    ("Chinese Stories", "zh"),
    ("Thai Picks", "th"),
    ("Swedish Hits", "sv"),
    ("Danish Gems", "da"),
    ("Norwegian Favorites", "no"),
    ("Polish Picks", "pl"),
    ("Arabic Stories", "ar"),
]


def _genre_priority(name: str) -> int:
    lowered = (name or "").strip().lower()
    for idx, genre_name in enumerate(GENRE_PRIORITY_ORDER):
        if lowered == genre_name.lower():
            return idx
    return len(GENRE_PRIORITY_ORDER) + 100


def _ordered_genres(genres: list[dict]) -> list[dict]:
    return sorted(
        genres,
        key=lambda g: (_genre_priority(g.get("name", "")), g.get("name", "").lower()),
    )


def _genre_expression(names: list[str], gid_lookup, op: str = "or") -> str | None:
    seen = set()
    ids = []
    for name in names:
        gid = gid_lookup(name)
        if not gid or gid in seen:
            continue
        seen.add(gid)
        ids.append(str(gid))
    if not ids:
        return None
    return ("|" if op == "or" else ",").join(ids)


def _build_exploration_discover_sections(media_type: str, gid_lookup, base_params: dict | None = None) -> list[dict]:
    base_params = dict(base_params or {})
    sections: list[dict] = []
    seen_ids: set[str] = set()

    current_year = date.today().year
    last_45_days = (date.today() - timedelta(days=45)).isoformat()
    last_365_days = (date.today() - timedelta(days=365)).isoformat()
    last_5_years = (date.today() - timedelta(days=365 * 5)).isoformat()

    date_gte = "first_air_date.gte" if media_type == "tv" else "primary_release_date.gte"
    date_lte = "first_air_date.lte" if media_type == "tv" else "primary_release_date.lte"
    date_year = "first_air_date_year" if media_type == "tv" else "primary_release_year"

    def add_discover(section_id: str, title: str, params: dict):
        if section_id in seen_ids:
            return
        merged = dict(base_params)
        merged.update(params or {})
        sections.append({"id": section_id, "title": title, "kind": "discover", "params": merged})
        seen_ids.add(section_id)

    def add_genre_discover(section_id: str, title: str, names: list[str], op: str = "or", extra: dict | None = None):
        expr = _genre_expression(names, gid_lookup, op)
        if not expr:
            return
        params = {"with_genres": expr}
        if extra:
            params.update(extra)
        add_discover(section_id, title, params)

    # Relevance-first categories.
    add_discover("new_this_year", f"{current_year} Releases", {date_year: current_year})
    add_discover("fresh_arrivals", "Fresh Arrivals", {date_gte: last_45_days, "sort_by": "popularity.desc"})
    add_discover("popular_now", "Popular Right Now", {"vote_count.gte": 250, "sort_by": "popularity.desc"})
    add_discover(
        "critically_acclaimed",
        "Critically Acclaimed",
        {"vote_average.gte": 7.6, "vote_count.gte": 1200, "sort_by": "vote_average.desc"},
    )
    add_discover(
        "top_rated_recent",
        "Top-Rated Recent Picks",
        {date_gte: last_5_years, "vote_average.gte": 7.0, "vote_count.gte": 500, "sort_by": "vote_average.desc"},
    )
    add_discover(
        "hidden_gems",
        "Hidden Gems",
        {"vote_average.gte": 7.2, "vote_count.gte": 80, "vote_count.lte": 700, "sort_by": "vote_average.desc"},
    )
    add_discover(
        "under_the_radar_recent",
        "Under-the-Radar Recent Picks",
        {
            date_gte: last_365_days,
            "vote_average.gte": 6.8,
            "vote_count.gte": 40,
            "vote_count.lte": 900,
            "sort_by": "vote_average.desc",
        },
    )
    add_discover(
        "global_breakouts",
        "Global Breakouts",
        {
            date_gte: last_5_years,
            "vote_count.gte": 500,
            "vote_count.lte": 4000,
            "sort_by": "popularity.desc",
        },
    )

    # Mood and intent categories.
    add_genre_discover("action_adventure_hits", "Action & Adventure Hits", ["Action", "Adventure"], op="and")
    add_genre_discover(
        "adrenaline_rush",
        "Adrenaline Rush",
        ["Action", "Thriller"],
        op="and",
        extra={"vote_count.gte": 200, "sort_by": "popularity.desc"},
    )
    add_genre_discover(
        "mystery_thrillers",
        "Mystery & Thriller Picks",
        ["Mystery", "Thriller"],
        op="and",
        extra={"vote_average.gte": 6.5, "sort_by": "vote_average.desc"},
    )
    add_genre_discover("crime_noir", "Crime Stories", ["Crime", "Drama"], op="and")
    add_genre_discover("fantasy_worlds", "Fantasy Worlds", ["Fantasy", "Adventure"], op="and")
    add_genre_discover(
        "sci_fi_frontiers",
        "Sci-Fi Frontiers",
        ["Science Fiction", "Sci-Fi & Fantasy"],
        op="or",
        extra={"vote_count.gte": 150},
    )
    add_genre_discover("war_history_epics", "War & History Epics", ["War", "History", "War & Politics"], op="or")
    add_genre_discover("heartfelt_dramas", "Heartfelt Dramas", ["Drama"], op="or", extra={"vote_average.gte": 6.8})
    add_genre_discover("romance_corner", "Romance Corner", ["Romance"], op="or")
    add_genre_discover("comedy_pick_me_up", "Comedy Pick-Me-Up", ["Comedy"], op="or")
    add_genre_discover("family_fun", "Family Fun", ["Family", "Animation", "Kids"], op="or")
    add_genre_discover("animation_highlights", "Animation Highlights", ["Animation"], op="or", extra={"vote_average.gte": 6.0})
    add_genre_discover("horror_after_dark", "Horror After Dark", ["Horror"], op="or")
    add_genre_discover("documentary_deep_dive", "Documentary Deep Dive", ["Documentary"], op="or")
    add_genre_discover("music_and_musicals", "Music & Musicals", ["Music"], op="or")
    add_genre_discover("western_frontier", "Western Frontier", ["Western"], op="or")

    # TV-heavy discovery shelves (skipped automatically if genres are unavailable).
    if media_type in ("tv", "mix"):
        add_genre_discover(
            "bingeworthy_series",
            "Binge-Worthy Series",
            ["Drama", "Crime", "Mystery"],
            op="or",
            extra={"vote_count.gte": 150, "vote_average.gte": 6.8},
        )
        add_genre_discover("docu_series", "Docu-Series", ["Documentary", "Crime"], op="or")
        add_genre_discover("political_intrigue", "Political Intrigue", ["War & Politics", "Drama"], op="or")
        add_genre_discover("reality_watch", "Reality Watch", ["Reality"], op="or")
        add_genre_discover("talk_variety", "Talk & Variety", ["Talk"], op="or")
        add_genre_discover("soap_serials", "Soap Serials", ["Soap"], op="or")

    # Decade shelves.
    for decade in (2020, 2010, 2000, 1990, 1980, 1970, 1960):
        add_discover(
            f"decade_{decade}s",
            f"{decade}s Essentials",
            {
                date_gte: f"{decade}-01-01",
                date_lte: f"{decade + 9}-12-31",
                "vote_count.gte": 120,
                "sort_by": "popularity.desc",
            },
        )

    # Language shelves.
    for label, code in LANGUAGE_SPOTLIGHTS:
        add_discover(
            f"langspot_{code}",
            f"International: {label}",
            {"with_original_language": code, "sort_by": "popularity.desc"},
        )

    # Runtime shelves for movie-only browsing.
    if media_type == "movie":
        add_discover("quick_watches", "Quick Watches", {"with_runtime.lte": 95, "vote_count.gte": 100})
        add_discover("movie_night_length", "Movie Night Length", {"with_runtime.gte": 95, "with_runtime.lte": 130})
        add_discover("epic_runtime", "Epic Runtime", {"with_runtime.gte": 150, "vote_count.gte": 250})

    return sections


def _item_row_key(item: dict, fallback_media_type: str = "movie") -> tuple[str, int] | None:
    item_id = item.get("id")
    if not item_id:
        return None
    media = item.get("media_type")
    if media not in ("movie", "tv"):
        media = "tv" if fallback_media_type == "tv" else "movie"
    try:
        return (media, int(item_id))
    except (TypeError, ValueError):
        return None


def _diversify_sections(sections: list[dict], media_type: str, per_section_limit: int = 24) -> list[dict]:
    global_seen: set[tuple[str, int]] = set()
    diversified: list[dict] = []
    for section in sections:
        original_results = section.get("results") or []
        section_seen: set[tuple[str, int]] = set()
        unique_results = []
        for item in original_results:
            key = _item_row_key(item, fallback_media_type=media_type)
            if not key:
                continue
            if key in section_seen:
                continue
            section_seen.add(key)
            if key in global_seen:
                continue
            global_seen.add(key)
            unique_results.append(item)
            if len(unique_results) >= per_section_limit:
                break

        # Backfill from section-local pool to avoid rows becoming too short.
        if len(unique_results) < per_section_limit:
            used = {
                _item_row_key(item, fallback_media_type=media_type)
                for item in unique_results
            }
            for item in original_results:
                key = _item_row_key(item, fallback_media_type=media_type)
                if not key or key in used:
                    continue
                unique_results.append(item)
                used.add(key)
                if len(unique_results) >= per_section_limit:
                    break

        if not unique_results:
            continue
        updated = dict(section)
        updated["results"] = unique_results[:per_section_limit]
        diversified.append(updated)
    return diversified


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

    sections: list[dict] = [
        {"id": "trending_day", "title": "Trending Today", "kind": "trending", "time_window": "day"},
        {"id": "top_rated", "title": "Top Rated", "kind": "top_rated"},
    ]
    recently_section = {"id": "recently_added", "title": "Recently Added to Streaming", "kind": "recently_added"}

    if provider_ids:
        catalogs = await _resolve_streaming_catalogs(provider_ids)
        recently_section["catalogs"] = catalogs
        recently_section["countries"] = countries or []

    sections.extend(_build_exploration_discover_sections(media_type, gid))
    sections.append(recently_section)

    seen_ids = {s["id"] for s in sections}
    for g in _ordered_genres(genres):
        sid = f"genre_{g['id']}"
        if sid in seen_ids:
            continue
        sections.append({"id": sid, "title": f"Genre: {g['name']}", "kind": "genre", "genre_id": g["id"]})
        seen_ids.add(sid)

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

    genre_map = {g["name"].lower(): g["id"] for g in genres}

    def gid(name: str):
        return genre_map.get(name.lower())

    sections.extend(_build_exploration_discover_sections(media_type, gid, base_params=base_params))

    seen_ids = {s["id"] for s in sections}
    for g in _ordered_genres(genres):
        sid = f"genre_{g['id']}"
        if sid in seen_ids:
            continue
        sections.append(
            {
                "id": sid,
                "title": f"Genre: {g['name']}",
                "kind": "genre",
                "genre_id": g["id"],
                "params": dict(base_params),
            }
        )
        seen_ids.add(sid)

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
    row_limit = 24
    pool_target = 40
    max_scan_pages = 10
    section_build_concurrency = 3

    async def build_guest_section_pool(section: dict):
        pool: list[dict] = []
        seen: set[tuple[str, int]] = set()
        total_pages = 0
        p = 1
        scanned = 0
        while len(pool) < pool_target and scanned < max_scan_pages:
            if total_pages and p > total_pages:
                break
            data = await _fetch_section_page(section, p, media_type)
            total_pages = data.get("total_pages") or total_pages
            raw = data.get("results", [])
            if not raw:
                break
            for m in raw:
                key = _item_row_key(m, fallback_media_type=media_type)
                if not key or key in seen:
                    continue
                seen.add(key)
                pool.append(m)
                if len(pool) >= pool_target:
                    break
            scanned += 1
            if total_pages and p >= total_pages:
                break
            p += 1
        next_page = p if total_pages and p <= total_pages else None
        return {
            "id": section["id"],
            "title": section["title"],
            "results": pool,
            "next_page": next_page,
            "total_pages": total_pages,
        }

    sem = asyncio.Semaphore(section_build_concurrency)

    async def run_guest_build(section: dict):
        async with sem:
            return await build_guest_section_pool(section)

    pools = await asyncio.gather(*(run_guest_build(s) for s in slice_config))
    pools = [p for p in pools if p.get("results")]
    sections = _diversify_sections(pools, media_type, per_section_limit=row_limit)

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

    row_limit = 24
    pool_target = 48
    max_scan_pages = 12
    extra_max_scan_pages = 60
    recently_added_pages = 2
    section_build_concurrency = 3
    semaphore = asyncio.Semaphore(FILTER_CONCURRENCY)
    flag_cache: dict[tuple[str, int, str], bool] = {}
    discover_provider_params = _discover_provider_filter_params(ids, allowed_countries, include_paid)

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

    async def build_section_pool(section: dict) -> dict:
        section_payload = {"id": section["id"], "title": section["title"]}
        kind = section.get("kind")
        use_trending_discover_fallback = bool(discover_provider_params and kind == "trending")
        use_fast_discover_filter = bool(
            discover_provider_params and (kind in ("top_rated", "genre", "discover") or use_trending_discover_fallback)
        )
        section_for_fetch = section
        if use_trending_discover_fallback:
            section_for_fetch = {
                "id": section["id"],
                "title": section["title"],
                "kind": "discover",
                "params": _trending_discover_fallback_params(media_type, discover_provider_params or {}),
            }
        elif use_fast_discover_filter:
            section_for_fetch = dict(section)
            merged_params = dict(section.get("params", {}))
            merged_params.update(discover_provider_params or {})
            section_for_fetch["params"] = merged_params
        section_pool_target = pool_target
        if kind == "trending":
            section_pool_target = row_limit
        elif kind == "recently_added":
            section_pool_target = max(row_limit, 32)
        elif use_fast_discover_filter:
            section_pool_target = max(row_limit, 36)
        section_max_scan_pages = max_scan_pages
        if kind == "trending":
            section_max_scan_pages = 4 if use_trending_discover_fallback else 10
        elif use_fast_discover_filter:
            section_max_scan_pages = 4
        section_extra_max_scan_pages = extra_max_scan_pages
        if kind == "trending":
            section_extra_max_scan_pages = 12 if use_trending_discover_fallback else 20
        elif use_fast_discover_filter:
            section_extra_max_scan_pages = 12
        pool: list[dict] = []
        section_seen: set[tuple[str, int]] = set()

        def add_to_pool(items: list[dict], limit: int):
            for item in items:
                key = _item_row_key(item, fallback_media_type=media_type)
                if not key or key in section_seen:
                    continue
                section_seen.add(key)
                pool.append(item)
                if len(pool) >= limit:
                    break

        if kind == "recently_added":
            catalogs = section.get("catalogs", [])
            show_type = "series" if media_type == "tv" else ("movie" if media_type == "movie" else None)
            data = await streaming_availability.get_recently_added(
                catalogs,
                section.get("countries", []),
                None,
                pages=recently_added_pages,
                show_type=show_type,
            )
            # Catalog-scoped recent changes are already provider-filtered upstream.
            if catalogs:
                filtered = data.get("results", [])
            else:
                filtered = await _filter_results(
                    data.get("results", []),
                    ids,
                    semaphore,
                    flag_cache,
                    media_type,
                    include_paid=include_paid,
                    allowed_countries=allowed_countries,
                )
            add_to_pool(filtered, section_pool_target)
            section_payload["next_cursor"] = data.get("next_cursor")
            section_payload["results"] = pool
            return section_payload

        p = 1
        scanned = 0
        total_pages = 0
        while len(pool) < section_pool_target and scanned < section_max_scan_pages:
            if total_pages and p > total_pages:
                break
            data = await _fetch_section_page(section_for_fetch, p, media_type)
            total_pages = data.get("total_pages") or total_pages
            raw = data.get("results", [])
            if not raw:
                break
            if use_fast_discover_filter:
                filtered = raw
            else:
                filtered = await _filter_results(
                    raw,
                    ids,
                    semaphore,
                    flag_cache,
                    media_type,
                    include_paid=include_paid,
                    allowed_countries=allowed_countries,
                )
            add_to_pool(filtered, section_pool_target)
            scanned += 1
            if total_pages and p >= total_pages:
                break
            p += 1

        # For sparse rows, scan deeper but only until the row can be filled.
        while len(pool) < row_limit and scanned < section_extra_max_scan_pages:
            if total_pages and p > total_pages:
                break
            data = await _fetch_section_page(section_for_fetch, p, media_type)
            total_pages = data.get("total_pages") or total_pages
            raw = data.get("results", [])
            if not raw:
                break
            if use_fast_discover_filter:
                filtered = raw
            else:
                filtered = await _filter_results(
                    raw,
                    ids,
                    semaphore,
                    flag_cache,
                    media_type,
                    include_paid=include_paid,
                    allowed_countries=allowed_countries,
                )
            add_to_pool(filtered, row_limit)
            scanned += 1
            if total_pages and p >= total_pages:
                break
            p += 1

        section_payload["results"] = pool
        section_payload["next_page"] = p if total_pages and p <= total_pages else None
        section_payload["total_pages"] = total_pages
        return section_payload

    sem = asyncio.Semaphore(section_build_concurrency)

    async def run_build(section: dict) -> dict:
        async with sem:
            return await build_section_pool(section)

    pools = await asyncio.gather(*(run_build(section) for section in slice_config))
    pools = [pool for pool in pools if pool.get("results")]
    sections = _diversify_sections(pools, media_type, per_section_limit=row_limit)

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
    discover_provider_params = _discover_provider_filter_params(ids, allowed_countries, include_paid)

    if section_def.get("kind") == "recently_added":
        semaphore = asyncio.Semaphore(FILTER_CONCURRENCY)
        flag_cache: dict[tuple[str, int, str], bool] = {}
        catalogs = section_def.get("catalogs", [])
        show_type = "series" if media_type == "tv" else ("movie" if media_type == "movie" else None)
        data = await streaming_availability.get_recently_added(
            catalogs,
            section_def.get("countries", []),
            cursor,
            pages=pages,
            show_type=show_type,
        )
        if catalogs:
            results = data.get("results", [])
        else:
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
    use_trending_discover_fallback = bool(discover_provider_params and section_def.get("kind") == "trending")
    use_fast_discover_filter = bool(
        discover_provider_params and (section_def.get("kind") in ("top_rated", "genre", "discover") or use_trending_discover_fallback)
    )
    section_for_fetch = section_def
    if use_trending_discover_fallback:
        section_for_fetch = {
            "id": section_def["id"],
            "title": section_def["title"],
            "kind": "discover",
            "params": _trending_discover_fallback_params(media_type, discover_provider_params or {}),
        }
    elif use_fast_discover_filter:
        section_for_fetch = dict(section_def)
        merged_params = dict(section_def.get("params", {}))
        merged_params.update(discover_provider_params or {})
        section_for_fetch["params"] = merged_params
    p = page
    while len(results) < target_count:
        if total_pages and p > total_pages:
            break
        if scanned >= max_scan_pages:
            break
        data = await _fetch_section_page(section_for_fetch, p, media_type)
        if not total_pages:
            total_pages = data.get("total_pages", 0)
        if use_fast_discover_filter:
            filtered = data.get("results", [])
        else:
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
