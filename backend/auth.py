import os
import uuid
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from jose import jwt, JWTError
from fastapi import Request, HTTPException, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .models import User

ph = PasswordHasher()

JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TTL = timedelta(hours=1)
REFRESH_TOKEN_TTL = timedelta(days=7)

COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() == "true"
COOKIE_DOMAIN = os.environ.get("COOKIE_DOMAIN", None)


def hash_password(password: str) -> str:
    return ph.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    if not isinstance(hashed, str) or not hashed:
        return False
    try:
        return ph.verify(hashed, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def create_token(user_id: uuid.UUID, ttl: timedelta) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + ttl,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_access_token(user_id: uuid.UUID) -> str:
    return create_token(user_id, ACCESS_TOKEN_TTL)


def create_refresh_token(user_id: uuid.UUID) -> str:
    return create_token(user_id, REFRESH_TOKEN_TTL)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def set_auth_cookies(response: Response, user_id: uuid.UUID) -> str:
    access = create_access_token(user_id)
    refresh = create_refresh_token(user_id)
    csrf_token = secrets.token_hex(32)

    cookie_kwargs = dict(
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    if COOKIE_DOMAIN:
        cookie_kwargs["domain"] = COOKIE_DOMAIN

    response.set_cookie("access_token", access, max_age=int(ACCESS_TOKEN_TTL.total_seconds()), **cookie_kwargs)
    response.set_cookie("refresh_token", refresh, max_age=int(REFRESH_TOKEN_TTL.total_seconds()), **cookie_kwargs)
    # CSRF token: readable by JS (not httpOnly)
    response.set_cookie(
        "csrf_token", csrf_token,
        max_age=int(REFRESH_TOKEN_TTL.total_seconds()),
        httponly=False,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    return csrf_token


def clear_auth_cookies(response: Response):
    for name in ("access_token", "refresh_token", "csrf_token"):
        response.delete_cookie(name, path="/")


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    return user


async def get_optional_user(request: Request, db: AsyncSession = Depends(get_db)) -> User | None:
    token = request.cookies.get("access_token")
    if not token:
        return None
    try:
        payload = decode_token(token)
    except HTTPException:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        return None
    return user


async def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def verify_csrf(request: Request):
    """Verify CSRF token on state-changing requests."""
    csrf_cookie = request.cookies.get("csrf_token")
    csrf_header = request.headers.get("x-csrf-token")
    if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
        raise HTTPException(status_code=403, detail="CSRF token mismatch")
