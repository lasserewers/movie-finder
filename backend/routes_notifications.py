import asyncio
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user, get_current_premium_user
from .audit import add_audit_log
from .database import get_db
from .models import NotificationSubscription, User, UserNotification, UserPreferences
from . import mailer, tmdb

router = APIRouter(
    prefix="/api/notifications",
    tags=["notifications"],
    dependencies=[Depends(get_current_premium_user)],
)

CONDITION_AVAILABLE_PRIMARY = "available_primary"
# Current stream-focused conditions
CONDITION_STREAM_PRIMARY = "stream_primary"
CONDITION_STREAM_VPN = "stream_vpn"
# Legacy conditions kept for backward compatibility with existing subscriptions.
CONDITION_STREAM_HOME_COUNTRY = "stream_home_country"
CONDITION_STREAM_MY_SERVICES_PRIMARY = "stream_my_services_primary"
CONDITION_STREAM_MY_SERVICES_ANY = "stream_my_services_any"
CONDITION_TYPES = {
    CONDITION_AVAILABLE_PRIMARY,
    CONDITION_STREAM_PRIMARY,
    CONDITION_STREAM_VPN,
}

STREAM_KEYS = ("flatrate", "free", "ads")
PAID_KEYS = ("rent", "buy")


def _normalize_country_codes(values: list[str] | None) -> list[str]:
    if not values:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for raw in values:
        if not isinstance(raw, str):
            continue
        code = raw.strip().upper()
        if len(code) != 2 or not code.isalpha() or code in seen:
            continue
        seen.add(code)
        out.append(code)
    return out


async def _get_user_prefs(db: AsyncSession, user_id: uuid.UUID) -> UserPreferences | None:
    return (
        await db.execute(
            select(UserPreferences).where(UserPreferences.user_id == user_id)
        )
    ).scalar_one_or_none()


async def _ensure_user_prefs(db: AsyncSession, user_id: uuid.UUID) -> UserPreferences:
    prefs = await _get_user_prefs(db, user_id)
    if prefs:
        return prefs
    prefs = UserPreferences(user_id=user_id)
    db.add(prefs)
    await db.flush()
    return prefs


def _primary_countries_from_prefs(prefs: UserPreferences | None) -> list[str]:
    countries = _normalize_country_codes(list(prefs.countries) if prefs and prefs.countries else [])
    return countries or ["US"]


def _delivery_mode_from_flags(deliver_in_app: bool, deliver_email: bool) -> str:
    if deliver_in_app and deliver_email:
        return "both"
    if deliver_email:
        return "email"
    return "in_app"


def _delivery_flags_from_mode(mode: str) -> tuple[bool, bool]:
    normalized = mode.strip().lower()
    if normalized == "both":
        return (True, True)
    if normalized == "email":
        return (False, True)
    return (True, False)


def _delivery_from_prefs(prefs: UserPreferences | None) -> tuple[bool, bool]:
    if not prefs:
        return (True, False)
    deliver_in_app = bool(prefs.notification_deliver_in_app)
    deliver_email = bool(prefs.notification_deliver_email)
    if not deliver_in_app and not deliver_email:
        # Keep at least one delivery channel enabled.
        return (True, False)
    return (deliver_in_app, deliver_email)


def _home_country_from_primary(primary_countries: list[str]) -> str:
    return primary_countries[0] if primary_countries else "US"


def _provider_ids_for_types(region: dict, types: tuple[str, ...]) -> set[int]:
    ids: set[int] = set()
    for key in types:
        offers = region.get(key) or []
        if not isinstance(offers, list):
            continue
        for provider in offers:
            pid = provider.get("provider_id") if isinstance(provider, dict) else None
            if isinstance(pid, int):
                ids.add(pid)
    return ids


def _availability_summary(
    providers: dict,
    *,
    primary_countries: list[str],
    service_ids: set[int],
) -> dict:
    normalized_map: dict[str, dict] = {}
    for code, region in (providers or {}).items():
        if not isinstance(code, str) or not isinstance(region, dict):
            continue
        normalized_map[code.strip().upper()] = region

    stream_countries: set[str] = set()
    available_countries: set[str] = set()
    stream_my_services_countries: set[str] = set()

    for code, region in normalized_map.items():
        stream_provider_ids = _provider_ids_for_types(region, STREAM_KEYS)
        paid_provider_ids = _provider_ids_for_types(region, PAID_KEYS)
        if stream_provider_ids:
            stream_countries.add(code)
        if stream_provider_ids or paid_provider_ids:
            available_countries.add(code)
        if service_ids and stream_provider_ids.intersection(service_ids):
            stream_my_services_countries.add(code)

    primary_set = set(primary_countries)
    home_country = _home_country_from_primary(primary_countries)

    has_rent_buy_only_in_primary = False
    for code in primary_countries:
        region = normalized_map.get(code)
        if not region:
            continue
        has_stream = bool(_provider_ids_for_types(region, STREAM_KEYS))
        has_paid = bool(_provider_ids_for_types(region, PAID_KEYS))
        if has_paid and not has_stream:
            has_rent_buy_only_in_primary = True
            break

    return {
        "available_anywhere": bool(available_countries),
        "stream_anywhere": bool(stream_countries),
        "stream_in_primary": bool(primary_set.intersection(stream_countries)),
        "available_in_primary": bool(primary_set.intersection(available_countries)),
        "stream_in_home_country": home_country in stream_countries,
        "stream_on_my_services_primary": bool(primary_set.intersection(stream_my_services_countries)),
        "stream_on_my_services_any": bool(stream_my_services_countries),
        "has_rent_buy_only_in_primary": has_rent_buy_only_in_primary,
        "primary_countries": primary_countries,
        "home_country": home_country,
        "configured_services": bool(service_ids),
    }


def _condition_label(condition_type: str, *, home_country: str) -> str:
    if condition_type == CONDITION_AVAILABLE_PRIMARY:
        return "Available in one of my primary countries"
    if condition_type == CONDITION_STREAM_PRIMARY:
        return "Streamable"
    if condition_type == CONDITION_STREAM_VPN:
        return "Streamable with VPN"
    if condition_type == CONDITION_STREAM_HOME_COUNTRY:
        return f"Streamable in {home_country} (legacy)"
    if condition_type == CONDITION_STREAM_MY_SERVICES_PRIMARY:
        return "Streamable on my services in primary countries (legacy)"
    if condition_type == CONDITION_STREAM_MY_SERVICES_ANY:
        return "Streamable on my services in any country (legacy)"
    return "Availability update"


def _condition_description(condition_type: str) -> str:
    if condition_type == CONDITION_AVAILABLE_PRIMARY:
        return "Includes streaming, rent, and buy options."
    if condition_type == CONDITION_STREAM_PRIMARY:
        return "Notifies you when this title is streamable on one of your selected services in your primary countries."
    if condition_type == CONDITION_STREAM_VPN:
        return "Notifies you when this title is streamable on one of your selected services in any country."
    if condition_type == CONDITION_STREAM_HOME_COUNTRY:
        return "Notifies you when this title can be streamed in your main country on any service."
    if condition_type == CONDITION_STREAM_MY_SERVICES_PRIMARY:
        return "Uses only your selected services and your primary countries."
    if condition_type == CONDITION_STREAM_MY_SERVICES_ANY:
        return "Uses only your selected services across all countries."
    return ""


def _is_condition_met(condition_type: str, summary: dict) -> bool:
    if condition_type == CONDITION_AVAILABLE_PRIMARY:
        return bool(summary.get("available_in_primary"))
    if condition_type == CONDITION_STREAM_PRIMARY:
        return bool(summary.get("stream_on_my_services_primary"))
    if condition_type == CONDITION_STREAM_VPN:
        return bool(summary.get("stream_on_my_services_any"))
    if condition_type == CONDITION_STREAM_HOME_COUNTRY:
        return bool(summary.get("stream_in_home_country"))
    if condition_type == CONDITION_STREAM_MY_SERVICES_PRIMARY:
        return bool(summary.get("stream_on_my_services_primary"))
    if condition_type == CONDITION_STREAM_MY_SERVICES_ANY:
        return bool(summary.get("stream_on_my_services_any"))
    return False


def _notification_message(title: str, condition_type: str, summary: dict) -> str:
    home_country = summary.get("home_country") or "your country"
    if condition_type == CONDITION_AVAILABLE_PRIMARY:
        return f"{title} is now available in one of your primary countries."
    if condition_type == CONDITION_STREAM_PRIMARY:
        return f"{title} is now streamable on one of your selected services in your primary countries."
    if condition_type == CONDITION_STREAM_VPN:
        return f"{title} is now streamable on one of your selected services in at least one country."
    if condition_type == CONDITION_STREAM_HOME_COUNTRY:
        return f"{title} is now streamable in {home_country}."
    if condition_type == CONDITION_STREAM_MY_SERVICES_PRIMARY:
        return f"{title} is now streamable on one of your selected services in your primary countries."
    if condition_type == CONDITION_STREAM_MY_SERVICES_ANY:
        return f"{title} is now streamable on one of your selected services in at least one country."
    return f"Availability changed for {title}."


def _already_true_detail(condition_type: str, summary: dict) -> str:
    primary_countries = summary.get("primary_countries") or []
    primary_scope = "your primary country" if len(primary_countries) <= 1 else "one of your primary countries"
    if condition_type == CONDITION_AVAILABLE_PRIMARY:
        return f"This title is already available in {primary_scope}."
    if condition_type == CONDITION_STREAM_PRIMARY:
        return (
            "This title is already streamable on one of your selected services "
            f"in {primary_scope}."
        )
    if condition_type == CONDITION_STREAM_VPN:
        return "This title is already streamable on one of your selected services with VPN."
    if condition_type == CONDITION_STREAM_HOME_COUNTRY:
        return "This title is already streamable in your main country."
    if condition_type == CONDITION_STREAM_MY_SERVICES_PRIMARY:
        return (
            "This title is already streamable on one of your selected services "
            f"in {primary_scope}."
        )
    if condition_type == CONDITION_STREAM_MY_SERVICES_ANY:
        return "This title is already streamable on one of your selected services with VPN."
    return "This notification condition is already true for this title."


def _serialize_subscription(subscription: NotificationSubscription, *, home_country: str) -> dict:
    return {
        "id": str(subscription.id),
        "media_type": subscription.media_type,
        "tmdb_id": int(subscription.tmdb_id),
        "title": subscription.title,
        "poster_path": subscription.poster_path,
        "condition_type": subscription.condition_type,
        "condition_label": _condition_label(subscription.condition_type, home_country=home_country),
        "deliver_in_app": bool(subscription.deliver_in_app),
        "deliver_email": bool(subscription.deliver_email),
        "is_active": bool(subscription.is_active),
        "created_at": subscription.created_at.isoformat() if subscription.created_at else None,
        "triggered_at": subscription.triggered_at.isoformat() if subscription.triggered_at else None,
    }


def _serialize_notification(notification: UserNotification) -> dict:
    return {
        "id": str(notification.id),
        "media_type": notification.media_type,
        "tmdb_id": int(notification.tmdb_id),
        "title": notification.title,
        "poster_path": notification.poster_path,
        "condition_type": notification.condition_type,
        "message": notification.message,
        "is_read": bool(notification.is_read),
        "created_at": notification.created_at.isoformat() if notification.created_at else None,
        "read_at": notification.read_at.isoformat() if notification.read_at else None,
    }


async def _get_media_providers(media_type: str, tmdb_id: int) -> dict:
    if media_type == "tv":
        return await tmdb.get_tv_watch_providers(tmdb_id)
    return await tmdb.get_watch_providers(tmdb_id)


async def _process_user_subscriptions(
    db: AsyncSession,
    *,
    user: User,
    prefs: UserPreferences | None,
) -> None:
    active_subscriptions = (
        await db.execute(
            select(NotificationSubscription)
            .where(
                NotificationSubscription.user_id == user.id,
                NotificationSubscription.is_active.is_(True),
            )
            .order_by(NotificationSubscription.created_at.asc())
        )
    ).scalars().all()
    if not active_subscriptions:
        return

    primary_countries = _primary_countries_from_prefs(prefs)
    service_ids = set(prefs.provider_ids or []) if prefs and prefs.provider_ids else set()
    providers_cache: dict[tuple[str, int], dict] = {}
    poster_cache: dict[tuple[str, int], str | None] = {}
    now = datetime.now(timezone.utc)
    pending_emails: list[tuple[str, str, str, int, str | None, str | None]] = []
    touched = False

    for subscription in active_subscriptions:
        try:
            tmdb_id = int(subscription.tmdb_id)
        except (TypeError, ValueError):
            tmdb_id = 0
        if tmdb_id <= 0:
            subscription.last_checked_at = now
            touched = True
            continue

        media_key = (subscription.media_type, tmdb_id)
        if media_key not in providers_cache:
            try:
                providers_cache[media_key] = await _get_media_providers(subscription.media_type, tmdb_id)
            except Exception:
                providers_cache[media_key] = {}
        providers = providers_cache[media_key]
        summary = _availability_summary(
            providers,
            primary_countries=primary_countries,
            service_ids=service_ids,
        )
        subscription.last_checked_at = now
        if not _is_condition_met(subscription.condition_type, summary):
            touched = True
            continue

        subscription.is_active = False
        subscription.triggered_at = now
        touched = True

        message = _notification_message(subscription.title, subscription.condition_type, summary)
        poster_path = (subscription.poster_path or "").strip() or None
        notification_id_for_email: str | None = None
        if not poster_path:
            if media_key not in poster_cache:
                try:
                    if subscription.media_type == "tv":
                        details = await tmdb.get_tv_score_details(tmdb_id)
                    else:
                        details = await tmdb.get_movie_score_details(tmdb_id)
                    poster_cache[media_key] = (details.get("poster_path") or "").strip() or None
                except Exception:
                    poster_cache[media_key] = None
            poster_path = poster_cache[media_key]
            if poster_path and subscription.poster_path != poster_path:
                subscription.poster_path = poster_path

        if subscription.deliver_in_app:
            notification_uuid = uuid.uuid4()
            notification_id_for_email = str(notification_uuid)
            db.add(
                UserNotification(
                    id=notification_uuid,
                    user_id=user.id,
                    subscription_id=subscription.id,
                    media_type=subscription.media_type,
                    tmdb_id=tmdb_id,
                    title=subscription.title,
                    poster_path=poster_path,
                    condition_type=subscription.condition_type,
                    message=message,
                    is_read=False,
                    created_at=now,
                )
            )

        add_audit_log(
            db,
            action="user.notification_triggered",
            message=f"Availability alert triggered for {subscription.title}.",
            actor_user=user,
            target_user=user,
        )

        if subscription.deliver_email:
            pending_emails.append(
                (
                    subscription.title,
                    message,
                    subscription.media_type,
                    tmdb_id,
                    poster_path,
                    notification_id_for_email,
                )
            )

    if touched:
        await db.commit()

    for title, message, media_type, tmdb_id, poster_path, notification_id in pending_emails:
        asyncio.create_task(
            mailer.send_availability_notification_email(
                user.email,
                title=title,
                message=message,
                media_type=media_type,
                tmdb_id=tmdb_id,
                poster_path=poster_path,
                notification_id=notification_id,
            )
        )


def _scenario_and_cta(summary: dict) -> tuple[str, str]:
    if not summary.get("available_in_primary"):
        return ("not_available_in_primary", "Get notified when this title becomes available")
    if summary.get("has_rent_buy_only_in_primary") and not summary.get("stream_on_my_services_primary"):
        return ("rent_or_buy_only", "Get notified when this title becomes streamable on your selected services")
    if not summary.get("stream_on_my_services_primary") and summary.get("stream_on_my_services_any"):
        return (
            "streamable_with_vpn_only",
            "Get notified when this title is streamable on your selected services without VPN",
        )
    if not summary.get("stream_on_my_services_primary"):
        return (
            "not_streamable_on_selected_services",
            "Get notified when this title reaches your selected services",
        )
    return ("custom", "Set an availability alert")


async def _active_unique_subscriptions(db: AsyncSession, user_id: uuid.UUID) -> list[NotificationSubscription]:
    rows = (
        await db.execute(
            select(NotificationSubscription)
            .where(
                NotificationSubscription.user_id == user_id,
                NotificationSubscription.is_active.is_(True),
            )
            .order_by(NotificationSubscription.created_at.desc())
        )
    ).scalars().all()

    unique: list[NotificationSubscription] = []
    seen_keys: set[tuple[str, int]] = set()
    duplicates: list[NotificationSubscription] = []
    for row in rows:
        key = (row.media_type, int(row.tmdb_id))
        if key in seen_keys:
            duplicates.append(row)
            continue
        seen_keys.add(key)
        unique.append(row)

    if duplicates:
        now = datetime.now(timezone.utc)
        for row in duplicates:
            row.is_active = False
            row.triggered_at = now
        await db.commit()

    return unique


class CreateSubscriptionRequest(BaseModel):
    media_type: Literal["movie", "tv"]
    tmdb_id: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=500)
    poster_path: str | None = Field(default=None, max_length=500)
    condition_type: str = Field(min_length=3, max_length=80)
    delivery: Literal["in_app", "email", "both"] | None = None


class UpdateSubscriptionRequest(BaseModel):
    condition_type: str = Field(min_length=3, max_length=80)


class UpdateNotificationSettingsRequest(BaseModel):
    delivery: Literal["in_app", "email", "both"]


@router.get("/settings")
async def get_notification_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prefs = await _ensure_user_prefs(db, user.id)
    deliver_in_app, deliver_email = _delivery_from_prefs(prefs)
    return {
        "delivery": _delivery_mode_from_flags(deliver_in_app, deliver_email),
        "deliver_in_app": deliver_in_app,
        "deliver_email": deliver_email,
    }


@router.put("/settings")
async def update_notification_settings(
    body: UpdateNotificationSettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prefs = await _ensure_user_prefs(db, user.id)
    deliver_in_app, deliver_email = _delivery_flags_from_mode(body.delivery)
    prefs.notification_deliver_in_app = deliver_in_app
    prefs.notification_deliver_email = deliver_email

    result = await db.execute(
        update(NotificationSubscription)
        .where(
            NotificationSubscription.user_id == user.id,
            NotificationSubscription.is_active.is_(True),
        )
        .values(
            deliver_in_app=deliver_in_app,
            deliver_email=deliver_email,
        )
    )
    add_audit_log(
        db,
        action="user.notification_settings_updated",
        message=f"User updated notification delivery to {_delivery_mode_from_flags(deliver_in_app, deliver_email)}.",
        actor_user=user,
        target_user=user,
    )
    await db.commit()
    return {
        "ok": True,
        "delivery": _delivery_mode_from_flags(deliver_in_app, deliver_email),
        "deliver_in_app": deliver_in_app,
        "deliver_email": deliver_email,
        "updated_subscriptions": int(result.rowcount or 0),
    }


@router.get("/subscriptions")
async def list_active_subscriptions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prefs = await _get_user_prefs(db, user.id)
    primary_countries = _primary_countries_from_prefs(prefs)
    home_country = _home_country_from_primary(primary_countries)
    rows = await _active_unique_subscriptions(db, user.id)
    return {
        "results": [
            _serialize_subscription(row, home_country=home_country)
            for row in rows
        ],
    }


@router.get("/options/{media_type}/{tmdb_id}")
async def notification_options(
    media_type: Literal["movie", "tv"],
    tmdb_id: int = Path(..., ge=1),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prefs = await _get_user_prefs(db, user.id)
    primary_countries = _primary_countries_from_prefs(prefs)
    service_ids = set(prefs.provider_ids or []) if prefs and prefs.provider_ids else set()
    try:
        providers = await _get_media_providers(media_type, tmdb_id)
    except Exception:
        raise HTTPException(status_code=502, detail="Could not load title availability right now")
    summary = _availability_summary(
        providers,
        primary_countries=primary_countries,
        service_ids=service_ids,
    )
    home_country = str(summary.get("home_country") or "US")

    active_subscriptions = (
        await db.execute(
            select(NotificationSubscription.id, NotificationSubscription.condition_type).where(
                NotificationSubscription.user_id == user.id,
                NotificationSubscription.media_type == media_type,
                NotificationSubscription.tmdb_id == tmdb_id,
                NotificationSubscription.is_active.is_(True),
            )
        )
    ).all()
    active_subscription_id_by_condition: dict[str, str] = {}
    for subscription_id, condition in active_subscriptions:
        if condition not in active_subscription_id_by_condition:
            active_subscription_id_by_condition[condition] = str(subscription_id)

    options: list[dict] = []
    for condition_type in (
        CONDITION_AVAILABLE_PRIMARY,
        CONDITION_STREAM_PRIMARY,
        CONDITION_STREAM_VPN,
    ):
        is_met = _is_condition_met(condition_type, summary)
        options.append(
            {
                "condition_type": condition_type,
                "label": _condition_label(condition_type, home_country=home_country),
                "description": _condition_description(condition_type),
                "currently_met": is_met,
                "already_subscribed": condition_type in active_subscription_id_by_condition,
                "active_subscription_id": active_subscription_id_by_condition.get(condition_type),
            }
        )

    scenario, cta_text = _scenario_and_cta(summary)
    show_button = any(not option["currently_met"] for option in options)
    return {
        "media_type": media_type,
        "tmdb_id": tmdb_id,
        "show_button": show_button,
        "scenario": scenario,
        "cta_text": cta_text,
        "options": options,
        "summary": {
            "primary_countries": primary_countries,
            "home_country": home_country,
            "configured_services": bool(service_ids),
            "available_in_primary": bool(summary.get("available_in_primary")),
            "stream_in_primary": bool(summary.get("stream_in_primary")),
            "stream_anywhere": bool(summary.get("stream_anywhere")),
            "stream_on_my_services_primary": bool(summary.get("stream_on_my_services_primary")),
            "stream_on_my_services_any": bool(summary.get("stream_on_my_services_any")),
        },
    }


@router.post("/subscriptions")
async def create_subscription(
    body: CreateSubscriptionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    condition_type = body.condition_type.strip().lower()
    if condition_type not in CONDITION_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported notification condition")

    normalized_title = body.title.strip()
    if not normalized_title:
        raise HTTPException(status_code=400, detail="Title is required")
    normalized_poster = (body.poster_path or "").strip() or None

    prefs = await _ensure_user_prefs(db, user.id)
    primary_countries = _primary_countries_from_prefs(prefs)
    service_ids = set(prefs.provider_ids or []) if prefs and prefs.provider_ids else set()
    try:
        providers = await _get_media_providers(body.media_type, body.tmdb_id)
    except Exception:
        raise HTTPException(status_code=502, detail="Could not load title availability right now")
    summary = _availability_summary(
        providers,
        primary_countries=primary_countries,
        service_ids=service_ids,
    )
    if _is_condition_met(condition_type, summary):
        raise HTTPException(status_code=400, detail=_already_true_detail(condition_type, summary))

    active_for_title = (
        await db.execute(
            select(NotificationSubscription).where(
                NotificationSubscription.user_id == user.id,
                NotificationSubscription.media_type == body.media_type,
                NotificationSubscription.tmdb_id == body.tmdb_id,
                NotificationSubscription.is_active.is_(True),
            )
            .order_by(NotificationSubscription.created_at.desc())
        )
    ).scalars().all()

    existing = next((row for row in active_for_title if row.condition_type == condition_type), None)
    if existing:
        if len(active_for_title) > 1:
            now = datetime.now(timezone.utc)
            for row in active_for_title:
                if row.id == existing.id:
                    continue
                row.is_active = False
                row.triggered_at = now
            await db.commit()
        return {
            "ok": True,
            "already_exists": True,
            "subscription": _serialize_subscription(existing, home_country=_home_country_from_primary(primary_countries)),
        }

    deliver_in_app, deliver_email = _delivery_from_prefs(prefs)
    if active_for_title:
        now = datetime.now(timezone.utc)
        for row in active_for_title:
            row.is_active = False
            row.triggered_at = now

    subscription = NotificationSubscription(
        user_id=user.id,
        media_type=body.media_type,
        tmdb_id=body.tmdb_id,
        title=normalized_title,
        poster_path=normalized_poster,
        condition_type=condition_type,
        deliver_in_app=deliver_in_app,
        deliver_email=deliver_email,
        is_active=True,
    )
    db.add(subscription)
    add_audit_log(
        db,
        action="user.notification_subscribed",
        message=(
            f"User subscribed to availability alert ({condition_type}) "
            f"for {normalized_title}."
        ),
        actor_user=user,
        target_user=user,
    )
    await db.commit()

    return {
        "ok": True,
        "already_exists": False,
        "subscription": _serialize_subscription(subscription, home_country=_home_country_from_primary(primary_countries)),
    }


@router.delete("/subscriptions/{subscription_id}")
async def cancel_subscription(
    subscription_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    subscription = (
        await db.execute(
            select(NotificationSubscription).where(
                NotificationSubscription.id == subscription_id,
                NotificationSubscription.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found")
    if not subscription.is_active:
        return {"ok": True, "cancelled": False}

    active_for_title = (
        await db.execute(
            select(NotificationSubscription).where(
                NotificationSubscription.user_id == user.id,
                NotificationSubscription.media_type == subscription.media_type,
                NotificationSubscription.tmdb_id == subscription.tmdb_id,
                NotificationSubscription.is_active.is_(True),
            )
        )
    ).scalars().all()
    now = datetime.now(timezone.utc)
    cancelled = False
    for row in active_for_title:
        row.is_active = False
        row.triggered_at = now
        cancelled = True
    add_audit_log(
        db,
        action="user.notification_cancelled",
        message=f"User cancelled availability alert for {subscription.title}.",
        actor_user=user,
        target_user=user,
    )
    await db.commit()
    return {"ok": True, "cancelled": cancelled}


@router.patch("/subscriptions/{subscription_id}")
async def update_subscription(
    subscription_id: uuid.UUID,
    body: UpdateSubscriptionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    subscription = (
        await db.execute(
            select(NotificationSubscription).where(
                NotificationSubscription.id == subscription_id,
                NotificationSubscription.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found")
    if not subscription.is_active:
        raise HTTPException(status_code=400, detail="Subscription is not active")

    condition_type = body.condition_type.strip().lower()
    if condition_type not in CONDITION_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported notification condition")

    prefs = await _ensure_user_prefs(db, user.id)
    primary_countries = _primary_countries_from_prefs(prefs)
    service_ids = set(prefs.provider_ids or []) if prefs and prefs.provider_ids else set()
    try:
        providers = await _get_media_providers(subscription.media_type, int(subscription.tmdb_id))
    except Exception:
        raise HTTPException(status_code=502, detail="Could not load title availability right now")
    summary = _availability_summary(
        providers,
        primary_countries=primary_countries,
        service_ids=service_ids,
    )
    if _is_condition_met(condition_type, summary):
        raise HTTPException(status_code=400, detail=_already_true_detail(condition_type, summary))

    active_for_title = (
        await db.execute(
            select(NotificationSubscription).where(
                NotificationSubscription.user_id == user.id,
                NotificationSubscription.media_type == subscription.media_type,
                NotificationSubscription.tmdb_id == subscription.tmdb_id,
                NotificationSubscription.is_active.is_(True),
            )
            .order_by(NotificationSubscription.created_at.desc())
        )
    ).scalars().all()

    existing_same = next((row for row in active_for_title if row.condition_type == condition_type), None)
    now = datetime.now(timezone.utc)

    if existing_same and existing_same.id != subscription.id:
        for row in active_for_title:
            if row.id == existing_same.id:
                continue
            row.is_active = False
            row.triggered_at = now
        deliver_in_app, deliver_email = _delivery_from_prefs(prefs)
        existing_same.deliver_in_app = deliver_in_app
        existing_same.deliver_email = deliver_email
        add_audit_log(
            db,
            action="user.notification_subscription_updated",
            message=(
                f"User switched availability alert for {existing_same.title} "
                f"to {condition_type}."
            ),
            actor_user=user,
            target_user=user,
        )
        await db.commit()
        return {
            "ok": True,
            "subscription": _serialize_subscription(existing_same, home_country=_home_country_from_primary(primary_countries)),
            "switched_to_existing": True,
        }

    for row in active_for_title:
        if row.id == subscription.id:
            continue
        row.is_active = False
        row.triggered_at = now

    deliver_in_app, deliver_email = _delivery_from_prefs(prefs)
    subscription.condition_type = condition_type
    subscription.deliver_in_app = deliver_in_app
    subscription.deliver_email = deliver_email
    subscription.is_active = True
    subscription.triggered_at = None
    add_audit_log(
        db,
        action="user.notification_subscription_updated",
        message=(
            f"User updated availability alert for {subscription.title} "
            f"to {condition_type}."
        ),
        actor_user=user,
        target_user=user,
    )
    await db.commit()
    return {
        "ok": True,
        "subscription": _serialize_subscription(subscription, home_country=_home_country_from_primary(primary_countries)),
        "switched_to_existing": False,
    }


@router.get("")
async def list_notifications(
    limit: int = Query(40, ge=1, le=200),
    unread_only: bool = False,
    refresh: bool = True,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prefs = await _get_user_prefs(db, user.id)
    if refresh:
        await _process_user_subscriptions(db, user=user, prefs=prefs)

    stmt = (
        select(UserNotification)
        .where(UserNotification.user_id == user.id)
        .order_by(UserNotification.created_at.desc())
        .limit(limit)
    )
    if unread_only:
        stmt = stmt.where(UserNotification.is_read.is_(False))

    rows = (await db.execute(stmt)).scalars().all()
    unread_count = int(
        (
            await db.scalar(
                select(func.count())
                .select_from(UserNotification)
                .where(
                    UserNotification.user_id == user.id,
                    UserNotification.is_read.is_(False),
                )
            )
        )
        or 0
    )
    active_alerts = int(
        (
            await db.scalar(
                select(func.count())
                .select_from(NotificationSubscription)
                .where(
                    NotificationSubscription.user_id == user.id,
                    NotificationSubscription.is_active.is_(True),
                )
            )
        )
        or 0
    )
    return {
        "results": [_serialize_notification(row) for row in rows],
        "unread_count": unread_count,
        "active_alerts": active_alerts,
    }


@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    notification = (
        await db.execute(
            select(UserNotification).where(
                UserNotification.id == notification_id,
                UserNotification.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    if not notification.is_read:
        notification.is_read = True
        notification.read_at = datetime.now(timezone.utc)
        await db.commit()
    return {"ok": True}


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    notification = (
        await db.execute(
            select(UserNotification).where(
                UserNotification.id == notification_id,
                UserNotification.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    title = notification.title
    await db.delete(notification)
    add_audit_log(
        db,
        action="user.notification_deleted",
        message=f"User deleted notification for {title}.",
        actor_user=user,
        target_user=user,
    )
    await db.commit()
    return {"ok": True}


@router.post("/read-all")
async def mark_all_notifications_read(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    result = await db.execute(
        update(UserNotification)
        .where(
            UserNotification.user_id == user.id,
            UserNotification.is_read.is_(False),
        )
        .values(is_read=True, read_at=now)
    )
    await db.commit()
    return {"ok": True, "updated": int(result.rowcount or 0)}
