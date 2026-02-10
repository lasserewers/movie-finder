import asyncio
import csv
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from html import unescape
import io
import re
from typing import Literal
from urllib.parse import urljoin, urlparse
import xml.etree.ElementTree as ET
import zipfile

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import tmdb
from .audit import add_audit_log
from .auth import get_current_user
from .database import get_db
from .models import User, UserPreferences, WatchlistItem

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])

LETTERBOXD_BASE_URL = "https://letterboxd.com"
LETTERBOXD_IMPORT_LIMIT = 800
LETTERBOXD_USERNAME_RE = re.compile(r"^[a-z0-9_-]{2,60}$", flags=re.IGNORECASE)
LETTERBOXD_NOT_FOUND_MARKERS = (
    "sorry, we can’t find the page you’ve requested",
    "sorry, we can't find the page you've requested",
)
LETTERBOXD_PRIVATE_MARKERS = (
    "this profile is private",
    "this account is private",
    "profile is private",
)
LETTERBOXD_LAZY_POSTER_TAG_RE = re.compile(
    r"<div\b[^>]*\bdata-component-class=(?P<quote>['\"])LazyPoster(?P=quote)[^>]*>",
    flags=re.IGNORECASE | re.DOTALL,
)
LETTERBOXD_HTML_ATTR_RE = re.compile(
    r"(?P<name>[a-zA-Z0-9:_-]+)\s*=\s*(?P<quote>['\"])(?P<value>.*?)(?P=quote)",
    flags=re.DOTALL,
)
LETTERBOXD_WATCHLIST_PAGE_RE = re.compile(r"/watchlist/page/(?P<page>\d+)/", flags=re.IGNORECASE)
LETTERBOXD_RESOLVE_CONCURRENCY = 4
LETTERBOXD_EXPORT_MAX_BYTES = 30 * 1024 * 1024


@dataclass(frozen=True)
class LetterboxdWatchlistEntry:
    title: str
    year: int | None
    url: str | None = None
    tmdb_id: int | None = None


class AddWatchlistRequest(BaseModel):
    tmdb_id: int = Field(ge=1)
    media_type: Literal["movie", "tv"]
    title: str = Field(min_length=1, max_length=500)
    poster_path: str | None = Field(default=None, max_length=500)
    release_date: str | None = Field(default=None, max_length=40)


class LetterboxdWatchlistSyncRequest(BaseModel):
    username: str = Field(min_length=2, max_length=200)


def _serialize_watchlist_item(item: WatchlistItem) -> dict:
    return {
        "id": str(item.id),
        "tmdb_id": int(item.tmdb_id),
        "media_type": item.media_type,
        "title": item.title,
        "poster_path": item.poster_path,
        "release_date": item.release_date,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def _serialize_letterboxd_sync_state(prefs: UserPreferences | None) -> dict:
    if not prefs:
        return {
            "username": None,
            "status": None,
            "message": None,
            "last_sync_at": None,
        }
    return {
        "username": prefs.letterboxd_username,
        "status": prefs.letterboxd_watchlist_sync_status,
        "message": prefs.letterboxd_watchlist_sync_message,
        "last_sync_at": (
            prefs.letterboxd_watchlist_last_sync_at.isoformat()
            if prefs.letterboxd_watchlist_last_sync_at
            else None
        ),
    }


def _coerce_year(value: str | int | None) -> int | None:
    if isinstance(value, int):
        return value if 1870 <= value <= 2200 else None
    raw = str(value or "").strip()
    if not raw:
        return None
    match = re.search(r"(\d{4})", raw)
    if not match:
        return None
    year = int(match.group(1))
    return year if 1870 <= year <= 2200 else None


def _normalize_letterboxd_username(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Letterboxd username is required")

    if raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlparse(raw)
        host = (parsed.netloc or "").lower()
        if "letterboxd.com" not in host:
            raise HTTPException(status_code=400, detail="Please enter a valid Letterboxd username")
        path_parts = [part for part in (parsed.path or "").split("/") if part]
        raw = path_parts[0] if path_parts else ""

    raw = raw.strip().strip("/")
    if raw.startswith("@"):
        raw = raw[1:]
    if "/" in raw:
        raw = raw.split("/", 1)[0]

    normalized = raw.strip().lower()
    if not LETTERBOXD_USERNAME_RE.fullmatch(normalized):
        raise HTTPException(status_code=400, detail="Please enter a valid Letterboxd username")
    return normalized


def _xml_local_name(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[1]
    return tag.split(":", 1)[-1]


def _split_title_year(value: str) -> tuple[str, int | None]:
    text = unescape(str(value or "")).strip()
    if not text:
        return "", None
    for pattern in (
        r"^(?P<title>.+?),\s*(?P<year>\d{4})$",
        r"^(?P<title>.+?)\s+\((?P<year>\d{4})\)$",
    ):
        match = re.match(pattern, text)
        if not match:
            continue
        title = (match.group("title") or "").strip()
        year = _coerce_year(match.group("year"))
        if title:
            return title, year
    return text, None


@dataclass(frozen=True)
class LetterboxdExportBundle:
    username: str | None
    watchlist_entries: list[LetterboxdWatchlistEntry]
    watched_entries: list[LetterboxdWatchlistEntry]


def _decode_letterboxd_csv_bytes(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status_code=400, detail="Could not decode CSV files in the uploaded Letterboxd export.")


def _zip_member_name_case_insensitive(names: list[str], target_name: str) -> str | None:
    target = target_name.strip("/").lower()
    for name in names:
        if name.strip("/").lower() == target:
            return name
    return None


def _read_zip_text(archive: zipfile.ZipFile, member_name: str) -> str | None:
    names = archive.namelist()
    actual_name = _zip_member_name_case_insensitive(names, member_name)
    if not actual_name:
        return None
    try:
        raw = archive.read(actual_name)
    except KeyError:
        return None
    return _decode_letterboxd_csv_bytes(raw)


def _parse_letterboxd_export_entries_from_csv(csv_text: str) -> list[LetterboxdWatchlistEntry]:
    reader = csv.DictReader(io.StringIO(csv_text))
    entries: list[LetterboxdWatchlistEntry] = []
    seen: set[tuple[str, int | None]] = set()
    for row in reader:
        if not isinstance(row, dict):
            continue
        raw_title = str(row.get("Name") or row.get("Film Name") or row.get("Title") or "").strip()
        if not raw_title:
            continue
        title, year_from_title = _split_title_year(raw_title)
        if not title:
            continue
        year = _coerce_year(row.get("Year")) or year_from_title
        uri = str(row.get("Letterboxd URI") or row.get("URI") or row.get("URL") or "").strip() or None
        dedupe_key = (title.lower(), year)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        entries.append(LetterboxdWatchlistEntry(title=title, year=year, url=uri))
    return entries


def _parse_letterboxd_export_profile_username(csv_text: str) -> str | None:
    reader = csv.DictReader(io.StringIO(csv_text))
    row = next(reader, None)
    if not isinstance(row, dict):
        return None
    username = str(row.get("Username") or "").strip().lower()
    if not username:
        return None
    if LETTERBOXD_USERNAME_RE.fullmatch(username):
        return username
    return None


def _parse_letterboxd_export_zip_bytes(zip_bytes: bytes) -> LetterboxdExportBundle:
    if not zip_bytes:
        raise HTTPException(status_code=400, detail="Upload a Letterboxd export ZIP file.")
    if len(zip_bytes) > LETTERBOXD_EXPORT_MAX_BYTES:
        raise HTTPException(status_code=400, detail="ZIP file is too large. Please upload a smaller Letterboxd export.")

    try:
        archive = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file. Please upload the Letterboxd export ZIP.")

    with archive:
        profile_csv = _read_zip_text(archive, "profile.csv")
        watchlist_csv = _read_zip_text(archive, "watchlist.csv")
        watched_csv = _read_zip_text(archive, "watched.csv")
        diary_csv = _read_zip_text(archive, "diary.csv")

    if not profile_csv and not watchlist_csv and not watched_csv and not diary_csv:
        raise HTTPException(
            status_code=400,
            detail="Could not find Letterboxd export files in ZIP. Use the ZIP from Settings > Data > Export your data.",
        )

    username = _parse_letterboxd_export_profile_username(profile_csv or "")
    watchlist_entries = _parse_letterboxd_export_entries_from_csv(watchlist_csv or "") if watchlist_csv else []
    watched_entries = _parse_letterboxd_export_entries_from_csv(watched_csv or "") if watched_csv else []
    if not watched_entries and diary_csv:
        watched_entries = _parse_letterboxd_export_entries_from_csv(diary_csv)

    return LetterboxdExportBundle(
        username=username,
        watchlist_entries=watchlist_entries,
        watched_entries=watched_entries,
    )


def _parse_letterboxd_watchlist_rss(xml_text: str) -> list[LetterboxdWatchlistEntry]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    entries: list[LetterboxdWatchlistEntry] = []
    seen: set[tuple[str, int | None]] = set()

    for item in root.findall(".//item"):
        values: dict[str, str] = {}
        for child in list(item):
            tag = _xml_local_name(child.tag).lower()
            values[tag] = (child.text or "").strip()

        raw_title = values.get("filmtitle") or values.get("title") or ""
        title, year_from_title = _split_title_year(raw_title)
        year = _coerce_year(values.get("filmyear")) or year_from_title
        link = (values.get("link") or "").strip() or None
        if not title:
            continue
        dedupe_key = (title.lower(), year)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        entries.append(LetterboxdWatchlistEntry(title=title, year=year, url=link))

    return entries


def _parse_html_attributes(tag_html: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for match in LETTERBOXD_HTML_ATTR_RE.finditer(tag_html):
        name = (match.group("name") or "").strip().lower()
        if not name:
            continue
        attrs[name] = unescape((match.group("value") or "").strip())
    return attrs


def _parse_letterboxd_watchlist_html_page(html_text: str) -> tuple[list[LetterboxdWatchlistEntry], int]:
    text = html_text or ""
    max_page = 1
    for page_match in LETTERBOXD_WATCHLIST_PAGE_RE.finditer(text):
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


def _looks_like_cloudflare_challenge(resp: httpx.Response) -> bool:
    if resp.headers.get("cf-mitigated"):
        return True
    lowered = (resp.text or "").lower()
    return "just a moment" in lowered and "cloudflare" in lowered


def _text_contains_any(text: str, markers: tuple[str, ...]) -> bool:
    lowered = (text or "").lower()
    return any(marker in lowered for marker in markers)


def _normalize_title_for_match(value: str) -> str:
    normalized = unescape(str(value or "")).lower()
    normalized = normalized.replace("&", " and ")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def _score_tmdb_candidate(entry: LetterboxdWatchlistEntry, candidate: dict) -> float:
    entry_title = _normalize_title_for_match(entry.title)
    candidate_title = _normalize_title_for_match(
        str(candidate.get("title") or candidate.get("original_title") or "")
    )
    if not entry_title or not candidate_title:
        return -1_000.0

    score = SequenceMatcher(None, entry_title, candidate_title).ratio() * 100.0
    if entry_title == candidate_title:
        score += 28.0
    elif candidate_title.startswith(entry_title) or entry_title.startswith(candidate_title):
        score += 12.0

    candidate_year = _coerce_year(str(candidate.get("release_date") or ""))
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


async def _resolve_tmdb_movie(entry: LetterboxdWatchlistEntry) -> dict | None:
    query = entry.title.strip()
    if not query:
        return None

    candidates: dict[int, dict] = {}
    try:
        if entry.year is not None:
            with_year = await tmdb.search_movie(query, page=1, year=entry.year)
            for row in with_year.get("results", []):
                movie_id = row.get("id")
                if isinstance(movie_id, int) and movie_id > 0:
                    candidates[movie_id] = row

        without_year = await tmdb.search_movie(query, page=1)
        for row in without_year.get("results", []):
            movie_id = row.get("id")
            if isinstance(movie_id, int) and movie_id > 0:
                candidates[movie_id] = row
    except Exception:
        return None

    best_row: dict | None = None
    best_score = -1_000.0
    for row in candidates.values():
        score = _score_tmdb_candidate(entry, row)
        if score > best_score:
            best_score = score
            best_row = row

    if not best_row:
        return None
    minimum_score = 52.0 if entry.year is not None else 63.0
    if best_score < minimum_score:
        return None
    return best_row


def _entry_resolution_key(entry: LetterboxdWatchlistEntry) -> tuple[str, int | None]:
    return (_normalize_title_for_match(entry.title), entry.year)


async def _resolve_tmdb_movies_bounded(entries: list[LetterboxdWatchlistEntry]) -> list[dict | None]:
    if not entries:
        return []

    semaphore = asyncio.Semaphore(max(1, LETTERBOXD_RESOLVE_CONCURRENCY))
    results: list[dict | None] = [None] * len(entries)

    async def _worker(index: int, entry: LetterboxdWatchlistEntry) -> None:
        async with semaphore:
            try:
                results[index] = await _resolve_tmdb_movie(entry)
            except Exception:
                results[index] = None

    await asyncio.gather(*(_worker(i, entry) for i, entry in enumerate(entries)))
    return results


async def _fetch_letterboxd_watchlist(username: str) -> tuple[str, str, list[LetterboxdWatchlistEntry]]:
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
    watchlist_url = f"{LETTERBOXD_BASE_URL}/{username}/watchlist/"
    watchlist_rss_url = f"{watchlist_url}rss/"

    async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=headers) as client:
        try:
            rss_resp = await client.get(watchlist_rss_url, headers=rss_headers)
        except Exception:
            return (
                "unreachable",
                "Could not connect to Letterboxd right now. Please try again.",
                [],
            )

        blocked_detected = False
        watchlist_blocked = False
        rss_entries: list[LetterboxdWatchlistEntry] = []
        rss_is_feed = rss_resp.status_code == 200 and "<rss" in (rss_resp.text or "").lower()
        if rss_is_feed:
            rss_entries = _parse_letterboxd_watchlist_rss(rss_resp.text)
            if rss_entries:
                return ("ok", "Watchlist synced from Letterboxd.", rss_entries)

        rss_text = rss_resp.text or ""
        if _text_contains_any(rss_text, LETTERBOXD_PRIVATE_MARKERS):
            return (
                "private",
                "This Letterboxd account is private, so FullStreamer cannot sync its watchlist.",
                [],
            )

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
                    "This Letterboxd account is private, so FullStreamer cannot sync its watchlist.",
                    [],
                )
            if profile_resp.status_code == 404 or _text_contains_any(profile_text, LETTERBOXD_NOT_FOUND_MARKERS):
                return ("not_found", "Letterboxd user was not found.", [])

        try:
            watchlist_resp = await client.get(watchlist_url)
        except Exception:
            watchlist_resp = None

        if watchlist_resp is not None:
            if _looks_like_cloudflare_challenge(watchlist_resp):
                blocked_detected = True
                watchlist_blocked = True
            else:
                watchlist_text = watchlist_resp.text or ""
                if _text_contains_any(watchlist_text, LETTERBOXD_PRIVATE_MARKERS):
                    return (
                        "private",
                        "This Letterboxd account is private, so FullStreamer cannot sync its watchlist.",
                        [],
                    )
                if watchlist_resp.status_code == 200:
                    all_entries: list[LetterboxdWatchlistEntry] = []
                    seen_keys: set[tuple[str, int | None]] = set()

                    page_entries, max_pages = _parse_letterboxd_watchlist_html_page(watchlist_resp.text or "")
                    for entry in page_entries:
                        key = (entry.title.lower(), entry.year)
                        if key in seen_keys:
                            continue
                        seen_keys.add(key)
                        all_entries.append(entry)

                    current_page = 2
                    while current_page <= max_pages and len(all_entries) < LETTERBOXD_IMPORT_LIMIT:
                        page_url = f"{watchlist_url}page/{current_page}/"
                        try:
                            page_resp = await client.get(page_url)
                        except Exception:
                            break

                        if _looks_like_cloudflare_challenge(page_resp):
                            blocked_detected = True
                            watchlist_blocked = True
                            break

                        page_text = page_resp.text or ""
                        if _text_contains_any(page_text, LETTERBOXD_PRIVATE_MARKERS):
                            return (
                                "private",
                                "This Letterboxd account is private, so FullStreamer cannot sync its watchlist.",
                                [],
                            )

                        if page_resp.status_code != 200:
                            break

                        parsed_entries, page_count_hint = _parse_letterboxd_watchlist_html_page(page_text)
                        if page_count_hint > max_pages:
                            max_pages = page_count_hint
                        for entry in parsed_entries:
                            key = (entry.title.lower(), entry.year)
                            if key in seen_keys:
                                continue
                            seen_keys.add(key)
                            all_entries.append(entry)
                            if len(all_entries) >= LETTERBOXD_IMPORT_LIMIT:
                                break

                        current_page += 1

                    if all_entries:
                        return ("ok", "Watchlist synced from Letterboxd.", all_entries)
                    if watchlist_blocked:
                        return (
                            "blocked",
                            "Letterboxd blocked automated access from this server. Please try again later.",
                            [],
                        )
                    return ("empty", "No public films found in this Letterboxd watchlist.", [])

                if watchlist_resp.status_code == 404:
                    if profile_resp is not None and profile_resp.status_code == 200:
                        return ("empty", "No public films found in this Letterboxd watchlist.", [])
                    return ("not_found", "Letterboxd user was not found.", [])

        if watchlist_blocked or (blocked_detected and watchlist_resp is None):
            return (
                "blocked",
                "Letterboxd blocked automated access from this server. Please try again later.",
                [],
            )

        if rss_resp.status_code == 404:
            if profile_resp is not None and profile_resp.status_code == 200:
                return ("empty", "No public films found in this Letterboxd watchlist.", [])
            return ("not_found", "Letterboxd user was not found.", [])

        if rss_is_feed:
            return ("empty", "No public films found in this Letterboxd watchlist.", [])

        return (
            "unreachable",
            "Could not read this Letterboxd watchlist right now. Please try again.",
            [],
        )


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


@router.get("")
async def list_watchlist(
    limit: int = Query(500, ge=1, le=2000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(WatchlistItem)
            .where(WatchlistItem.user_id == user.id)
            .order_by(WatchlistItem.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return {"results": [_serialize_watchlist_item(row) for row in rows]}


@router.post("")
async def add_watchlist_item(
    body: AddWatchlistRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    normalized_title = body.title.strip()
    if not normalized_title:
        raise HTTPException(status_code=400, detail="Title is required")
    poster_path = (body.poster_path or "").strip() or None
    release_date = (body.release_date or "").strip() or None

    existing = (
        await db.execute(
            select(WatchlistItem).where(
                WatchlistItem.user_id == user.id,
                WatchlistItem.media_type == body.media_type,
                WatchlistItem.tmdb_id == body.tmdb_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.title = normalized_title
        existing.poster_path = poster_path
        existing.release_date = release_date
        await db.commit()
        return {"ok": True, "item": _serialize_watchlist_item(existing), "already_exists": True}

    item = WatchlistItem(
        user_id=user.id,
        tmdb_id=body.tmdb_id,
        media_type=body.media_type,
        title=normalized_title,
        poster_path=poster_path,
        release_date=release_date,
        created_at=datetime.now(timezone.utc),
    )
    db.add(item)
    await db.commit()
    return {"ok": True, "item": _serialize_watchlist_item(item), "already_exists": False}


@router.get("/sync/letterboxd/status")
async def letterboxd_sync_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prefs = (
        await db.execute(select(UserPreferences).where(UserPreferences.user_id == user.id))
    ).scalar_one_or_none()
    return _serialize_letterboxd_sync_state(prefs)


@router.delete("/sync/letterboxd")
async def unlink_letterboxd_watchlist_sync(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prefs = await _get_or_create_preferences(db, user.id)
    previous_username = (prefs.letterboxd_username or "").strip()

    prefs.letterboxd_username = None
    prefs.letterboxd_watchlist_sync_status = None
    prefs.letterboxd_watchlist_sync_message = None
    prefs.letterboxd_watchlist_last_sync_at = None

    if previous_username:
        add_audit_log(
            db,
            action="user.watchlist_unlink_letterboxd",
            message=f"Letterboxd watchlist link removed ({previous_username}).",
            actor_user=user,
            target_user=user,
        )

    await db.commit()
    return {
        "ok": True,
        **_serialize_letterboxd_sync_state(prefs),
    }


@router.post("/sync/letterboxd")
async def sync_watchlist_from_letterboxd(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sync_time = datetime.now(timezone.utc)
    prefs = await _get_or_create_preferences(db, user.id)
    zip_bytes = await file.read()
    export_bundle = _parse_letterboxd_export_zip_bytes(zip_bytes)
    username = (export_bundle.username or "").strip()
    entries = list(export_bundle.watchlist_entries)
    limit_applied = False
    if len(entries) > LETTERBOXD_IMPORT_LIMIT:
        entries = entries[:LETTERBOXD_IMPORT_LIMIT]
        limit_applied = True
    if not entries:
        empty_message = "No titles found in watchlist.csv in this Letterboxd export."
        prefs.letterboxd_username = username or None
        prefs.letterboxd_watchlist_sync_status = "empty"
        prefs.letterboxd_watchlist_sync_message = empty_message
        prefs.letterboxd_watchlist_last_sync_at = sync_time
        add_audit_log(
            db,
            action="user.watchlist_sync_letterboxd",
            message="Letterboxd watchlist ZIP sync completed with no importable titles.",
            actor_user=user,
            target_user=user,
        )
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
            select(WatchlistItem).where(
                WatchlistItem.user_id == user.id,
                WatchlistItem.media_type == "movie",
            )
        )
    ).scalars().all()
    existing_by_tmdb_id = {int(row.tmdb_id): row for row in existing_rows}

    total_items = len(entries)
    added_count = 0
    already_exists_count = 0
    unmatched_count = 0
    seen_import_ids: set[int] = set()
    pending_items: list[WatchlistItem] = []

    # Resolve unique title/year pairs once, then fan out to duplicates.
    unique_entries: list[LetterboxdWatchlistEntry] = []
    unique_keys: list[tuple[str, int | None]] = []
    seen_unique: set[tuple[str, int | None]] = set()
    for entry in entries:
        key = _entry_resolution_key(entry)
        if key in seen_unique:
            continue
        seen_unique.add(key)
        unique_keys.append(key)
        unique_entries.append(entry)

    resolved_unique = await _resolve_tmdb_movies_bounded(unique_entries)
    resolved_by_key = {key: resolved_unique[i] for i, key in enumerate(unique_keys)}

    for entry in entries:
        resolved = resolved_by_key.get(_entry_resolution_key(entry))
        if not resolved:
            unmatched_count += 1
            continue

        tmdb_id = int(resolved.get("id") or 0)
        if tmdb_id <= 0:
            unmatched_count += 1
            continue

        if tmdb_id in seen_import_ids:
            already_exists_count += 1
            continue
        seen_import_ids.add(tmdb_id)

        title = str(resolved.get("title") or entry.title).strip() or entry.title
        poster_path = str(resolved.get("poster_path") or "").strip() or None
        release_date = str(resolved.get("release_date") or "").strip() or None
        existing_row = existing_by_tmdb_id.get(tmdb_id)
        if existing_row:
            existing_row.title = title
            existing_row.poster_path = poster_path
            existing_row.release_date = release_date
            already_exists_count += 1
            continue

        pending_items.append(
            WatchlistItem(
                user_id=user.id,
                tmdb_id=tmdb_id,
                media_type="movie",
                title=title,
                poster_path=poster_path,
                release_date=release_date,
                created_at=datetime.now(timezone.utc),
            )
        )
        added_count += 1

    if pending_items:
        db.add_all(pending_items)

    if total_items > 0 and added_count == 0 and already_exists_count == 0:
        status = "no_matches"
        message = "No titles could be matched from Letterboxd to TMDB."
    else:
        status = "ok"
        message = (
            f"Synced Letterboxd watchlist. Added {added_count}. "
            f"{already_exists_count} already in watchlist. "
            f"{unmatched_count} unmatched."
        )
    if limit_applied:
        message = f"{message} Imported the first {LETTERBOXD_IMPORT_LIMIT} titles."

    prefs.letterboxd_username = username or None
    prefs.letterboxd_watchlist_sync_status = status
    prefs.letterboxd_watchlist_sync_message = message
    prefs.letterboxd_watchlist_last_sync_at = sync_time

    add_audit_log(
        db,
        action="user.watchlist_sync_letterboxd",
        message=(
            f"Letterboxd watchlist sync completed. Added {added_count}, "
            f"existing {already_exists_count}, unmatched {unmatched_count}."
        ),
        actor_user=user,
        target_user=user,
    )
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


@router.delete("/{media_type}/{tmdb_id:int}")
async def remove_watchlist_item(
    media_type: Literal["movie", "tv"],
    tmdb_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if tmdb_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid tmdb id")
    row = (
        await db.execute(
            select(WatchlistItem).where(
                WatchlistItem.user_id == user.id,
                WatchlistItem.media_type == media_type,
                WatchlistItem.tmdb_id == tmdb_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        return {"ok": True, "removed": False}
    await db.delete(row)
    await db.commit()
    return {"ok": True, "removed": True}
