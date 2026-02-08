import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from .models import AuditLog, User


def _normalize_email(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().lower()
    return normalized or None


def _normalize_reason(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def add_audit_log(
    db: AsyncSession,
    *,
    action: str,
    message: str,
    actor_user: User | None = None,
    actor_user_id: uuid.UUID | None = None,
    actor_email: str | None = None,
    target_user: User | None = None,
    target_user_id: uuid.UUID | None = None,
    target_email: str | None = None,
    reason: str | None = None,
) -> None:
    db.add(
        AuditLog(
            action=action,
            message=message,
            reason=_normalize_reason(reason),
            actor_user_id=actor_user.id if actor_user else actor_user_id,
            actor_email=_normalize_email(actor_user.email if actor_user else actor_email),
            target_user_id=target_user.id if target_user else target_user_id,
            target_email=_normalize_email(target_user.email if target_user else target_email),
        )
    )
