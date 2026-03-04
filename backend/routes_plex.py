"""Plex library integration endpoints + background sync."""

import asyncio
import logging
import secrets
import time
import uuid as _uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
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
PLEX_CACHE_TTL = 2 * 60  # 2 minutes


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
WEBHOOK_DEBOUNCE = 30  # 30 seconds (incremental sync is fast)


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
# Background sync helpers
# ---------------------------------------------------------------------------

UPSERT_BATCH_SIZE = 200


async def _bulk_upsert_plex_items(db: AsyncSession, user_id: _uuid.UUID, items: list[dict]):
    """Upsert Plex items in batches, then delete stale rows."""
    seen_keys: set[tuple[int, str]] = set()
    deduped: list[dict] = []
    for item in items:
        key = (item["tmdb_id"], item["media_type"])
        if key not in seen_keys:
            seen_keys.add(key)
            deduped.append(item)

    # Batch upsert
    for i in range(0, len(deduped), UPSERT_BATCH_SIZE):
        batch = deduped[i : i + UPSERT_BATCH_SIZE]
        insert_stmt = pg_insert(PlexLibraryItem).values([
            {
                "user_id": user_id,
                "tmdb_id": item["tmdb_id"],
                "media_type": item["media_type"],
                "plex_title": item["title"],
                "plex_rating_key": item["rating_key"],
            }
            for item in batch
        ])
        stmt = insert_stmt.on_conflict_do_update(
            constraint="uq_plex_library_user_tmdb_media",
            set_={
                "plex_title": insert_stmt.excluded.plex_title,
                "plex_rating_key": insert_stmt.excluded.plex_rating_key,
            },
        )
        await db.execute(stmt)

    # Bulk delete stale rows
    if seen_keys:
        existing = await db.execute(
            select(PlexLibraryItem.id, PlexLibraryItem.tmdb_id, PlexLibraryItem.media_type)
            .where(PlexLibraryItem.user_id == user_id)
        )
        stale_ids = [
            row.id for row in existing.all()
            if (row.tmdb_id, row.media_type) not in seen_keys
        ]
        if stale_ids:
            await db.execute(
                delete(PlexLibraryItem).where(PlexLibraryItem.id.in_(stale_ids))
            )
    else:
        await db.execute(delete(PlexLibraryItem).where(PlexLibraryItem.user_id == user_id))


async def _fetch_all_sections(server_uri: str, server_token: str, section_keys: list[str]) -> list[dict]:
    """Fetch all library sections in parallel."""
    async def fetch_one(key: str) -> list[dict]:
        try:
            return await plex.get_library_items(server_uri, server_token, key)
        except Exception:
            return []

    results = await asyncio.gather(*(fetch_one(k) for k in section_keys))
    all_items: list[dict] = []
    for items in results:
        all_items.extend(items)
    return all_items


# ---------------------------------------------------------------------------
# Background sync tasks
# ---------------------------------------------------------------------------

async def _run_plex_sync(user_id: _uuid.UUID):
    """Full background sync — re-fetches entire Plex library."""
    async with async_session() as db:
        try:
            prefs = await _get_prefs(db, user_id)
            if not prefs or not prefs.plex_server_uri or not prefs.plex_server_token:
                return

            section_keys = [k.strip() for k in (prefs.plex_library_section_ids or "").split(",") if k.strip()]
            all_items = await _fetch_all_sections(prefs.plex_server_uri, prefs.plex_server_token, section_keys)

            await _bulk_upsert_plex_items(db, user_id, all_items)

            prefs.plex_sync_status = "ok"
            prefs.plex_sync_message = f"Synced {len(all_items)} items"
            prefs.plex_last_sync_at = datetime.now(timezone.utc)
            prefs.plex_item_count = len(all_items)
            await db.commit()

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


async def _run_plex_incremental_sync(user_id: _uuid.UUID):
    """Fast incremental sync — fetches only recently added items."""
    async with async_session() as db:
        try:
            prefs = await _get_prefs(db, user_id)
            if not prefs or not prefs.plex_server_uri or not prefs.plex_server_token:
                return

            section_keys = [k.strip() for k in (prefs.plex_library_section_ids or "").split(",") if k.strip()]

            # Fetch recently added from all sections in parallel
            async def fetch_recent(key: str) -> list[dict]:
                try:
                    return await plex.get_recently_added(prefs.plex_server_uri, prefs.plex_server_token, key)
                except Exception:
                    return []

            results = await asyncio.gather(*(fetch_recent(k) for k in section_keys))
            new_items: list[dict] = []
            for items in results:
                new_items.extend(items)

            if not new_items:
                prefs.plex_sync_status = "ok"
                prefs.plex_sync_message = "No new items found"
                await db.commit()
                return

            # Upsert only the new items (no stale-item deletion — full sync handles that)
            seen_keys: set[tuple[int, str]] = set()
            deduped: list[dict] = []
            for item in new_items:
                key = (item["tmdb_id"], item["media_type"])
                if key not in seen_keys:
                    seen_keys.add(key)
                    deduped.append(item)

            insert_stmt = pg_insert(PlexLibraryItem).values([
                {
                    "user_id": user_id,
                    "tmdb_id": item["tmdb_id"],
                    "media_type": item["media_type"],
                    "plex_title": item["title"],
                    "plex_rating_key": item["rating_key"],
                }
                for item in deduped
            ])
            stmt = insert_stmt.on_conflict_do_update(
                constraint="uq_plex_library_user_tmdb_media",
                set_={
                    "plex_title": insert_stmt.excluded.plex_title,
                    "plex_rating_key": insert_stmt.excluded.plex_rating_key,
                },
            )
            await db.execute(stmt)

            # Update item count
            count_result = await db.execute(
                select(PlexLibraryItem.id).where(PlexLibraryItem.user_id == user_id)
            )
            total = len(count_result.all())

            prefs.plex_sync_status = "ok"
            prefs.plex_sync_message = f"Added {len(deduped)} new items ({total} total)"
            prefs.plex_last_sync_at = datetime.now(timezone.utc)
            prefs.plex_item_count = total
            await db.commit()

            # Update cache: add new IDs to existing set
            cached = _plex_tmdb_cache.get(user_id)
            if cached:
                new_ids = cached[1] | {i["tmdb_id"] for i in deduped}
                _plex_tmdb_cache[user_id] = (time.time(), new_ids)
            else:
                invalidate_plex_cache(user_id)

            logger.info("Plex incremental sync done for user %s: %d new items", user_id, len(deduped))

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
    invalidate_plex_cache(user.id)
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
    logger.info("Plex webhook received (secret=%s...)", secret[:8])

    # Look up user by webhook secret
    async with async_session() as db:
        result = await db.execute(
            select(UserPreferences).where(UserPreferences.plex_webhook_secret == secret)
        )
        prefs = result.scalar_one_or_none()
        if not prefs or not prefs.plex_token:
            logger.warning("Plex webhook: no matching user for secret=%s...", secret[:8])
            return {"ok": False}

        user_id = prefs.user_id

        # Debounce: skip if synced recently
        now = time.time()
        last = _webhook_last_sync.get(user_id, 0)
        if (now - last) < WEBHOOK_DEBOUNCE:
            logger.info("Plex webhook debounced for user %s", user_id)
            return {"ok": True, "message": "Debounced"}

        # Mark sync in progress and launch background task
        _webhook_last_sync[user_id] = now
        prefs.plex_sync_status = "syncing"
        prefs.plex_sync_message = "Webhook-triggered sync..."
        await db.commit()

    # Invalidate cache immediately so requests during sync hit the DB
    invalidate_plex_cache(user_id)
    logger.info("Plex webhook triggering incremental sync for user %s", user_id)
    asyncio.create_task(_run_plex_incremental_sync(user_id))
    return {"ok": True, "message": "Sync triggered"}
