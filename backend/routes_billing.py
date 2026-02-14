import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import ipaddress
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .audit import add_audit_log
from .auth import (
    SUBSCRIPTION_TIER_NON_PREMIUM,
    SUBSCRIPTION_TIER_PREMIUM,
    get_current_user,
    get_user_subscription_tier,
)
from .database import get_db
from .models import User

router = APIRouter(prefix="/api/billing", tags=["billing"])

LEMON_API_BASE_URL = os.environ.get("LEMON_SQUEEZY_API_BASE_URL", "https://api.lemonsqueezy.com/v1").rstrip("/")
BILLING_PLAN_MONTHLY = "monthly"
BILLING_PLAN_YEARLY = "yearly"
BillingPlan = Literal["monthly", "yearly"]


class CreateCheckoutRequest(BaseModel):
    plan: BillingPlan = BILLING_PLAN_MONTHLY


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "")
    if raw is None or raw == "":
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _normalize_country_code(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    code = value.strip().upper()
    if len(code) != 2 or not code.isalpha():
        return None
    if code in {"XX", "T1", "A1", "A2"}:
        return None
    return code


def _resolve_client_ip(request: Request) -> str | None:
    raw_candidates = [
        request.headers.get("CF-Connecting-IP"),
        (request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or None),
        request.headers.get("X-Real-IP"),
        request.client.host if request.client else None,
    ]
    for raw in raw_candidates:
        if not raw:
            continue
        candidate = str(raw).strip()
        if not candidate:
            continue
        if candidate.startswith("[") and "]" in candidate:
            candidate = candidate[1:candidate.find("]")]
        try:
            ipaddress.ip_address(candidate)
            return candidate
        except ValueError:
            if candidate.count(":") == 1:
                host, _, port = candidate.partition(":")
                if port.isdigit():
                    try:
                        ipaddress.ip_address(host)
                        return host
                    except ValueError:
                        continue
    return None


def _is_public_ip(candidate_ip: str | None) -> bool:
    if not candidate_ip:
        return False
    try:
        parsed = ipaddress.ip_address(candidate_ip)
    except ValueError:
        return False
    return not (
        parsed.is_private
        or parsed.is_loopback
        or parsed.is_link_local
        or parsed.is_multicast
        or parsed.is_reserved
        or parsed.is_unspecified
    )


async def _resolve_checkout_country(request: Request) -> str:
    direct_country = _normalize_country_code(request.headers.get("CF-IPCountry"))
    if direct_country:
        return direct_country

    for header_name in ("X-Country-Code", "X-App-Country"):
        from_header = _normalize_country_code(request.headers.get(header_name))
        if from_header:
            return from_header

    client_ip = _resolve_client_ip(request)
    if _is_public_ip(client_ip):
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get(f"http://ip-api.com/json/{client_ip}?fields=countryCode")
            if response.status_code == 200:
                payload = response.json()
                detected = _normalize_country_code(payload.get("countryCode"))
                if detected:
                    return detected
        except Exception:
            pass

    return _normalize_country_code(_env("LEMON_DEFAULT_BILLING_COUNTRY")) or "US"


def _parse_price_minor_units(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, float):
        raw = f"{value:.12g}"
    elif isinstance(value, str):
        raw = value.strip()
    elif isinstance(value, dict):
        if "amount" in value:
            return _parse_price_minor_units(value.get("amount"))
        if "price" in value:
            return _parse_price_minor_units(value.get("price"))
        return None
    else:
        return None

    if not raw:
        return None
    normalized = raw.replace(",", ".").strip()
    if normalized.isdigit():
        parsed_int = int(normalized)
        return parsed_int if parsed_int > 0 else None

    try:
        decimal_value = Decimal(normalized)
    except InvalidOperation:
        return None
    if decimal_value <= 0:
        return None
    parsed_minor = int((decimal_value * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return parsed_minor if parsed_minor > 0 else None


def _plan_prices_env_name(plan: BillingPlan) -> str:
    return (
        "LEMON_COUNTRY_PRICES_YEARLY_JSON"
        if plan == BILLING_PLAN_YEARLY
        else "LEMON_COUNTRY_PRICES_MONTHLY_JSON"
    )


def _plan_default_price_env_name(plan: BillingPlan) -> str:
    return "LEMON_DEFAULT_YEARLY_PRICE" if plan == BILLING_PLAN_YEARLY else "LEMON_DEFAULT_MONTHLY_PRICE"


def _load_plan_price_config(plan: BillingPlan) -> tuple[dict[str, int], int | None]:
    default_price = _parse_price_minor_units(_env(_plan_default_price_env_name(plan)))
    # Sensible fallback defaults for current pricing: DKK 19.99 / DKK 199.99.
    if default_price is None:
        default_price = 19999 if plan == BILLING_PLAN_YEARLY else 1999

    raw_map = _env(_plan_prices_env_name(plan))
    if not raw_map:
        return {}, default_price

    try:
        parsed = json.loads(raw_map)
    except json.JSONDecodeError:
        return {}, default_price
    if not isinstance(parsed, dict):
        return {}, default_price

    prices: dict[str, int] = {}
    for raw_country, raw_price in parsed.items():
        key = str(raw_country).strip()
        if key in {"DEFAULT", "default", "*"}:
            mapped_default = _parse_price_minor_units(raw_price)
            if mapped_default is not None:
                default_price = mapped_default
            continue
        country_code = _normalize_country_code(key)
        if not country_code:
            continue
        parsed_price = _parse_price_minor_units(raw_price)
        if parsed_price is None:
            continue
        prices[country_code] = parsed_price
    return prices, default_price


def _resolve_custom_price(plan: BillingPlan, country: str) -> int | None:
    plan_prices, default_price = _load_plan_price_config(plan)
    return plan_prices.get(country, default_price)


def _coerce_id(value: str) -> int | str:
    try:
        return int(value)
    except ValueError:
        return value


def _plan_variant_id(plan: BillingPlan) -> str:
    if plan == BILLING_PLAN_YEARLY:
        return _env("LEMON_SQUEEZY_YEARLY_VARIANT_ID")
    return _env("LEMON_SQUEEZY_MONTHLY_VARIANT_ID") or _env("LEMON_SQUEEZY_PREMIUM_VARIANT_ID")


def _checkout_ready_for_plan(plan: BillingPlan) -> bool:
    return bool(_env("LEMON_SQUEEZY_API_KEY") and _env("LEMON_SQUEEZY_STORE_ID") and _plan_variant_id(plan))


def _checkout_ready() -> bool:
    return bool(
        _env("LEMON_SQUEEZY_API_KEY")
        and _env("LEMON_SQUEEZY_STORE_ID")
        and (_plan_variant_id(BILLING_PLAN_MONTHLY) or _plan_variant_id(BILLING_PLAN_YEARLY))
    )


def _webhook_ready() -> bool:
    return bool(_env("LEMON_SQUEEZY_WEBHOOK_SIGNING_SECRET"))


def _build_checkout_redirect_url(plan: BillingPlan) -> str | None:
    base_url = _env("LEMON_SQUEEZY_CHECKOUT_REDIRECT_URL")
    if not base_url:
        return None
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


def _lemon_headers() -> dict[str, str]:
    api_key = _env("LEMON_SQUEEZY_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Lemon Squeezy API key is not configured.")
    return {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
    }


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


def _status_grants_paid_access(status: str | None) -> bool:
    if not status:
        return False
    # Lemon Squeezy docs: keep access in all statuses except "expired".
    return status != "expired"


def _parse_iso_datetime(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _apply_subscription_snapshot(user: User, *, subscription_id: str | None, attributes: dict, event_name: str | None) -> str | None:
    if subscription_id:
        user.lemon_subscription_id = subscription_id
    customer_id = _normalize_id(attributes.get("customer_id"))
    if customer_id:
        user.lemon_customer_id = customer_id
    variant_id = _normalize_id(attributes.get("variant_id"))
    if variant_id:
        user.lemon_variant_id = variant_id

    status = _normalize_status(attributes.get("status"))
    if not status and event_name == "subscription_expired":
        status = "expired"
    if status:
        user.lemon_subscription_status = status

    user.lemon_last_event_name = event_name
    user.lemon_last_event_at = datetime.now(timezone.utc)

    renews_at = _parse_iso_datetime(attributes.get("renews_at"))
    if renews_at is not None:
        user.lemon_subscription_renews_at = renews_at
    ends_at = _parse_iso_datetime(attributes.get("ends_at"))
    if ends_at is not None:
        user.lemon_subscription_ends_at = ends_at
    return status


async def _resolve_user_for_webhook(
    db: AsyncSession,
    *,
    event_payload: dict,
    subscription_id: str | None,
    attributes: dict,
) -> User | None:
    meta = event_payload.get("meta")
    meta = meta if isinstance(meta, dict) else {}
    custom_data = meta.get("custom_data")
    custom_data = custom_data if isinstance(custom_data, dict) else {}

    user_id_raw = custom_data.get("user_id")
    if user_id_raw:
        try:
            user_id = uuid.UUID(str(user_id_raw))
        except (TypeError, ValueError):
            user_id = None
        if user_id is not None:
            user = await db.get(User, user_id)
            if user:
                return user

    if subscription_id:
        existing = await db.scalar(select(User).where(User.lemon_subscription_id == subscription_id))
        if existing:
            return existing

    user_email = attributes.get("user_email")
    if isinstance(user_email, str):
        normalized_email = user_email.strip().lower()
        if normalized_email:
            return await db.scalar(select(User).where(User.email == normalized_email))
    return None


@router.get("/status")
async def get_billing_status(user: User = Depends(get_current_user)):
    tier = get_user_subscription_tier(user)
    monthly_checkout_configured = _checkout_ready_for_plan(BILLING_PLAN_MONTHLY)
    yearly_checkout_configured = _checkout_ready_for_plan(BILLING_PLAN_YEARLY)
    has_paid_subscription = bool(tier == SUBSCRIPTION_TIER_PREMIUM and (user.lemon_subscription_id or "").strip())
    return {
        "configured_checkout": _checkout_ready(),
        "configured_monthly_checkout": monthly_checkout_configured,
        "configured_yearly_checkout": yearly_checkout_configured,
        "configured_webhook": _webhook_ready(),
        "checkout_enabled": _checkout_ready() and tier == SUBSCRIPTION_TIER_NON_PREMIUM,
        "monthly_checkout_enabled": monthly_checkout_configured and tier == SUBSCRIPTION_TIER_NON_PREMIUM,
        "yearly_checkout_enabled": yearly_checkout_configured and tier == SUBSCRIPTION_TIER_NON_PREMIUM,
        "portal_enabled": bool(_env("LEMON_SQUEEZY_API_KEY") and (user.lemon_subscription_id or "").strip()),
        "has_paid_subscription": has_paid_subscription,
        "subscription_status": user.lemon_subscription_status,
    }


@router.post("/checkout")
async def create_checkout_link(
    request: Request,
    checkout_request: CreateCheckoutRequest | None = None,
    user: User = Depends(get_current_user),
):
    selected_plan: BillingPlan = checkout_request.plan if checkout_request else BILLING_PLAN_MONTHLY

    if not _checkout_ready():
        raise HTTPException(
            status_code=503,
            detail=(
                "Billing is not configured. Set LEMON_SQUEEZY_API_KEY, LEMON_SQUEEZY_STORE_ID, "
                "and at least one of LEMON_SQUEEZY_MONTHLY_VARIANT_ID / "
                "LEMON_SQUEEZY_YEARLY_VARIANT_ID (or legacy LEMON_SQUEEZY_PREMIUM_VARIANT_ID)."
            ),
        )
    current_tier = get_user_subscription_tier(user)
    if current_tier != SUBSCRIPTION_TIER_NON_PREMIUM:
        if current_tier == SUBSCRIPTION_TIER_PREMIUM:
            raise HTTPException(status_code=400, detail="This account already has paid premium.")
        raise HTTPException(status_code=400, detail="Only non-premium accounts can start paid checkout.")

    store_id = _env("LEMON_SQUEEZY_STORE_ID")
    variant_id = _plan_variant_id(selected_plan)
    if not variant_id:
        raise HTTPException(
            status_code=503,
            detail=(
                "Billing plan is not configured. "
                "Set LEMON_SQUEEZY_MONTHLY_VARIANT_ID for monthly or "
                "LEMON_SQUEEZY_YEARLY_VARIANT_ID for yearly checkouts."
            ),
        )

    checkout_country = await _resolve_checkout_country(request)
    checkout_custom_price = _resolve_custom_price(selected_plan, checkout_country)
    redirect_url = _build_checkout_redirect_url(selected_plan)
    product_options: dict[str, object] = {
        "enabled_variants": [_coerce_id(variant_id)],
    }
    if redirect_url:
        product_options["redirect_url"] = redirect_url

    attributes: dict[str, object] = {
        "checkout_options": {
            "embed": False,
            "media": False,
            "logo": True,
        },
        "product_options": product_options,
        "checkout_data": {
            "email": user.email,
            "billing_address": {
                "country": checkout_country,
            },
            "custom": {
                "user_id": str(user.id),
                "plan": selected_plan,
                "country": checkout_country,
            },
        },
    }
    if checkout_custom_price is not None:
        attributes["custom_price"] = checkout_custom_price
    if _env_bool("LEMON_SQUEEZY_TEST_MODE", default=False):
        attributes["test_mode"] = True

    lemon_payload = {
        "data": {
            "type": "checkouts",
            "attributes": attributes,
            "relationships": {
                "store": {"data": {"type": "stores", "id": store_id}},
                "variant": {"data": {"type": "variants", "id": variant_id}},
            },
        }
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            f"{LEMON_API_BASE_URL}/checkouts",
            headers=_lemon_headers(),
            content=json.dumps(lemon_payload),
        )
    if response.status_code >= 400:
        detail = response.text
        try:
            parsed = response.json()
            detail = (
                parsed.get("errors", [{}])[0].get("detail")
                or parsed.get("message")
                or detail
            )
        except Exception:
            detail = response.text
        raise HTTPException(status_code=502, detail=f"Could not create checkout: {detail}")

    body = response.json()
    checkout_url = str((((body.get("data") or {}).get("attributes") or {}).get("url") or "")).strip()
    if not checkout_url:
        raise HTTPException(status_code=502, detail="Could not create checkout URL.")
    return {
        "checkout_url": checkout_url,
        "plan": selected_plan,
        "country": checkout_country,
        "custom_price": checkout_custom_price,
    }


@router.get("/portal")
async def get_customer_portal_url(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    subscription_id = (user.lemon_subscription_id or "").strip()
    if not subscription_id:
        raise HTTPException(status_code=404, detail="No paid subscription found for this account.")
    if not _env("LEMON_SQUEEZY_API_KEY"):
        raise HTTPException(status_code=503, detail="Billing API key is not configured.")

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{LEMON_API_BASE_URL}/subscriptions/{subscription_id}",
            headers=_lemon_headers(),
        )
    if response.status_code >= 400:
        detail = response.text
        try:
            parsed = response.json()
            detail = (
                parsed.get("errors", [{}])[0].get("detail")
                or parsed.get("message")
                or detail
            )
        except Exception:
            detail = response.text
        raise HTTPException(status_code=502, detail=f"Could not load customer portal URL: {detail}")

    payload = response.json()
    data = payload.get("data")
    data = data if isinstance(data, dict) else {}
    attributes = data.get("attributes")
    attributes = attributes if isinstance(attributes, dict) else {}
    urls = attributes.get("urls")
    urls = urls if isinstance(urls, dict) else {}
    portal_url = str(urls.get("customer_portal") or urls.get("update_payment_method") or "").strip()
    if not portal_url:
        raise HTTPException(status_code=404, detail="No customer portal URL is available for this subscription.")

    status = _apply_subscription_snapshot(
        user,
        subscription_id=subscription_id,
        attributes=attributes,
        event_name="subscription_fetched",
    )
    if status is not None:
        has_access = _status_grants_paid_access(status)
        current_tier = get_user_subscription_tier(user)
        if has_access and current_tier != SUBSCRIPTION_TIER_PREMIUM:
            user.subscription_tier = SUBSCRIPTION_TIER_PREMIUM
        elif not has_access and current_tier == SUBSCRIPTION_TIER_PREMIUM:
            user.subscription_tier = SUBSCRIPTION_TIER_NON_PREMIUM
    await db.commit()

    return {"portal_url": portal_url}


@router.post("/webhook")
async def handle_lemon_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    signing_secret = _env("LEMON_SQUEEZY_WEBHOOK_SIGNING_SECRET")
    if not signing_secret:
        raise HTTPException(status_code=503, detail="Webhook signing secret is not configured.")

    raw_body = await request.body()
    signature = (request.headers.get("X-Signature") or "").strip()
    expected = hmac.new(signing_secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not signature or not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail="Invalid webhook payload.")

    meta = payload.get("meta")
    meta = meta if isinstance(meta, dict) else {}
    event_name = _normalize_status(meta.get("event_name"))
    if not event_name or not event_name.startswith("subscription_"):
        return {"ok": True}

    data = payload.get("data")
    data = data if isinstance(data, dict) else {}
    attributes = data.get("attributes")
    attributes = attributes if isinstance(attributes, dict) else {}
    subscription_id = _normalize_id(data.get("id"))

    user = await _resolve_user_for_webhook(
        db,
        event_payload=payload,
        subscription_id=subscription_id,
        attributes=attributes,
    )
    if not user:
        return {"ok": True, "matched_user": False}

    previous_tier = get_user_subscription_tier(user)
    status = _apply_subscription_snapshot(
        user,
        subscription_id=subscription_id,
        attributes=attributes,
        event_name=event_name,
    )

    if status is not None:
        has_access = _status_grants_paid_access(status)
        current_tier = get_user_subscription_tier(user)
        if has_access and current_tier != SUBSCRIPTION_TIER_PREMIUM:
            user.subscription_tier = SUBSCRIPTION_TIER_PREMIUM
        elif not has_access and current_tier == SUBSCRIPTION_TIER_PREMIUM:
            user.subscription_tier = SUBSCRIPTION_TIER_NON_PREMIUM

    next_tier = get_user_subscription_tier(user)
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
    return {"ok": True, "matched_user": True, "subscription_tier": next_tier}
