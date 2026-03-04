"""Plex library integration endpoints + background sync."""

import asyncio
import secrets
import time
import uuid as _uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import plex
from .auth import get_current_premium_user
from .database import async_session, get_db
from .models import PlexLibraryItem, User, UserPreferences

router = APIRouter(prefix="/api/plex", tags=["plex"])

# ---------------------------------------------------------------------------
# In-memory cache of Plex TMDB IDs per user for fast filter checks
# ---------------------------------------------------------------------------
_plex_tmdb_cache: dict[_uuid.UUID, tuple[float, set[int]]] = {}
PLEX_CACHE_TTL = 10 * 60  # 10 minutes


async def get_plex_tmdb_ids(db: AsyncSession, user_id: _uuid.UUID) -> set[int]:
    """Get cached set of TMDB IDs in user's Plex library."""
    now = time.time()
    cached = _plex_tmdb_cache.get(user_id)
    if cached and (now - cached[0]) < PLEX_CACHE_TTL:
        return cached[1]
    result = await db.execute(
        select(PlexLibraryItem.tmdb_id).where(PlexLibraryItem.user_id == user_id)
    )
    ids = set(result.scalars().all())
    _plex_tmdb_cache[user_id] = (now, ids)
    return ids


def invalidate_plex_cache(user_id: _uuid.UUID):
    _plex_tmdb_cache.pop(user_id, None)


# ---------------------------------------------------------------------------
# Webhook debounce: at most one sync per user per 5 minutes
# ---------------------------------------------------------------------------
_webhook_last_sync: dict[_uuid.UUID, float] = {}
WEBHOOK_DEBOUNCE = 5 * 60  # 5 minutes


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_prefs(db: AsyncSession, user_id: _uuid.UUID) -> UserPreferences | None:
    result = await db.execute(select(UserPreferences).where(UserPreferences.user_id == user_id))
    return result.scalar_one_or_none()


async def _ensure_prefs(db: AsyncSession, user_id: _uuid.UUID) -> UserPreferences:
    prefs = await _get_prefs(db, user_id)
    if not prefs:
        prefs = UserPreferences(user_id=user_id)
        db.add(prefs)
        await db.flush()
    return prefs


# ---------------------------------------------------------------------------
# Background sync task
# ---------------------------------------------------------------------------

async def _run_plex_sync(user_id: _uuid.UUID):
    """Background task that syncs user's Plex library to DB."""
    async with async_session() as db:
        try:
            prefs = await _get_prefs(db, user_id)
            if not prefs or not prefs.plex_server_uri or not prefs.plex_server_token:
                return

            section_keys = (prefs.plex_library_section_ids or "").split(",")
            all_items: list[dict] = []
            for key in section_keys:
                key = key.strip()
                if not key:
                    continue
                try:
                    items = await plex.get_library_items(
                        prefs.plex_server_uri, prefs.plex_server_token, key
                    )
                    all_items.extend(items)
                except Exception:
                    # Skip unreachable sections but continue with others
                    continue

            # Clear existing items and bulk insert
            await db.execute(delete(PlexLibraryItem).where(PlexLibraryItem.user_id == user_id))
            for item in all_items:
                db.add(PlexLibraryItem(
                    user_id=user_id,
                    tmdb_id=item["tmdb_id"],
                    media_type=item["media_type"],
                    plex_title=item["title"],
                    plex_rating_key=item["rating_key"],
                ))

            prefs.plex_sync_status = "ok"
            prefs.plex_sync_message = f"Synced {len(all_items)} items"
            prefs.plex_last_sync_at = datetime.now(timezone.utc)
            prefs.plex_item_count = len(all_items)
            await db.commit()

            # Update in-memory cache
            _plex_tmdb_cache[user_id] = (time.time(), {i["tmdb_id"] for i in all_items})

        except Exception as e:
            try:
                prefs = await _get_prefs(db, user_id)
                if prefs:
                    prefs.plex_sync_status = "error"
                    prefs.plex_sync_message = str(e)[:500]
                    await db.commit()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/status")
async def plex_status(
    user: User = Depends(get_current_premium_user),
    db: AsyncSession = Depends(get_db),
):
    prefs = await _get_prefs(db, user.id)
    return {
        "connected": bool(prefs and prefs.plex_token),
        "server_name": prefs.plex_server_name if prefs else None,
        "item_count": prefs.plex_item_count if prefs else None,
        "sync_status": prefs.plex_sync_status if prefs else None,
        "sync_message": prefs.plex_sync_message if prefs else None,
        "last_sync_at": (
            prefs.plex_last_sync_at.isoformat()
            if prefs and prefs.plex_last_sync_at
            else None
        ),
        "webhook_secret": prefs.plex_webhook_secret if prefs else None,
    }


@router.post("/auth/pin")
async def plex_auth_pin(
    data: dict,
    user: User = Depends(get_current_premium_user),
):
    redirect_uri = data.get("redirect_uri", "")
    pin_data = await plex.create_pin()
    auth_url = plex.build_auth_url(pin_data["code"], redirect_uri)
    return {"pin_id": pin_data["pin_id"], "auth_url": auth_url}


@router.post("/auth/callback")
async def plex_auth_callback(
    data: dict,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_premium_user),
    db: AsyncSession = Depends(get_db),
):
    pin_id = data.get("pin_id")
    if not pin_id:
        raise HTTPException(400, "pin_id required")

    token = await plex.check_pin(int(pin_id))
    if not token:
        return {"authenticated": False}

    # Save token and discover servers
    prefs = await _ensure_prefs(db, user.id)
    prefs.plex_token = token
    if not prefs.plex_webhook_secret:
        prefs.plex_webhook_secret = secrets.token_urlsafe(32)

    sections: list[dict] = []
    servers = await plex.get_servers(token)
    if servers:
        server = servers[0]
        prefs.plex_server_name = server["name"]
        prefs.plex_server_uri = server["uri"]
        prefs.plex_server_token = server["access_token"]
        prefs.plex_machine_id = server["machine_id"]
        try:
            sections = await plex.get_library_sections(server["uri"], server["access_token"])
        except Exception:
            sections = []
        prefs.plex_library_section_ids = ",".join(s["key"] for s in sections)

    await db.commit()

    # Auto-trigger initial sync
    if sections:
        prefs.plex_sync_status = "syncing"
        prefs.plex_sync_message = "Starting initial sync..."
        await db.commit()
        background_tasks.add_task(_run_plex_sync, user.id)

    return {
        "authenticated": True,
        "server_name": prefs.plex_server_name,
        "sections": sections,
    }


@router.post("/sync")
async def plex_sync(
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_premium_user),
    db: AsyncSession = Depends(get_db),
):
    prefs = await _get_prefs(db, user.id)
    if not prefs or not prefs.plex_token:
        raise HTTPException(400, "Plex not connected")
    if prefs.plex_sync_status == "syncing":
        return {"ok": True, "message": "Sync already in progress"}

    prefs.plex_sync_status = "syncing"
    prefs.plex_sync_message = "Starting sync..."
    await db.commit()
    background_tasks.add_task(_run_plex_sync, user.id)
    return {"ok": True, "message": "Sync started"}


@router.delete("/disconnect")
async def plex_disconnect(
    user: User = Depends(get_current_premium_user),
    db: AsyncSession = Depends(get_db),
):
    prefs = await _get_prefs(db, user.id)
    if prefs:
        prefs.plex_token = None
        prefs.plex_server_name = None
        prefs.plex_server_uri = None
        prefs.plex_server_token = None
        prefs.plex_machine_id = None
        prefs.plex_library_section_ids = None
        prefs.plex_sync_status = None
        prefs.plex_sync_message = None
        prefs.plex_last_sync_at = None
        prefs.plex_item_count = None
        prefs.plex_webhook_secret = None
    await db.execute(delete(PlexLibraryItem).where(PlexLibraryItem.user_id == user.id))
    await db.commit()
    invalidate_plex_cache(user.id)
    _webhook_last_sync.pop(user.id, None)
    return {"ok": True}


@router.post("/webhook/{secret}")
async def plex_webhook(secret: str, request: Request):
    """Unauthenticated endpoint for Plex server webhooks.

    Plex sends multipart/form-data with a 'payload' JSON field.
    We match by webhook secret, debounce, and trigger a background sync.
    """
    # Look up user by webhook secret
    async with async_session() as db:
        result = await db.execute(
            select(UserPreferences).where(UserPreferences.plex_webhook_secret == secret)
        )
        prefs = result.scalar_one_or_none()
        if not prefs or not prefs.plex_token:
            return {"ok": False}

        user_id = prefs.user_id

        # Debounce: skip if synced recently
        now = time.time()
        last = _webhook_last_sync.get(user_id, 0)
        if (now - last) < WEBHOOK_DEBOUNCE:
            return {"ok": True, "message": "Debounced"}

        # Mark sync in progress and launch background task
        _webhook_last_sync[user_id] = now
        prefs.plex_sync_status = "syncing"
        prefs.plex_sync_message = "Webhook-triggered sync..."
        await db.commit()

    # Run sync in background (not using BackgroundTasks since this is not a normal request handler dependency)
    asyncio.create_task(_run_plex_sync(user_id))
    return {"ok": True, "message": "Sync triggered"}
