import asyncio
from datetime import datetime, timezone
import os
import re
from typing import Literal
from urllib.parse import urljoin
import xml.etree.ElementTree as ET

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import tmdb
from .audit import add_audit_log
from .auth import get_current_user
from .database import get_db
from .models import User, UserPreferences, WatchedItem
from .routes_watchlist import (
    LETTERBOXD_BASE_URL,
    LETTERBOXD_LAZY_POSTER_TAG_RE,
    LETTERBOXD_NOT_FOUND_MARKERS,
    LETTERBOXD_PRIVATE_MARKERS,
    LetterboxdWatchlistEntry,
    _entry_resolution_key,
    _looks_like_cloudflare_challenge,
    _normalize_letterboxd_username,
    _parse_letterboxd_export_zip_bytes,
    _coerce_year,
    _parse_html_attributes,
    _resolve_tmdb_movies_bounded,
    _split_title_year,
    _text_contains_any,
    _xml_local_name,
)

router = APIRouter(prefix="/api/watched", tags=["watched"])
LETTERBOXD_FILMS_PAGE_RE = re.compile(r"/films/page/(?P<page>\d+)/", flags=re.IGNORECASE)
LETTERBOXD_WATCHED_IMPORT_LIMIT = max(0, int(os.environ.get("LETTERBOXD_WATCHED_IMPORT_LIMIT", "0") or "0"))


def _watched_limit_reached(count: int) -> bool:
    return LETTERBOXD_WATCHED_IMPORT_LIMIT > 0 and count >= LETTERBOXD_WATCHED_IMPORT_LIMIT


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


class LetterboxdWatchedSyncRequest(BaseModel):
    username: str = Field(min_length=2, max_length=200)


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


def _parse_letterboxd_watched_html_page(html_text: str) -> tuple[list[LetterboxdWatchlistEntry], int]:
    text = html_text or ""
    max_page = 1
    for page_match in LETTERBOXD_FILMS_PAGE_RE.finditer(text):
        page_str = page_match.group("page") or ""
        try:
            page_number = int(page_str)
        except ValueError:
            continue
        if page_number > max_page:
            max_page = page_number

    entries: list[LetterboxdWatchlistEntry] = []
    seen: set[tuple[str, int | None]] = set()
    for tag_match in LETTERBOXD_LAZY_POSTER_TAG_RE.finditer(text):
        attrs = _parse_html_attributes(tag_match.group(0))
        raw_title = attrs.get("data-item-name") or attrs.get("data-item-full-display-name") or ""
        title, year = _split_title_year(raw_title)
        if not title:
            continue
        raw_link = attrs.get("data-item-link") or attrs.get("data-target-link") or ""
        link = urljoin(f"{LETTERBOXD_BASE_URL}/", raw_link) if raw_link else None
        dedupe_key = (title.lower(), year)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        entries.append(LetterboxdWatchlistEntry(title=title, year=year, url=link))

    return entries, max_page


def _parse_positive_int(value: str | int | None) -> int | None:
    if isinstance(value, int):
        return value if value > 0 else None
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = int(raw)
    except ValueError:
        return None
    return parsed if parsed > 0 else None


def _parse_letterboxd_profile_rss(xml_text: str) -> list[LetterboxdWatchlistEntry]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    entries: list[LetterboxdWatchlistEntry] = []
    seen: set[str] = set()
    for item in root.findall(".//item"):
        values: dict[str, str] = {}
        for child in list(item):
            tag = _xml_local_name(child.tag).lower()
            values[tag] = (child.text or "").strip()

        raw_title = values.get("filmtitle") or values.get("title") or ""
        title, year_from_title = _split_title_year(raw_title)
        year = _coerce_year(values.get("filmyear")) or year_from_title
        if not title:
            continue

        tmdb_id = _parse_positive_int(values.get("movieid"))
        dedupe_key = f"tmdb:{tmdb_id}" if tmdb_id else f"title:{title.lower()}::{year or ''}"
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        link = (values.get("link") or "").strip() or None
        entries.append(
            LetterboxdWatchlistEntry(
                title=title,
                year=year,
                url=link,
                tmdb_id=tmdb_id,
            )
        )

    return entries


async def _resolve_tmdb_movies_by_id_bounded(tmdb_ids: list[int]) -> dict[int, dict]:
    if not tmdb_ids:
        return {}

    semaphore = asyncio.Semaphore(6)
    results: dict[int, dict] = {}

    async def _worker(tmdb_id: int) -> None:
        async with semaphore:
            try:
                details = await tmdb.get_movie_details(tmdb_id)
            except Exception:
                return
            if isinstance(details, dict) and int(details.get("id") or 0) > 0:
                results[tmdb_id] = details

    await asyncio.gather(*(_worker(tmdb_id) for tmdb_id in tmdb_ids))
    return results


async def _fetch_letterboxd_watched_films(username: str) -> tuple[str, str, list[LetterboxdWatchlistEntry]]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }
    rss_headers = {
        **headers,
        "Accept": "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
    }
    profile_url = f"{LETTERBOXD_BASE_URL}/{username}/"
    films_url = f"{LETTERBOXD_BASE_URL}/{username}/films/"
    profile_rss_url = f"{profile_url}rss/"
    empty_message = "No public watched films found on this Letterboxd profile."
    blocked_message = "Letterboxd blocked automated access from this server. Please try again later."
    recent_fallback_message = (
        "Synced recent watched titles from Letterboxd. "
        "Full history is temporarily limited because Letterboxd blocked film-page access from this server."
    )

    async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=headers) as client:
        blocked_detected = False
        films_blocked = False
        rss_result: tuple[str, str, list[LetterboxdWatchlistEntry]] | None = None

        async def _fetch_recent_rss_once() -> tuple[str, str, list[LetterboxdWatchlistEntry]]:
            nonlocal rss_result
            if rss_result is not None:
                return rss_result

            try:
                rss_resp = await client.get(profile_rss_url, headers=rss_headers)
            except Exception:
                rss_result = (
                    "unreachable",
                    "Could not read this Letterboxd profile activity feed right now. Please try again.",
                    [],
                )
                return rss_result

            if _looks_like_cloudflare_challenge(rss_resp):
                rss_result = ("blocked", blocked_message, [])
                return rss_result

            rss_text = rss_resp.text or ""
            if _text_contains_any(rss_text, LETTERBOXD_PRIVATE_MARKERS):
                rss_result = (
                    "private",
                    "This Letterboxd account is private, so FullStreamer cannot sync watched titles.",
                    [],
                )
                return rss_result
            if rss_resp.status_code == 404 or _text_contains_any(rss_text, LETTERBOXD_NOT_FOUND_MARKERS):
                rss_result = ("not_found", "Letterboxd user was not found.", [])
                return rss_result
            if rss_resp.status_code != 200 or "<rss" not in rss_text.lower():
                rss_result = (
                    "unreachable",
                    "Could not read this Letterboxd profile activity feed right now. Please try again.",
                    [],
                )
                return rss_result

            rss_entries = _parse_letterboxd_profile_rss(rss_text)
            if rss_entries:
                rss_result = ("ok", recent_fallback_message, rss_entries)
                return rss_result

            rss_result = ("empty", empty_message, [])
            return rss_result

        try:
            profile_resp = await client.get(profile_url)
        except Exception:
            profile_resp = None

        if profile_resp is not None:
            if _looks_like_cloudflare_challenge(profile_resp):
                blocked_detected = True
            profile_text = profile_resp.text or ""
            if _text_contains_any(profile_text, LETTERBOXD_PRIVATE_MARKERS):
                return (
                    "private",
                    "This Letterboxd account is private, so FullStreamer cannot sync watched titles.",
                    [],
                )
            if profile_resp.status_code == 404 or _text_contains_any(profile_text, LETTERBOXD_NOT_FOUND_MARKERS):
                return ("not_found", "Letterboxd user was not found.", [])

        try:
            films_resp = await client.get(films_url)
        except Exception:
            films_resp = None

        if films_resp is not None:
            if _looks_like_cloudflare_challenge(films_resp):
                blocked_detected = True
                films_blocked = True
            else:
                films_text = films_resp.text or ""
                if _text_contains_any(films_text, LETTERBOXD_PRIVATE_MARKERS):
                    return (
                        "private",
                        "This Letterboxd account is private, so FullStreamer cannot sync watched titles.",
                        [],
                    )
                if films_resp.status_code == 200:
                    all_entries: list[LetterboxdWatchlistEntry] = []
                    seen_keys: set[tuple[str, int | None]] = set()

                    page_entries, max_pages = _parse_letterboxd_watched_html_page(films_resp.text or "")
                    for entry in page_entries:
                        key = (entry.title.lower(), entry.year)
                        if key in seen_keys:
                            continue
                        seen_keys.add(key)
                        all_entries.append(entry)

                    current_page = 2
                    while current_page <= max_pages and not _watched_limit_reached(len(all_entries)):
                        page_url = f"{films_url}page/{current_page}/"
                        try:
                            page_resp = await client.get(page_url)
                        except Exception:
                            break

                        if _looks_like_cloudflare_challenge(page_resp):
                            blocked_detected = True
                            films_blocked = True
                            break

                        page_text = page_resp.text or ""
                        if _text_contains_any(page_text, LETTERBOXD_PRIVATE_MARKERS):
                            return (
                                "private",
                                "This Letterboxd account is private, so FullStreamer cannot sync watched titles.",
                                [],
                            )

                        if page_resp.status_code != 200:
                            break

                        parsed_entries, page_count_hint = _parse_letterboxd_watched_html_page(page_text)
                        if page_count_hint > max_pages:
                            max_pages = page_count_hint
                        for entry in parsed_entries:
                            key = (entry.title.lower(), entry.year)
                            if key in seen_keys:
                                continue
                            seen_keys.add(key)
                            all_entries.append(entry)
                            if _watched_limit_reached(len(all_entries)):
                                break

                        current_page += 1

                    if all_entries:
                        return ("ok", "Watched titles synced from Letterboxd.", all_entries)
                    if films_blocked:
                        fallback_status, fallback_message, fallback_entries = await _fetch_recent_rss_once()
                        if fallback_status in {"ok", "empty", "private", "not_found"}:
                            return (fallback_status, fallback_message, fallback_entries)
                        return ("blocked", blocked_message, [])
                    return ("empty", empty_message, [])

                if films_resp.status_code == 404:
                    if profile_resp is not None and profile_resp.status_code == 200:
                        return ("empty", empty_message, [])
                    return ("not_found", "Letterboxd user was not found.", [])

        if films_blocked or (blocked_detected and films_resp is None):
            fallback_status, fallback_message, fallback_entries = await _fetch_recent_rss_once()
            if fallback_status in {"ok", "empty", "private", "not_found"}:
                return (fallback_status, fallback_message, fallback_entries)
            return ("blocked", blocked_message, [])

        fallback_status, fallback_message, fallback_entries = await _fetch_recent_rss_once()
        if fallback_status in {"ok", "empty", "private", "not_found"}:
            return (fallback_status, fallback_message, fallback_entries)
        if fallback_status == "blocked":
            return ("blocked", blocked_message, [])

        return (
            "unreachable",
            "Could not read this Letterboxd profile right now. Please try again.",
            [],
        )


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


@router.post("/sync/letterboxd")
async def sync_watched_from_letterboxd(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sync_time = datetime.now(timezone.utc)
    sync_mark_time = datetime.now(timezone.utc)
    prefs = await _get_or_create_preferences(db, user.id)
    zip_bytes = await file.read()
    export_bundle = _parse_letterboxd_export_zip_bytes(zip_bytes)
    username = (export_bundle.username or "").strip()
    entries = list(export_bundle.watched_entries)
    limit_applied = False
    if LETTERBOXD_WATCHED_IMPORT_LIMIT > 0 and len(entries) > LETTERBOXD_WATCHED_IMPORT_LIMIT:
        entries = entries[:LETTERBOXD_WATCHED_IMPORT_LIMIT]
        limit_applied = True

    if not entries:
        empty_message = "No titles found in watched.csv in this Letterboxd export."
        add_audit_log(
            db,
            action="user.watched_sync_letterboxd",
            message="Letterboxd watched ZIP sync completed with no importable titles.",
            actor_user=user,
            target_user=user,
        )
        prefs.letterboxd_username = username or None
        await db.commit()
        return {
            "ok": True,
            "status": "empty",
            "username": username or None,
            "message": empty_message,
            "total_items": 0,
            "added_count": 0,
            "already_exists_count": 0,
            "unmatched_count": 0,
        }

    existing_rows = (
        await db.execute(
            select(WatchedItem).where(
                WatchedItem.user_id == user.id,
                WatchedItem.media_type == "movie",
            )
        )
    ).scalars().all()
    existing_by_tmdb_id = {int(row.tmdb_id): row for row in existing_rows}

    total_items = len(entries)
    added_count = 0
    already_exists_count = 0
    unmatched_count = 0
    seen_import_ids: set[int] = set()
    pending_items: list[WatchedItem] = []

    unique_entries: list[LetterboxdWatchlistEntry] = []
    unique_keys: list[tuple[str, int | None]] = []
    seen_unique: set[tuple[str, int | None]] = set()
    tmdb_ids_from_feed: set[int] = set()
    for entry in entries:
        feed_tmdb_id = int(entry.tmdb_id or 0)
        if feed_tmdb_id > 0:
            tmdb_ids_from_feed.add(feed_tmdb_id)
            continue
        key = _entry_resolution_key(entry)
        if key in seen_unique:
            continue
        seen_unique.add(key)
        unique_keys.append(key)
        unique_entries.append(entry)

    resolved_unique = await _resolve_tmdb_movies_bounded(unique_entries) if unique_entries else []
    resolved_by_key = {key: resolved_unique[i] for i, key in enumerate(unique_keys)}
    resolved_direct_tmdb = await _resolve_tmdb_movies_by_id_bounded(list(tmdb_ids_from_feed))

    for entry in entries:
        resolved: dict | None = None
        tmdb_id = int(entry.tmdb_id or 0)
        if tmdb_id <= 0:
            resolved = resolved_by_key.get(_entry_resolution_key(entry))
            if not resolved:
                unmatched_count += 1
                continue
            tmdb_id = int(resolved.get("id") or 0)
        else:
            resolved = resolved_direct_tmdb.get(tmdb_id)

        if tmdb_id <= 0:
            unmatched_count += 1
            continue

        if tmdb_id in seen_import_ids:
            already_exists_count += 1
            continue
        seen_import_ids.add(tmdb_id)

        title = str((resolved or {}).get("title") or entry.title).strip() or entry.title
        poster_path = str((resolved or {}).get("poster_path") or "").strip() or None
        release_date = str((resolved or {}).get("release_date") or "").strip() or None
        existing_row = existing_by_tmdb_id.get(tmdb_id)
        if existing_row:
            existing_row.title = title
            if poster_path is not None:
                existing_row.poster_path = poster_path
            if release_date is not None:
                existing_row.release_date = release_date
            existing_row.watched_at = sync_mark_time
            already_exists_count += 1
            continue

        pending_items.append(
            WatchedItem(
                user_id=user.id,
                tmdb_id=tmdb_id,
                media_type="movie",
                title=title,
                poster_path=poster_path,
                release_date=release_date,
                watched_at=sync_mark_time,
                created_at=sync_mark_time,
            )
        )
        added_count += 1

    if pending_items:
        db.add_all(pending_items)

    if total_items > 0 and added_count == 0 and already_exists_count == 0:
        status = "no_matches"
        message = "No watched titles could be matched from Letterboxd to TMDB."
    else:
        status = "ok"
        message = (
            f"Synced Letterboxd watched titles. Added {added_count}. "
            f"{already_exists_count} already marked watched. "
            f"{unmatched_count} unmatched."
        )
    if limit_applied:
        message = f"{message} Imported the first {LETTERBOXD_WATCHED_IMPORT_LIMIT} titles."

    add_audit_log(
        db,
        action="user.watched_sync_letterboxd",
        message=(
            f"Letterboxd watched sync completed. Added {added_count}, "
            f"existing {already_exists_count}, unmatched {unmatched_count}."
        ),
        actor_user=user,
        target_user=user,
    )
    prefs.letterboxd_username = username or None
    prefs.letterboxd_watchlist_last_sync_at = sync_time
    await db.commit()

    return {
        "ok": True,
        "status": status,
        "username": username or None,
        "message": message,
        "total_items": total_items,
        "added_count": added_count,
        "already_exists_count": already_exists_count,
        "unmatched_count": unmatched_count,
    }


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
