from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user
from .database import get_db
from .models import User, UserList, UserListItem

router = APIRouter(prefix="/api/lists", tags=["lists"])


def _normalize_list_name(name: str) -> str:
    return " ".join(name.strip().split())


def _serialize_list_summary(list_row: UserList, item_count: int = 0) -> dict:
    return {
        "id": str(list_row.id),
        "name": list_row.name,
        "item_count": int(item_count),
        "created_at": list_row.created_at.isoformat() if list_row.created_at else None,
        "updated_at": list_row.updated_at.isoformat() if list_row.updated_at else None,
    }


def _serialize_list_item(item: UserListItem) -> dict:
    return {
        "id": str(item.id),
        "tmdb_id": int(item.tmdb_id),
        "media_type": item.media_type,
        "title": item.title,
        "poster_path": item.poster_path,
        "release_date": item.release_date,
        "sort_index": int(item.sort_index or 0),
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


async def _get_user_list_or_404(db: AsyncSession, user_id, list_id: UUID) -> UserList:
    list_row = (
        await db.execute(
            select(UserList).where(
                UserList.id == list_id,
                UserList.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if not list_row:
        raise HTTPException(status_code=404, detail="List not found")
    return list_row


async def _get_list_item_count(db: AsyncSession, list_id: UUID) -> int:
    count_value = await db.scalar(
        select(func.count(UserListItem.id)).where(UserListItem.list_id == list_id)
    )
    return int(count_value or 0)


class CreateListRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class UpdateListRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class AddListItemRequest(BaseModel):
    tmdb_id: int = Field(ge=1)
    media_type: Literal["movie", "tv"]
    title: str = Field(min_length=1, max_length=500)
    poster_path: str | None = Field(default=None, max_length=500)
    release_date: str | None = Field(default=None, max_length=40)


class ReorderListItemsRequest(BaseModel):
    item_ids: list[UUID] = Field(min_length=1, max_length=5000)


@router.get("")
async def list_lists(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(UserList, func.count(UserListItem.id))
            .outerjoin(UserListItem, UserListItem.list_id == UserList.id)
            .where(UserList.user_id == user.id)
            .group_by(
                UserList.id,
                UserList.user_id,
                UserList.name,
                UserList.created_at,
                UserList.updated_at,
            )
            .order_by(UserList.updated_at.desc(), UserList.created_at.desc())
        )
    ).all()
    return {
        "results": [
            _serialize_list_summary(list_row, int(item_count or 0))
            for list_row, item_count in rows
        ]
    }


@router.get("/memberships")
async def list_memberships_for_title(
    media_type: Literal["movie", "tv"],
    tmdb_id: int = Query(ge=1),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(UserList.id)
            .join(UserListItem, UserListItem.list_id == UserList.id)
            .where(
                UserList.user_id == user.id,
                UserListItem.media_type == media_type,
                UserListItem.tmdb_id == tmdb_id,
            )
        )
    ).scalars().all()
    return {"list_ids": [str(list_id) for list_id in rows]}


@router.post("")
async def create_list(
    body: CreateListRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    normalized_name = _normalize_list_name(body.name)
    if not normalized_name:
        raise HTTPException(status_code=400, detail="List name is required")

    existing = (
        await db.execute(
            select(UserList).where(
                UserList.user_id == user.id,
                func.lower(UserList.name) == normalized_name.lower(),
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="A list with that name already exists")

    now = datetime.now(timezone.utc)
    list_row = UserList(
        user_id=user.id,
        name=normalized_name,
        created_at=now,
        updated_at=now,
    )
    db.add(list_row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A list with that name already exists")

    return {"ok": True, "list": _serialize_list_summary(list_row, 0)}


@router.put("/{list_id}")
async def rename_list(
    list_id: UUID,
    body: UpdateListRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    list_row = await _get_user_list_or_404(db, user.id, list_id)
    normalized_name = _normalize_list_name(body.name)
    if not normalized_name:
        raise HTTPException(status_code=400, detail="List name is required")

    duplicate = (
        await db.execute(
            select(UserList).where(
                UserList.user_id == user.id,
                func.lower(UserList.name) == normalized_name.lower(),
                UserList.id != list_row.id,
            )
        )
    ).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=409, detail="A list with that name already exists")

    list_row.name = normalized_name
    list_row.updated_at = datetime.now(timezone.utc)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A list with that name already exists")

    item_count = await _get_list_item_count(db, list_row.id)
    return {"ok": True, "list": _serialize_list_summary(list_row, item_count)}


@router.delete("/{list_id}")
async def delete_list(
    list_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    list_row = await _get_user_list_or_404(db, user.id, list_id)
    await db.delete(list_row)
    await db.commit()
    return {"ok": True, "removed": True}


@router.get("/{list_id}/items")
async def list_list_items(
    list_id: UUID,
    limit: int = Query(500, ge=1, le=2000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    list_row = await _get_user_list_or_404(db, user.id, list_id)
    rows = (
        await db.execute(
            select(UserListItem)
            .where(UserListItem.list_id == list_row.id)
            .order_by(UserListItem.sort_index.asc(), UserListItem.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    item_count = await _get_list_item_count(db, list_row.id)
    return {
        "list": _serialize_list_summary(list_row, item_count),
        "results": [_serialize_list_item(row) for row in rows],
    }


@router.post("/{list_id}/items")
async def add_item_to_list(
    list_id: UUID,
    body: AddListItemRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    list_row = await _get_user_list_or_404(db, user.id, list_id)
    normalized_title = body.title.strip()
    if not normalized_title:
        raise HTTPException(status_code=400, detail="Title is required")
    poster_path = (body.poster_path or "").strip() or None
    release_date = (body.release_date or "").strip() or None
    now = datetime.now(timezone.utc)

    existing = (
        await db.execute(
            select(UserListItem).where(
                UserListItem.list_id == list_row.id,
                UserListItem.media_type == body.media_type,
                UserListItem.tmdb_id == body.tmdb_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.title = normalized_title
        existing.poster_path = poster_path
        existing.release_date = release_date
        list_row.updated_at = now
        await db.commit()
        return {"ok": True, "item": _serialize_list_item(existing), "already_exists": True}

    max_sort_index = await db.scalar(
        select(func.max(UserListItem.sort_index)).where(UserListItem.list_id == list_row.id)
    )
    next_sort_index = int(max_sort_index or 0) + 1

    item = UserListItem(
        list_id=list_row.id,
        tmdb_id=body.tmdb_id,
        media_type=body.media_type,
        title=normalized_title,
        poster_path=poster_path,
        release_date=release_date,
        sort_index=next_sort_index,
        created_at=now,
    )
    db.add(item)
    list_row.updated_at = now
    await db.commit()
    return {"ok": True, "item": _serialize_list_item(item), "already_exists": False}


@router.put("/{list_id}/items/reorder")
@router.post("/{list_id}/items/reorder")
async def reorder_list_items(
    list_id: UUID,
    body: ReorderListItemsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    list_row = await _get_user_list_or_404(db, user.id, list_id)
    unique_ids = list(dict.fromkeys(body.item_ids))
    if len(unique_ids) != len(body.item_ids):
        raise HTTPException(status_code=400, detail="Duplicate item ids are not allowed")

    rows = (
        await db.execute(
            select(UserListItem).where(UserListItem.list_id == list_row.id)
        )
    ).scalars().all()
    if not rows:
        raise HTTPException(status_code=400, detail="List has no items")

    row_by_id = {row.id: row for row in rows}
    requested_ids = set(unique_ids)
    existing_ids = set(row_by_id.keys())
    if requested_ids != existing_ids:
        raise HTTPException(status_code=400, detail="Reorder payload must include every item exactly once")

    for idx, item_id in enumerate(unique_ids, start=1):
        row_by_id[item_id].sort_index = idx

    list_row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}


@router.delete("/{list_id}/items/{media_type}/{tmdb_id}")
async def remove_item_from_list(
    list_id: UUID,
    media_type: Literal["movie", "tv"],
    tmdb_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if tmdb_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid tmdb id")
    list_row = await _get_user_list_or_404(db, user.id, list_id)
    row = (
        await db.execute(
            select(UserListItem).where(
                UserListItem.list_id == list_row.id,
                UserListItem.media_type == media_type,
                UserListItem.tmdb_id == tmdb_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        return {"ok": True, "removed": False}
    await db.delete(row)
    list_row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True, "removed": True}
