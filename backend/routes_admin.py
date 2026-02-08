import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_admin, verify_password
from .database import get_db
from .models import User, UserPreferences
from . import mailer

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _serialize_user(user: User, prefs: UserPreferences | None) -> dict:
    provider_ids = list(prefs.provider_ids) if prefs and prefs.provider_ids else []
    countries = list(prefs.countries) if prefs and prefs.countries else []
    return {
        "id": str(user.id),
        "email": user.email,
        "is_admin": bool(user.is_admin),
        "is_active": bool(user.is_active),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "provider_count": len(provider_ids),
        "countries": countries,
        "theme": (prefs.theme if prefs and prefs.theme else "dark"),
    }


class AdminUserUpdateRequest(BaseModel):
    is_admin: bool | None = None
    is_active: bool | None = None
    action_reason: str | None = Field(default=None, max_length=500)


class AdminUserDeleteRequest(BaseModel):
    admin_password: str = Field(min_length=1, max_length=128)
    action_reason: str = Field(min_length=3, max_length=500)


@router.get("/me")
async def admin_me(admin: User = Depends(get_current_admin)):
    return {
        "id": str(admin.id),
        "email": admin.email,
        "is_admin": bool(admin.is_admin),
        "is_active": bool(admin.is_active),
    }


@router.get("/overview")
async def admin_overview(
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    day_ago = now - timedelta(hours=24)

    total_users = await db.scalar(select(func.count()).select_from(User)) or 0
    active_users = (
        await db.scalar(select(func.count()).select_from(User).where(User.is_active.is_(True)))
        or 0
    )
    admin_users = (
        await db.scalar(select(func.count()).select_from(User).where(User.is_admin.is_(True)))
        or 0
    )
    new_users_last_7_days = (
        await db.scalar(
            select(func.count()).select_from(User).where(User.created_at >= week_ago)
        )
        or 0
    )
    logins_last_24h = (
        await db.scalar(
            select(func.count()).select_from(User).where(User.last_login_at >= day_ago)
        )
        or 0
    )
    return {
        "total_users": int(total_users),
        "active_users": int(active_users),
        "admin_users": int(admin_users),
        "new_users_last_7_days": int(new_users_last_7_days),
        "logins_last_24h": int(logins_last_24h),
    }


@router.get("/users")
async def admin_users(
    q: str | None = Query(None, max_length=120),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    normalized_query = (q or "").strip().lower()
    filter_expr = None
    if normalized_query:
        filter_expr = User.email.ilike(f"%{normalized_query}%")

    total_stmt = select(func.count()).select_from(User)
    if filter_expr is not None:
        total_stmt = total_stmt.where(filter_expr)
    total = int((await db.scalar(total_stmt)) or 0)

    stmt = (
        select(User, UserPreferences)
        .outerjoin(UserPreferences, UserPreferences.user_id == User.id)
        .order_by(User.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    if filter_expr is not None:
        stmt = stmt.where(filter_expr)

    rows = (await db.execute(stmt)).all()
    results = [_serialize_user(user, prefs) for user, prefs in rows]
    has_more = page * page_size < total
    return {
        "results": results,
        "page": page,
        "page_size": page_size,
        "total": total,
        "has_more": has_more,
    }


@router.patch("/users/{user_id}")
async def admin_update_user(
    user_id: uuid.UUID,
    body: AdminUserUpdateRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if body.is_admin is None and body.is_active is None:
        raise HTTPException(status_code=400, detail="No changes provided")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    send_deactivated_email = False
    deactivation_reason: str | None = None
    send_reactivated_email = False
    normalized_reason = (body.action_reason or "").strip()
    if body.is_active is not None:
        if body.is_active is False and user.id == admin.id:
            raise HTTPException(status_code=400, detail="You cannot disable your own account")
        if user.is_active and body.is_active is False:
            if len(normalized_reason) < 3:
                raise HTTPException(status_code=400, detail="Reason is required when disabling an account")
            send_deactivated_email = True
            deactivation_reason = normalized_reason
        if (not user.is_active) and body.is_active is True:
            send_reactivated_email = True
        user.is_active = body.is_active

    if body.is_admin is not None:
        if body.is_admin is False:
            other_admins = await db.scalar(
                select(func.count())
                .select_from(User)
                .where(User.is_admin.is_(True), User.id != user.id)
            )
            if (other_admins or 0) == 0:
                raise HTTPException(status_code=400, detail="System must keep at least one admin")
        user.is_admin = body.is_admin

    await db.commit()

    if send_deactivated_email:
        asyncio.create_task(mailer.send_account_deactivated_email(user.email, deactivation_reason))
    if send_reactivated_email:
        asyncio.create_task(mailer.send_account_reactivated_email(user.email))

    prefs = await db.get(UserPreferences, user.id)
    return {"ok": True, "user": _serialize_user(user, prefs)}


@router.delete("/users/{user_id}")
async def admin_delete_user(
    user_id: uuid.UUID,
    body: AdminUserDeleteRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    normalized_reason = body.action_reason.strip()
    if len(normalized_reason) < 3:
        raise HTTPException(status_code=400, detail="Reason is required when deleting an account")
    if not verify_password(body.admin_password, admin.password_hash):
        raise HTTPException(status_code=403, detail="Incorrect admin password")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account from admin center")

    if user.is_admin:
        other_admins = await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.is_admin.is_(True), User.id != user.id)
        )
        if (other_admins or 0) == 0:
            raise HTTPException(status_code=400, detail="System must keep at least one admin")

    user_email = user.email
    await db.delete(user)
    await db.commit()
    asyncio.create_task(mailer.send_account_deleted_email(user_email, normalized_reason))
    return {"ok": True}


@router.post("/users/{user_id}/delete")
async def admin_delete_user_post(
    user_id: uuid.UUID,
    body: AdminUserDeleteRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    return await admin_delete_user(user_id, body, admin, db)
