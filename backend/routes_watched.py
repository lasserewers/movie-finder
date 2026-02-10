from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user
from .database import get_db
from .models import User, WatchedItem

router = APIRouter(prefix="/api/watched", tags=["watched"])


def _serialize_watched_item(item: WatchedItem) -> dict:
    return {
        "id": str(item.id),
        "tmdb_id": int(item.tmdb_id),
        "media_type": item.media_type,
        "title": item.title,
        "poster_path": item.poster_path,
        "release_date": item.release_date,
        "watched_at": item.watched_at.isoformat() if item.watched_at else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


class AddWatchedRequest(BaseModel):
    tmdb_id: int = Field(ge=1)
    media_type: Literal["movie", "tv"]
    title: str = Field(min_length=1, max_length=500)
    poster_path: str | None = Field(default=None, max_length=500)
    release_date: str | None = Field(default=None, max_length=40)


@router.get("")
async def list_watched(
    limit: int = Query(500, ge=1, le=2000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(WatchedItem)
            .where(WatchedItem.user_id == user.id)
            .order_by(WatchedItem.watched_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return {"results": [_serialize_watched_item(row) for row in rows]}


@router.post("")
async def add_watched_item(
    body: AddWatchedRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    normalized_title = body.title.strip()
    if not normalized_title:
        raise HTTPException(status_code=400, detail="Title is required")
    poster_path = (body.poster_path or "").strip() or None
    release_date = (body.release_date or "").strip() or None
    now = datetime.now(timezone.utc)

    existing = (
        await db.execute(
            select(WatchedItem).where(
                WatchedItem.user_id == user.id,
                WatchedItem.media_type == body.media_type,
                WatchedItem.tmdb_id == body.tmdb_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.title = normalized_title
        existing.poster_path = poster_path
        existing.release_date = release_date
        existing.watched_at = now
        await db.commit()
        return {"ok": True, "item": _serialize_watched_item(existing), "already_exists": True}

    item = WatchedItem(
        user_id=user.id,
        tmdb_id=body.tmdb_id,
        media_type=body.media_type,
        title=normalized_title,
        poster_path=poster_path,
        release_date=release_date,
        watched_at=now,
        created_at=now,
    )
    db.add(item)
    await db.commit()
    return {"ok": True, "item": _serialize_watched_item(item), "already_exists": False}


@router.delete("/{media_type}/{tmdb_id}")
async def remove_watched_item(
    media_type: Literal["movie", "tv"],
    tmdb_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if tmdb_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid tmdb id")
    row = (
        await db.execute(
            select(WatchedItem).where(
                WatchedItem.user_id == user.id,
                WatchedItem.media_type == media_type,
                WatchedItem.tmdb_id == tmdb_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        return {"ok": True, "removed": False}
    await db.delete(row)
    await db.commit()
    return {"ok": True, "removed": True}
