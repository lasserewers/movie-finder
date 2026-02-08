import asyncio
import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Response, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .models import User, UserPreferences, PasswordResetToken
from . import mailer
from .auth import (
    hash_password, verify_password, set_auth_cookies, clear_auth_cookies,
    get_current_user, decode_token, verify_csrf,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
PASSWORD_RESET_TTL_MINUTES = max(5, int(os.environ.get("PASSWORD_RESET_TTL_MINUTES", "30")))


def _client_ip(request: Request) -> str | None:
    value = (
        request.headers.get("CF-Connecting-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.headers.get("X-Real-IP")
        or (request.client.host if request.client else None)
    )
    return value or None


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/signup")
async def signup(body: SignupRequest, response: Response, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email.lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    admin_count = await db.scalar(
        select(func.count()).select_from(User).where(User.is_admin.is_(True))
    )
    is_first_admin = (admin_count or 0) == 0

    user = User(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        is_admin=is_first_admin,
        is_active=True,
        last_login_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.flush()

    prefs = UserPreferences(user_id=user.id)
    db.add(prefs)
    await db.commit()

    asyncio.create_task(mailer.send_welcome_email(user.email))

    set_auth_cookies(response, user.id)
    return {
        "ok": True,
        "id": str(user.id),
        "email": user.email,
        "is_admin": bool(user.is_admin),
        "is_active": bool(user.is_active),
    }


@router.post("/login")
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email.lower()))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    admin_count = await db.scalar(
        select(func.count()).select_from(User).where(User.is_admin.is_(True))
    )
    if (admin_count or 0) == 0:
        user.is_admin = True

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    set_auth_cookies(response, user.id)
    return {
        "ok": True,
        "id": str(user.id),
        "email": user.email,
        "is_admin": bool(user.is_admin),
        "is_active": bool(user.is_active),
    }


@router.post("/logout")
async def logout(response: Response):
    clear_auth_cookies(response)
    return {"ok": True}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {
        "email": user.email,
        "id": str(user.id),
        "is_admin": bool(user.is_admin),
        "is_active": bool(user.is_active),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


class ChangeEmailRequest(BaseModel):
    current_password: str
    new_email: EmailStr


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


@router.put("/email")
async def change_email(body: ChangeEmailRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=403, detail="Incorrect password")
    existing = await db.execute(select(User).where(User.email == body.new_email.lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user.email = body.new_email.lower()
    await db.commit()
    return {"ok": True, "email": user.email}


@router.put("/password")
async def change_password(body: ChangePasswordRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=403, detail="Incorrect password")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
    return {"ok": True}


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest, request: Request, db: AsyncSession = Depends(get_db)):
    email = body.email.lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        # Avoid email enumeration by returning a generic success response.
        return {"ok": True}

    now = datetime.now(timezone.utc)
    token_plain = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token_plain.encode("utf-8")).hexdigest()
    expires_at = now + timedelta(minutes=PASSWORD_RESET_TTL_MINUTES)

    await db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .values(used_at=now)
    )
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=expires_at,
            request_ip=_client_ip(request),
        )
    )
    await db.commit()

    asyncio.create_task(
        mailer.send_password_reset_email(
            user.email,
            token_plain,
            PASSWORD_RESET_TTL_MINUTES,
        )
    )
    return {"ok": True}


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=16, max_length=512)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hashlib.sha256(body.token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    row = (
        await db.execute(
            select(PasswordResetToken, User)
            .join(User, User.id == PasswordResetToken.user_id)
            .where(
                PasswordResetToken.token_hash == token_hash,
                PasswordResetToken.used_at.is_(None),
                PasswordResetToken.expires_at > now,
            )
        )
    ).first()

    if not row:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    reset_token, user = row
    user.password_hash = hash_password(body.new_password)
    reset_token.used_at = now

    await db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.id != reset_token.id,
        )
        .values(used_at=now)
    )
    await db.commit()
    return {"ok": True}


@router.post("/refresh")
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    payload = decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        clear_auth_cookies(response)
        raise HTTPException(status_code=403, detail="Account is disabled")
    set_auth_cookies(response, user.id)
    return {"ok": True}


class DeleteAccountRequest(BaseModel):
    password: str


@router.post("/delete-account")
async def delete_account(body: DeleteAccountRequest, response: Response, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=403, detail="Incorrect password")

    # Delete user preferences first (foreign key constraint)
    prefs_result = await db.execute(select(UserPreferences).where(UserPreferences.user_id == user.id))
    prefs = prefs_result.scalar_one_or_none()
    if prefs:
        await db.delete(prefs)

    # Delete user
    await db.delete(user)
    await db.commit()

    clear_auth_cookies(response)
    return {"ok": True}
