import asyncio
import json
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from . import tmdb
from .audit import add_audit_log
from .auth import get_current_user, get_current_premium_user
from .database import get_db
from .models import User, UserList, UserListItem, UserPreferences
from .routes_watchlist import (
    LETTERBOXD_IMPORT_LIMIT,
    LetterboxdExportList,
    LetterboxdWatchlistEntry,
    _coerce_year,
    _entry_resolution_key,
    _normalize_title_for_match,
    _parse_letterboxd_export_zip_bytes,
    _resolve_tmdb_movies_bounded,
)

router = APIRouter(
    prefix="/api/lists",
    tags=["lists"],
    dependencies=[Depends(get_current_premium_user)],
)
LETTERBOXD_LIST_SYNC_LIMIT = max(LETTERBOXD_IMPORT_LIMIT * 8, 2000)


def _normalize_list_name(name: str) -> str:
    return " ".join(name.strip().split())


def _normalize_list_key(name: str) -> str:
    return _normalize_list_name(name).lower()


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


async def _get_or_create_preferences(db: AsyncSession, user_id) -> UserPreferences:
    prefs = (
        await db.execute(
            select(UserPreferences).where(UserPreferences.user_id == user_id)
        )
    ).scalar_one_or_none()
    if prefs is None:
        prefs = UserPreferences(user_id=user_id)
        db.add(prefs)
        await db.flush()
    return prefs


def _coerce_selected_list_names(raw: str | None) -> set[str]:
    if not raw:
        return set()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="selected_lists must be a JSON array of list names.")
    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="selected_lists must be a JSON array of list names.")
    normalized: set[str] = set()
    for entry in parsed:
        name = _normalize_list_name(str(entry or ""))
        if name:
            normalized.add(name)
    return normalized


def _merge_export_lists(raw_lists: list[LetterboxdExportList]) -> list[LetterboxdExportList]:
    ordered_keys: list[str] = []
    by_key: dict[str, dict] = {}
    for export_list in raw_lists:
        list_name = _normalize_list_name(export_list.name)
        if not list_name:
            continue
        key = _normalize_list_key(list_name)
        bucket = by_key.get(key)
        if bucket is None:
            bucket = {
                "name": list_name,
                "entries": [],
                "seen_entries": set(),
            }
            by_key[key] = bucket
            ordered_keys.append(key)

        for entry in export_list.entries:
            dedupe_key = (entry.title.lower(), entry.year)
            if dedupe_key in bucket["seen_entries"]:
                continue
            bucket["seen_entries"].add(dedupe_key)
            bucket["entries"].append(entry)

    merged: list[LetterboxdExportList] = []
    for key in ordered_keys:
        bucket = by_key[key]
        merged.append(
            LetterboxdExportList(
                name=bucket["name"],
                entries=list(bucket["entries"]),
                source_file=None,
            )
        )
    return merged


def _score_tmdb_tv_candidate(entry: LetterboxdWatchlistEntry, candidate: dict) -> float:
    entry_title = _normalize_title_for_match(entry.title)
    candidate_title = _normalize_title_for_match(
        str(candidate.get("name") or candidate.get("original_name") or "")
    )
    if not entry_title or not candidate_title:
        return -1_000.0

    score = SequenceMatcher(None, entry_title, candidate_title).ratio() * 100.0
    if entry_title == candidate_title:
        score += 28.0
    elif candidate_title.startswith(entry_title) or entry_title.startswith(candidate_title):
        score += 12.0

    candidate_year = _coerce_year(str(candidate.get("first_air_date") or ""))
    if entry.year is not None:
        if candidate_year is None:
            score -= 8.0
        else:
            diff = abs(candidate_year - entry.year)
            if diff == 0:
                score += 18.0
            elif diff == 1:
                score += 8.0
            elif diff == 2:
                score += 2.0
            else:
                score -= min(40.0, float(diff * 5))

    popularity = candidate.get("popularity")
    try:
        score += min(6.0, float(popularity or 0.0) / 120.0)
    except (TypeError, ValueError):
        pass
    return score


async def _resolve_tmdb_tv_entry(entry: LetterboxdWatchlistEntry) -> dict | None:
    query = entry.title.strip()
    if not query:
        return None

    try:
        search = await tmdb.search_tv(query, page=1)
    except Exception:
        return None

    candidates: dict[int, dict] = {}
    for row in search.get("results", []):
        tv_id = row.get("id")
        if isinstance(tv_id, int) and tv_id > 0:
            candidates[tv_id] = row

    if not candidates:
        return None

    best_row: dict | None = None
    best_score = -1_000.0
    for row in candidates.values():
        score = _score_tmdb_tv_candidate(entry, row)
        if score > best_score:
            best_score = score
            best_row = row

    if not best_row:
        return None

    minimum_score = 54.0 if entry.year is not None else 64.0
    if best_score >= minimum_score:
        return best_row

    if entry.year is not None:
        exact_year_rows: list[dict] = []
        for row in candidates.values():
            first_air_year = _coerce_year(str(row.get("first_air_date") or ""))
            if first_air_year == entry.year:
                exact_year_rows.append(row)
        if len(exact_year_rows) == 1:
            return exact_year_rows[0]

    if len(candidates) == 1:
        only_row = next(iter(candidates.values()))
        if entry.year is None:
            return only_row
        first_air_year = _coerce_year(str(only_row.get("first_air_date") or ""))
        if first_air_year == entry.year:
            return only_row
    return None


async def _resolve_tmdb_tv_bounded(entries: list[LetterboxdWatchlistEntry]) -> list[dict | None]:
    if not entries:
        return []
    semaphore = asyncio.Semaphore(4)
    results: list[dict | None] = [None] * len(entries)

    async def _worker(index: int, entry: LetterboxdWatchlistEntry) -> None:
        async with semaphore:
            try:
                results[index] = await _resolve_tmdb_tv_entry(entry)
            except Exception:
                results[index] = None

    await asyncio.gather(*(_worker(i, entry) for i, entry in enumerate(entries)))
    return results


@router.post("/sync/letterboxd/preview")
async def preview_letterboxd_lists_sync(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    _ = user.id
    zip_bytes = await file.read()
    export_bundle = _parse_letterboxd_export_zip_bytes(zip_bytes)
    merged_lists = _merge_export_lists(export_bundle.lists)
    merged_lists.sort(key=lambda row: row.name.lower())
    return {
        "ok": True,
        "username": (export_bundle.username or "").strip() or None,
        "total_lists": len(merged_lists),
        "total_items": sum(len(row.entries) for row in merged_lists),
        "lists": [
            {
                "name": row.name,
                "item_count": len(row.entries),
            }
            for row in merged_lists
        ],
    }


@router.post("/sync/letterboxd")
async def sync_lists_from_letterboxd(
    file: UploadFile = File(...),
    list_scope: Literal["all", "selected"] = Form("all"),
    selected_lists: str | None = Form(None),
    conflict_mode: Literal["skip", "merge", "overwrite"] | None = Form(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sync_time = datetime.now(timezone.utc)
    prefs = await _get_or_create_preferences(db, user.id)
    zip_bytes = await file.read()
    export_bundle = _parse_letterboxd_export_zip_bytes(zip_bytes)
    username = (export_bundle.username or "").strip() or None

    all_import_lists = _merge_export_lists(export_bundle.lists)
    if not all_import_lists:
        message = "No custom lists were found in this Letterboxd export."
        prefs.letterboxd_username = username
        prefs.letterboxd_watchlist_sync_status = "empty"
        prefs.letterboxd_watchlist_sync_message = message
        prefs.letterboxd_watchlist_last_sync_at = sync_time
        await db.commit()
        return {
            "ok": True,
            "status": "empty",
            "username": username,
            "message": message,
            "scope": list_scope,
            "conflict_mode": conflict_mode,
            "conflict_names": [],
            "total_lists": 0,
            "created_lists_count": 0,
            "merged_lists_count": 0,
            "overwritten_lists_count": 0,
            "skipped_conflicts_count": 0,
            "added_count": 0,
            "already_exists_count": 0,
            "unmatched_count": 0,
            "total_items": 0,
        }

    selected_import_lists = all_import_lists
    if list_scope == "selected":
        selected_names = _coerce_selected_list_names(selected_lists)
        if not selected_names:
            raise HTTPException(status_code=400, detail="Select at least one list when using only selected lists.")
        selected_key_set = {_normalize_list_key(name) for name in selected_names}
        selected_import_lists = [
            row for row in all_import_lists if _normalize_list_key(row.name) in selected_key_set
        ]
        if not selected_import_lists:
            raise HTTPException(status_code=400, detail="None of the selected Letterboxd lists were found in this ZIP.")

    selected_import_lists = sorted(selected_import_lists, key=lambda row: row.name.lower())
    total_items_before_limit = sum(len(row.entries) for row in selected_import_lists)
    total_items = total_items_before_limit
    limit_applied = False
    if total_items > LETTERBOXD_LIST_SYNC_LIMIT:
        limit_applied = True
        remaining = LETTERBOXD_LIST_SYNC_LIMIT
        limited_lists: list[LetterboxdExportList] = []
        for row in selected_import_lists:
            if remaining <= 0:
                break
            take_entries = row.entries[:remaining]
            limited_lists.append(
                LetterboxdExportList(
                    name=row.name,
                    entries=take_entries,
                    source_file=row.source_file,
                )
            )
            remaining -= len(take_entries)
        selected_import_lists = limited_lists
        total_items = LETTERBOXD_LIST_SYNC_LIMIT

    existing_lists = (
        await db.execute(
            select(UserList).where(UserList.user_id == user.id)
        )
    ).scalars().all()
    existing_by_key = {_normalize_list_key(row.name): row for row in existing_lists}

    conflict_names = sorted(
        [
            row.name
            for row in selected_import_lists
            if _normalize_list_key(row.name) in existing_by_key
        ],
        key=str.lower,
    )
    if conflict_names and conflict_mode is None:
        message = (
            f"You already have {len(conflict_names)} list"
            f"{'' if len(conflict_names) == 1 else 's'} with the same name. "
            "Choose Skip, Merge, or Overwrite."
        )
        return {
            "ok": False,
            "status": "conflict",
            "username": username,
            "message": message,
            "scope": list_scope,
            "conflict_mode": None,
            "conflict_names": conflict_names,
            "total_lists": len(selected_import_lists),
            "created_lists_count": 0,
            "merged_lists_count": 0,
            "overwritten_lists_count": 0,
            "skipped_conflicts_count": 0,
            "added_count": 0,
            "already_exists_count": 0,
            "unmatched_count": 0,
            "total_items": total_items,
        }

    unique_entries: list[LetterboxdWatchlistEntry] = []
    unique_keys: list[tuple[str, int | None]] = []
    seen_unique: set[tuple[str, int | None]] = set()
    for import_list in selected_import_lists:
        for entry in import_list.entries:
            key = _entry_resolution_key(entry)
            if key in seen_unique:
                continue
            seen_unique.add(key)
            unique_keys.append(key)
            unique_entries.append(entry)
    resolved_unique = await _resolve_tmdb_movies_bounded(unique_entries) if unique_entries else []
    resolved_by_key: dict[tuple[str, int | None], tuple[str, dict]] = {}
    unresolved_entries: list[LetterboxdWatchlistEntry] = []
    unresolved_keys: list[tuple[str, int | None]] = []
    for idx, key in enumerate(unique_keys):
        resolved_movie = resolved_unique[idx]
        if resolved_movie:
            resolved_by_key[key] = ("movie", resolved_movie)
            continue
        unresolved_entries.append(unique_entries[idx])
        unresolved_keys.append(key)

    resolved_tv = await _resolve_tmdb_tv_bounded(unresolved_entries) if unresolved_entries else []
    for idx, key in enumerate(unresolved_keys):
        resolved_show = resolved_tv[idx]
        if resolved_show:
            resolved_by_key[key] = ("tv", resolved_show)

    created_lists_count = 0
    merged_lists_count = 0
    overwritten_lists_count = 0
    skipped_conflicts_count = 0
    added_count = 0
    already_exists_count = 0
    unmatched_count = 0
    now = datetime.now(timezone.utc)

    for import_list in selected_import_lists:
        list_key = _normalize_list_key(import_list.name)
        existing_list = existing_by_key.get(list_key)
        is_conflict = existing_list is not None

        if is_conflict and conflict_mode == "skip":
            skipped_conflicts_count += 1
            continue

        resolved_items: list[dict] = []
        seen_tmdb_keys: set[tuple[str, int]] = set()
        for entry in import_list.entries:
            resolved_payload = resolved_by_key.get(_entry_resolution_key(entry))
            if not resolved_payload:
                unmatched_count += 1
                continue
            resolved_media_type, resolved = resolved_payload
            tmdb_id = int(resolved.get("id") or 0)
            if tmdb_id <= 0:
                unmatched_count += 1
                continue
            resolved_key = (resolved_media_type, tmdb_id)
            if resolved_key in seen_tmdb_keys:
                already_exists_count += 1
                continue
            seen_tmdb_keys.add(resolved_key)
            resolved_title_field = "title" if resolved_media_type == "movie" else "name"
            resolved_release_field = "release_date" if resolved_media_type == "movie" else "first_air_date"
            resolved_items.append(
                {
                    "tmdb_id": tmdb_id,
                    "media_type": resolved_media_type,
                    "title": str(resolved.get(resolved_title_field) or entry.title).strip() or entry.title,
                    "poster_path": str(resolved.get("poster_path") or "").strip() or None,
                    "release_date": str(resolved.get(resolved_release_field) or "").strip() or None,
                }
            )

        if existing_list is None:
            target_list = UserList(
                user_id=user.id,
                name=import_list.name,
                created_at=now,
                updated_at=now,
            )
            db.add(target_list)
            await db.flush()
            existing_by_key[list_key] = target_list
            created_lists_count += 1
        else:
            target_list = existing_list

        if is_conflict and conflict_mode == "overwrite":
            await db.execute(delete(UserListItem).where(UserListItem.list_id == target_list.id))
            for idx, item in enumerate(resolved_items, start=1):
                db.add(
                    UserListItem(
                        list_id=target_list.id,
                        media_type=item["media_type"],
                        tmdb_id=item["tmdb_id"],
                        title=item["title"],
                        poster_path=item["poster_path"],
                        release_date=item["release_date"],
                        sort_index=idx,
                        created_at=now,
                    )
                )
                added_count += 1
            target_list.updated_at = now
            overwritten_lists_count += 1
            continue

        existing_items = (
            await db.execute(
                select(UserListItem).where(UserListItem.list_id == target_list.id)
            )
        ).scalars().all()
        existing_item_by_key = {(row.media_type, int(row.tmdb_id)): row for row in existing_items}
        next_sort_index = max((int(row.sort_index or 0) for row in existing_items), default=0)

        for item in resolved_items:
            key = (item["media_type"], int(item["tmdb_id"]))
            existing_item = existing_item_by_key.get(key)
            if existing_item:
                existing_item.title = item["title"]
                existing_item.poster_path = item["poster_path"]
                existing_item.release_date = item["release_date"]
                already_exists_count += 1
                continue

            next_sort_index += 1
            db.add(
                UserListItem(
                    list_id=target_list.id,
                    media_type=item["media_type"],
                    tmdb_id=item["tmdb_id"],
                    title=item["title"],
                    poster_path=item["poster_path"],
                    release_date=item["release_date"],
                    sort_index=next_sort_index,
                    created_at=now,
                )
            )
            added_count += 1

        target_list.updated_at = now
        if is_conflict and conflict_mode == "merge":
            merged_lists_count += 1

    if (
        created_lists_count == 0
        and merged_lists_count == 0
        and overwritten_lists_count == 0
        and added_count == 0
        and already_exists_count == 0
        and unmatched_count > 0
    ):
        status = "no_matches"
    elif (
        created_lists_count == 0
        and merged_lists_count == 0
        and overwritten_lists_count == 0
        and added_count == 0
        and already_exists_count == 0
        and unmatched_count == 0
    ):
        status = "empty"
    else:
        status = "ok"

    message = (
        f"Synced Letterboxd lists. Created {created_lists_count}. "
        f"Merged {merged_lists_count}. Overwritten {overwritten_lists_count}. "
        f"Skipped {skipped_conflicts_count}. "
        f"Added {added_count}. {already_exists_count} already in lists. {unmatched_count} unmatched."
    )
    if limit_applied:
        message = f"{message} Imported the first {LETTERBOXD_LIST_SYNC_LIMIT} titles."

    prefs.letterboxd_username = username
    prefs.letterboxd_watchlist_sync_status = status
    prefs.letterboxd_watchlist_sync_message = message
    prefs.letterboxd_watchlist_last_sync_at = sync_time

    add_audit_log(
        db,
        action="user.lists_sync_letterboxd",
        message=(
            f"Letterboxd list sync completed. Scope={list_scope}, conflict_mode={conflict_mode or 'prompt'}. "
            f"Created {created_lists_count}, merged {merged_lists_count}, overwritten {overwritten_lists_count}, "
            f"skipped {skipped_conflicts_count}, added {added_count}, existing {already_exists_count}, unmatched {unmatched_count}."
        ),
        actor_user=user,
        target_user=user,
    )
    await db.commit()

    return {
        "ok": True,
        "status": status,
        "username": username,
        "message": message,
        "scope": list_scope,
        "conflict_mode": conflict_mode,
        "conflict_names": [],
        "total_lists": len(selected_import_lists),
        "created_lists_count": created_lists_count,
        "merged_lists_count": merged_lists_count,
        "overwritten_lists_count": overwritten_lists_count,
        "skipped_conflicts_count": skipped_conflicts_count,
        "added_count": added_count,
        "already_exists_count": already_exists_count,
        "unmatched_count": unmatched_count,
        "total_items": total_items,
    }


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
