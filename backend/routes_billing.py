import hashlib
import hmac
import json
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .audit import add_audit_log
from .auth import (
    SUBSCRIPTION_TIER_FREE_PREMIUM,
    SUBSCRIPTION_TIER_NON_PREMIUM,
    SUBSCRIPTION_TIER_PREMIUM,
    get_current_user,
    get_user_subscription_tier,
)
from .database import get_db
from .models import User, UserPreferences

router = APIRouter(prefix="/api/billing", tags=["billing"])

STRIPE_API_BASE_URL = os.environ.get("STRIPE_API_BASE_URL", "https://api.stripe.com/v1").rstrip("/")
BILLING_PLAN_MONTHLY = "monthly"
BILLING_PLAN_YEARLY = "yearly"
BillingPlan = Literal["monthly", "yearly"]
SUPPORTED_BILLING_CURRENCIES = ("EUR", "USD", "GBP")


class CreateCheckoutRequest(BaseModel):
    plan: BillingPlan = BILLING_PLAN_MONTHLY
    currency: str | None = None


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "")
    if raw is None or raw == "":
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _normalize_id(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_status(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized or None


def _normalize_currency(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().upper()
    if len(normalized) != 3:
        return None
    return normalized


def _normalize_country_code(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().upper()
    if len(normalized) != 2 or not normalized.isalpha():
        return None
    if normalized in {"XX", "ZZ", "T1"}:
        return None
    if normalized == "UK":
        return "GB"
    return normalized


def _normalize_event_name(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized or None


def _parse_unix_timestamp(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    try:
        timestamp = int(value)
    except (TypeError, ValueError):
        return None
    if timestamp <= 0:
        return None
    try:
        return datetime.fromtimestamp(timestamp, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _coerce_uuid(value: object) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _plan_price_env_key(plan: BillingPlan, currency: str | None = None) -> str:
    base_key = "STRIPE_YEARLY_PRICE_ID" if plan == BILLING_PLAN_YEARLY else "STRIPE_MONTHLY_PRICE_ID"
    normalized_currency = _normalize_currency(currency)
    if normalized_currency:
        return f"{base_key}_{normalized_currency}"
    return base_key


def _default_billing_currency() -> str:
    default_currency = _normalize_currency(_env("STRIPE_DEFAULT_CURRENCY"))
    if default_currency:
        return default_currency
    return "EUR"


def _parse_country_currency_map() -> dict[str, str]:
    raw = _env("STRIPE_COUNTRY_CURRENCY_MAP")
    if not raw:
        return {}

    mapping: dict[str, str] = {}
    chunks = [chunk.strip() for chunk in raw.replace(";", ",").split(",") if chunk.strip()]
    for chunk in chunks:
        if ":" not in chunk:
            continue
        country_raw, currency_raw = chunk.split(":", 1)
        country_code = _normalize_country_code(country_raw)
        currency = _normalize_currency(currency_raw)
        if not country_code or not currency:
            continue
        mapping[country_code] = currency
    return mapping


def _currency_for_country(country_code: str | None) -> str:
    normalized_country = _normalize_country_code(country_code)
    overrides = _parse_country_currency_map()
    if normalized_country and normalized_country in overrides:
        return overrides[normalized_country]

    # Reasonable defaults for launch: US -> USD, GB -> GBP, rest -> default (EUR).
    if normalized_country == "US":
        return "USD"
    if normalized_country == "GB":
        return "GBP"
    return _default_billing_currency()


def _plan_price_id(plan: BillingPlan, currency: str | None = None) -> str:
    normalized_currency = _normalize_currency(currency)
    if normalized_currency:
        by_currency = _env(_plan_price_env_key(plan, normalized_currency))
        if by_currency:
            return by_currency

        default_currency = _default_billing_currency()
        if normalized_currency != default_currency:
            default_price = _env(_plan_price_env_key(plan, default_currency))
            if default_price:
                return default_price

    return _env(_plan_price_env_key(plan))


def _plan_has_any_price_id(plan: BillingPlan) -> bool:
    if _env(_plan_price_env_key(plan)):
        return True

    # Support explicit per-currency IDs.
    currencies = set(SUPPORTED_BILLING_CURRENCIES)
    currencies.add(_default_billing_currency())
    currencies.update(_parse_country_currency_map().values())
    for currency in currencies:
        if _env(_plan_price_env_key(plan, currency)):
            return True
    return False


def _checkout_ready_for_plan(plan: BillingPlan) -> bool:
    return bool(_env("STRIPE_SECRET_KEY") and _plan_has_any_price_id(plan))


def _checkout_ready() -> bool:
    return bool(
        _env("STRIPE_SECRET_KEY")
        and (_plan_has_any_price_id(BILLING_PLAN_MONTHLY) or _plan_has_any_price_id(BILLING_PLAN_YEARLY))
    )


def _webhook_ready() -> bool:
    return bool(_env("STRIPE_WEBHOOK_SIGNING_SECRET"))


def _default_frontend_url() -> str:
    return _env("STRIPE_CHECKOUT_REDIRECT_URL") or _env("FRONTEND_PUBLIC_URL") or "https://fullstreamer.com"


def _build_checkout_redirect_url(plan: BillingPlan) -> str:
    base_url = _default_frontend_url()
    try:
        split_url = urlsplit(base_url)
        query_items = [
            (key, value)
            for key, value in parse_qsl(split_url.query, keep_blank_values=True)
            if key not in {"billing", "billing_plan"}
        ]
        query_items.append(("billing", "return"))
        query_items.append(("billing_plan", plan))
        rebuilt_query = urlencode(query_items, doseq=True)
        return urlunsplit(
            (split_url.scheme, split_url.netloc, split_url.path, rebuilt_query, split_url.fragment)
        )
    except Exception:
        return base_url


def _build_checkout_cancel_url(plan: BillingPlan, success_url: str) -> str:
    base_url = _env("STRIPE_CHECKOUT_CANCEL_URL") or _default_frontend_url()
    try:
        split_url = urlsplit(base_url)
        query_items = [
            (key, value)
            for key, value in parse_qsl(split_url.query, keep_blank_values=True)
            if key not in {"billing", "billing_plan"}
        ]
        query_items.append(("billing", "cancel"))
        query_items.append(("billing_plan", plan))
        rebuilt_query = urlencode(query_items, doseq=True)
        return urlunsplit(
            (split_url.scheme, split_url.netloc, split_url.path, rebuilt_query, split_url.fragment)
        )
    except Exception:
        return success_url


def _build_portal_return_url() -> str:
    return _env("STRIPE_PORTAL_RETURN_URL") or _default_frontend_url()


def _request_country_code(request: Request) -> str | None:
    candidate_headers = (
        "CF-IPCountry",  # Cloudflare
        "CloudFront-Viewer-Country",  # AWS CloudFront
        "X-Vercel-IP-Country",  # Vercel
        "X-AppEngine-Country",  # Google App Engine
    )
    for header_name in candidate_headers:
        candidate = _normalize_country_code(request.headers.get(header_name))
        if candidate:
            return candidate
    return None


def _primary_country_from_prefs(prefs: object) -> str | None:
    countries = getattr(prefs, "countries", None)
    if not isinstance(countries, list):
        return None
    for raw_country in countries:
        normalized = _normalize_country_code(raw_country)
        if normalized:
            return normalized
    return None


async def _checkout_country_code(db: AsyncSession, user: User, request: Request) -> str | None:
    request_country = _request_country_code(request)
    if request_country:
        return request_country

    prefs = await db.scalar(select(UserPreferences).where(UserPreferences.user_id == user.id))
    if prefs:
        prefs_country = _primary_country_from_prefs(prefs)
        if prefs_country:
            return prefs_country
    return None


def _stripe_headers(*, form_encoded: bool = False) -> dict[str, str]:
    secret_key = _env("STRIPE_SECRET_KEY")
    if not secret_key:
        raise HTTPException(status_code=503, detail="Stripe secret key is not configured.")
    headers = {
        "Authorization": f"Bearer {secret_key}",
    }
    if form_encoded:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    return headers


def _stripe_error_detail(response: httpx.Response) -> str:
    detail = response.text.strip() or "Unknown Stripe error."
    try:
        payload = response.json()
    except Exception:
        return detail
    error_obj = payload.get("error")
    if isinstance(error_obj, dict):
        return str(error_obj.get("message") or error_obj.get("code") or detail)
    message = payload.get("message")
    if isinstance(message, str) and message.strip():
        return message.strip()
    return detail


async def _stripe_request(
    method: str,
    path: str,
    *,
    data: dict[str, str] | None = None,
    params: dict[str, str] | list[tuple[str, str]] | None = None,
) -> dict:
    url = f"{STRIPE_API_BASE_URL}{path}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.request(
            method.upper(),
            url,
            headers=_stripe_headers(form_encoded=data is not None),
            data=data,
            params=params,
        )
    if response.status_code >= 400:
        detail = _stripe_error_detail(response)
        raise HTTPException(status_code=502, detail=f"Stripe API error: {detail}")
    try:
        body = response.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Stripe returned an invalid response.")
    if not isinstance(body, dict):
        raise HTTPException(status_code=502, detail="Stripe returned an invalid response.")
    return body


async def _ensure_stripe_customer(user: User) -> str:
    existing_customer_id = _normalize_id(getattr(user, "stripe_customer_id", None))
    if existing_customer_id:
        return existing_customer_id

    payload = {
        "email": user.email,
        "metadata[user_id]": str(user.id),
    }
    response = await _stripe_request("POST", "/customers", data=payload)
    customer_id = _normalize_id(response.get("id"))
    if not customer_id:
        raise HTTPException(status_code=502, detail="Stripe did not return a customer ID.")
    user.stripe_customer_id = customer_id
    return customer_id


async def _fetch_stripe_subscription(subscription_id: str) -> dict:
    response = await _stripe_request(
        "GET",
        f"/subscriptions/{subscription_id}",
        params={"expand[]": "items.data.price"},
    )
    return response


def _extract_subscription_price_id(attributes: dict) -> str | None:
    items = attributes.get("items")
    if not isinstance(items, dict):
        return None
    data = items.get("data")
    if not isinstance(data, list) or not data:
        return None
    first_item = data[0]
    if not isinstance(first_item, dict):
        return None
    price = first_item.get("price")
    if isinstance(price, dict):
        return _normalize_id(price.get("id"))
    return _normalize_id(first_item.get("price"))


def _status_grants_paid_access(status: str | None) -> bool:
    if not status:
        return False
    # Stripe statuses: incomplete, incomplete_expired, trialing, active,
    # past_due, canceled, unpaid, paused.
    return status in {"trialing", "active", "past_due", "unpaid"}


def _apply_subscription_snapshot(
    user: User,
    *,
    subscription_id: str | None,
    attributes: dict,
    event_name: str | None,
) -> str | None:
    if subscription_id:
        user.stripe_subscription_id = subscription_id

    customer_id = _normalize_id(attributes.get("customer"))
    if customer_id:
        user.stripe_customer_id = customer_id

    status = _normalize_status(attributes.get("status"))
    if status:
        user.stripe_subscription_status = status

    price_id = _extract_subscription_price_id(attributes)
    if price_id:
        user.stripe_price_id = price_id

    user.stripe_last_event_name = event_name
    user.stripe_last_event_at = datetime.now(timezone.utc)

    current_period_end = _parse_unix_timestamp(attributes.get("current_period_end"))
    if "current_period_end" in attributes:
        user.stripe_subscription_current_period_end = current_period_end

    cancel_at = _parse_unix_timestamp(attributes.get("cancel_at"))
    if "cancel_at" in attributes:
        user.stripe_subscription_cancel_at = cancel_at

    return status


async def _resolve_user_for_event(
    db: AsyncSession,
    *,
    data_object: dict,
    subscription_object: dict | None,
    subscription_id: str | None,
) -> User | None:
    metadata_candidates: list[dict] = []
    for candidate in (data_object, subscription_object):
        if not isinstance(candidate, dict):
            continue
        metadata = candidate.get("metadata")
        if isinstance(metadata, dict):
            metadata_candidates.append(metadata)

    for metadata in metadata_candidates:
        user_id = _coerce_uuid(metadata.get("user_id"))
        if user_id is None:
            continue
        user = await db.get(User, user_id)
        if user:
            return user

    client_reference_id = _coerce_uuid(data_object.get("client_reference_id"))
    if client_reference_id is not None:
        user = await db.get(User, client_reference_id)
        if user:
            return user

    customer_id = _normalize_id(
        (subscription_object or {}).get("customer")
        or data_object.get("customer")
    )
    if customer_id:
        user = await db.scalar(select(User).where(User.stripe_customer_id == customer_id))
        if user:
            return user

    if subscription_id:
        user = await db.scalar(select(User).where(User.stripe_subscription_id == subscription_id))
        if user:
            return user

    email_candidates = [
        data_object.get("customer_email"),
        data_object.get("email"),
    ]
    customer_details = data_object.get("customer_details")
    if isinstance(customer_details, dict):
        email_candidates.append(customer_details.get("email"))

    for raw_email in email_candidates:
        if not isinstance(raw_email, str):
            continue
        normalized_email = raw_email.strip().lower()
        if not normalized_email:
            continue
        user = await db.scalar(select(User).where(User.email == normalized_email))
        if user:
            return user

    return None


def _sync_paid_tier_from_status(user: User, status: str | None) -> tuple[str, str]:
    previous_tier = get_user_subscription_tier(user)
    current_tier = previous_tier
    has_paid_access = _status_grants_paid_access(status)

    if has_paid_access:
        if current_tier == SUBSCRIPTION_TIER_NON_PREMIUM:
            user.subscription_tier = SUBSCRIPTION_TIER_PREMIUM
    else:
        if current_tier == SUBSCRIPTION_TIER_PREMIUM:
            user.subscription_tier = SUBSCRIPTION_TIER_NON_PREMIUM
        # Keep admin-granted free premium untouched.
        elif current_tier == SUBSCRIPTION_TIER_FREE_PREMIUM:
            pass

    return previous_tier, get_user_subscription_tier(user)


def _verify_stripe_signature(raw_body: bytes, signature_header: str, signing_secret: str) -> bool:
    if not signature_header:
        return False

    timestamp: int | None = None
    signatures: list[str] = []
    for part in signature_header.split(","):
        token = part.strip()
        if "=" not in token:
            continue
        key, value = token.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key == "t":
            try:
                timestamp = int(value)
            except ValueError:
                return False
        elif key == "v1" and value:
            signatures.append(value)

    if timestamp is None or not signatures:
        return False

    tolerance_seconds = int(_env("STRIPE_WEBHOOK_TOLERANCE_SECONDS") or "300")
    if tolerance_seconds > 0 and abs(time.time() - timestamp) > tolerance_seconds:
        return False

    signed_payload = f"{timestamp}.".encode("utf-8") + raw_body
    expected = hmac.new(signing_secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, signature) for signature in signatures)


@router.get("/status")
async def get_billing_status(user: User = Depends(get_current_user)):
    tier = get_user_subscription_tier(user)
    monthly_checkout_configured = _checkout_ready_for_plan(BILLING_PLAN_MONTHLY)
    yearly_checkout_configured = _checkout_ready_for_plan(BILLING_PLAN_YEARLY)
    has_paid_subscription = bool(tier == SUBSCRIPTION_TIER_PREMIUM and (user.stripe_subscription_id or "").strip())
    return {
        "configured_checkout": _checkout_ready(),
        "configured_monthly_checkout": monthly_checkout_configured,
        "configured_yearly_checkout": yearly_checkout_configured,
        "configured_webhook": _webhook_ready(),
        "checkout_enabled": _checkout_ready() and tier == SUBSCRIPTION_TIER_NON_PREMIUM,
        "monthly_checkout_enabled": monthly_checkout_configured and tier == SUBSCRIPTION_TIER_NON_PREMIUM,
        "yearly_checkout_enabled": yearly_checkout_configured and tier == SUBSCRIPTION_TIER_NON_PREMIUM,
        "portal_enabled": bool(_env("STRIPE_SECRET_KEY") and ((user.stripe_customer_id or "").strip() or (user.stripe_subscription_id or "").strip())),
        "has_paid_subscription": has_paid_subscription,
        "subscription_status": user.stripe_subscription_status,
    }


@router.post("/checkout")
async def create_checkout_link(
    request: Request,
    checkout_request: CreateCheckoutRequest | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    selected_plan: BillingPlan = checkout_request.plan if checkout_request else BILLING_PLAN_MONTHLY
    requested_currency = _normalize_currency(checkout_request.currency) if checkout_request else None

    if not _checkout_ready():
        raise HTTPException(
            status_code=503,
            detail=(
                "Billing is not configured. Set STRIPE_SECRET_KEY and at least one of "
                "STRIPE_MONTHLY_PRICE_ID(_EUR/_USD/_GBP) / STRIPE_YEARLY_PRICE_ID(_EUR/_USD/_GBP)."
            ),
        )

    current_tier = get_user_subscription_tier(user)
    if current_tier != SUBSCRIPTION_TIER_NON_PREMIUM:
        if current_tier == SUBSCRIPTION_TIER_PREMIUM:
            raise HTTPException(status_code=400, detail="This account already has paid premium.")
        raise HTTPException(status_code=400, detail="Only non-premium accounts can start paid checkout.")

    checkout_country = await _checkout_country_code(db, user, request)
    selected_currency = requested_currency or _currency_for_country(checkout_country)
    price_id = _plan_price_id(selected_plan, currency=selected_currency)
    if not price_id:
        raise HTTPException(
            status_code=503,
            detail=(
                "Billing plan is not configured. "
                "Set STRIPE_MONTHLY_PRICE_ID_<CURRENCY> / STRIPE_YEARLY_PRICE_ID_<CURRENCY> "
                "(for example _EUR, _USD, _GBP)."
            ),
        )

    customer_id = await _ensure_stripe_customer(user)
    success_url = _build_checkout_redirect_url(selected_plan)
    cancel_url = _build_checkout_cancel_url(selected_plan, success_url)

    session_payload: dict[str, str] = {
        "mode": "subscription",
        "customer": customer_id,
        "line_items[0][price]": price_id,
        "line_items[0][quantity]": "1",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": str(user.id),
        "metadata[user_id]": str(user.id),
        "metadata[plan]": selected_plan,
        "metadata[currency]": selected_currency,
        "metadata[country]": checkout_country or "",
        "subscription_data[metadata][user_id]": str(user.id),
        "subscription_data[metadata][plan]": selected_plan,
        "subscription_data[metadata][currency]": selected_currency,
        "subscription_data[metadata][country]": checkout_country or "",
    }

    billing_address_collection = _env("STRIPE_BILLING_ADDRESS_COLLECTION")
    if billing_address_collection:
        session_payload["billing_address_collection"] = billing_address_collection
    if _env_bool("STRIPE_ALLOW_PROMOTION_CODES", default=True):
        session_payload["allow_promotion_codes"] = "true"
    if _env_bool("STRIPE_AUTOMATIC_TAX", default=False):
        session_payload["automatic_tax[enabled]"] = "true"
    if _env_bool("STRIPE_TAX_ID_COLLECTION", default=False):
        session_payload["tax_id_collection[enabled]"] = "true"

    session = await _stripe_request("POST", "/checkout/sessions", data=session_payload)
    checkout_url = _normalize_id(session.get("url"))
    if not checkout_url:
        raise HTTPException(status_code=502, detail="Could not create checkout URL.")

    session_customer_id = _normalize_id(session.get("customer"))
    if session_customer_id:
        user.stripe_customer_id = session_customer_id
    user.stripe_price_id = price_id
    user.stripe_last_event_name = "checkout_session_created"
    user.stripe_last_event_at = datetime.now(timezone.utc)
    await db.commit()

    return {
        "checkout_url": checkout_url,
        "plan": selected_plan,
        "currency": selected_currency,
        "country": checkout_country,
    }


@router.get("/portal")
async def get_customer_portal_url(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not _env("STRIPE_SECRET_KEY"):
        raise HTTPException(status_code=503, detail="Stripe secret key is not configured.")

    customer_id = _normalize_id(user.stripe_customer_id)
    subscription_id = _normalize_id(user.stripe_subscription_id)

    if not customer_id and subscription_id:
        subscription = await _fetch_stripe_subscription(subscription_id)
        customer_id = _normalize_id(subscription.get("customer"))

    if not customer_id:
        raise HTTPException(status_code=404, detail="No paid subscription found for this account.")

    user.stripe_customer_id = customer_id

    portal = await _stripe_request(
        "POST",
        "/billing_portal/sessions",
        data={
            "customer": customer_id,
            "return_url": _build_portal_return_url(),
        },
    )
    portal_url = _normalize_id(portal.get("url"))
    if not portal_url:
        raise HTTPException(status_code=502, detail="No billing portal URL is available for this customer.")

    if subscription_id:
        try:
            subscription = await _fetch_stripe_subscription(subscription_id)
            status = _apply_subscription_snapshot(
                user,
                subscription_id=subscription_id,
                attributes=subscription,
                event_name="subscription_fetched",
            )
            _sync_paid_tier_from_status(user, status)
        except HTTPException:
            # Keep portal access even if subscription sync fails.
            pass

    await db.commit()
    return {"portal_url": portal_url}


@router.post("/webhook")
async def handle_stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    signing_secret = _env("STRIPE_WEBHOOK_SIGNING_SECRET")
    if not signing_secret:
        raise HTTPException(status_code=503, detail="Stripe webhook signing secret is not configured.")

    raw_body = await request.body()
    signature_header = (request.headers.get("Stripe-Signature") or "").strip()
    if not _verify_stripe_signature(raw_body, signature_header, signing_secret):
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail="Invalid webhook payload.")

    event_type = _normalize_event_name(payload.get("type"))
    data = payload.get("data")
    data = data if isinstance(data, dict) else {}
    data_object = data.get("object")
    data_object = data_object if isinstance(data_object, dict) else {}

    if not event_type or not data_object:
        return {"ok": True}

    relevant_events = {
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.paused",
        "customer.subscription.resumed",
        "invoice.payment_succeeded",
        "invoice.payment_failed",
        "invoice.payment_action_required",
    }
    if event_type not in relevant_events:
        return {"ok": True}

    object_type = _normalize_event_name(data_object.get("object"))
    subscription_id = _normalize_id(data_object.get("subscription"))
    subscription_object: dict | None = None

    if object_type == "subscription":
        subscription_object = data_object
        subscription_id = _normalize_id(data_object.get("id"))
    else:
        if object_type == "checkout.session" and _normalize_event_name(data_object.get("mode")) != "subscription":
            return {"ok": True}
        if subscription_id:
            try:
                subscription_object = await _fetch_stripe_subscription(subscription_id)
            except HTTPException:
                subscription_object = None

    user = await _resolve_user_for_event(
        db,
        data_object=data_object,
        subscription_object=subscription_object,
        subscription_id=subscription_id,
    )
    if not user:
        return {"ok": True, "matched_user": False}

    previous_tier = get_user_subscription_tier(user)

    status: str | None = None
    if subscription_object:
        status = _apply_subscription_snapshot(
            user,
            subscription_id=subscription_id,
            attributes=subscription_object,
            event_name=event_type,
        )
    else:
        customer_id = _normalize_id(data_object.get("customer"))
        if customer_id:
            user.stripe_customer_id = customer_id
        user.stripe_last_event_name = event_type
        user.stripe_last_event_at = datetime.now(timezone.utc)

    _, next_tier = _sync_paid_tier_from_status(user, status)

    if next_tier != previous_tier:
        add_audit_log(
            db,
            action="billing.subscription_tier_synced",
            message=(
                f"Billing webhook changed subscription tier for {user.email} "
                f"from {previous_tier} to {next_tier}."
            ),
            target_user=user,
        )

    await db.commit()
    return {
        "ok": True,
        "matched_user": True,
        "subscription_tier": next_tier,
        "subscription_status": user.stripe_subscription_status,
    }
