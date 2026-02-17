import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ARRAY, Integer, ForeignKey, Boolean, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    subscription_tier: Mapped[str] = mapped_column(String(24), default="non_premium", nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lemon_customer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lemon_subscription_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lemon_subscription_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    lemon_variant_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    lemon_last_event_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    lemon_last_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lemon_subscription_renews_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lemon_subscription_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    stripe_subscription_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    stripe_price_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    stripe_last_event_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    stripe_last_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stripe_subscription_current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stripe_subscription_cancel_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    preferences: Mapped["UserPreferences"] = relationship(back_populates="user", uselist=False, cascade="all, delete-orphan")
    password_reset_tokens: Mapped[list["PasswordResetToken"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    email_change_tokens: Mapped[list["EmailChangeToken"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    email_verification_tokens: Mapped[list["EmailVerificationToken"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    watchlist_items: Mapped[list["WatchlistItem"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    watched_items: Mapped[list["WatchedItem"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    lists: Mapped[list["UserList"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    notification_subscriptions: Mapped[list["NotificationSubscription"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    notifications: Mapped[list["UserNotification"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class UserPreferences(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    provider_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=list)
    countries: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    theme: Mapped[str] = mapped_column(String, default="dark")
    notification_deliver_in_app: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notification_deliver_email: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    letterboxd_username: Mapped[str | None] = mapped_column(String(80), nullable=True)
    letterboxd_watchlist_sync_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    letterboxd_watchlist_sync_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    letterboxd_watchlist_last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="preferences")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    request_ip: Mapped[str | None] = mapped_column(String, nullable=True)

    user: Mapped["User"] = relationship(back_populates="password_reset_tokens")


class EmailChangeToken(Base):
    __tablename__ = "email_change_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    new_email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    request_ip: Mapped[str | None] = mapped_column(String, nullable=True)

    user: Mapped["User"] = relationship(back_populates="email_change_tokens")


class EmailVerificationToken(Base):
    __tablename__ = "email_verification_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    request_ip: Mapped[str | None] = mapped_column(String, nullable=True)

    user: Mapped["User"] = relationship(back_populates="email_verification_tokens")


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    __table_args__ = (
        UniqueConstraint("user_id", "media_type", "tmdb_id", name="uq_watchlist_user_media_tmdb"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    media_type: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    tmdb_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    poster_path: Mapped[str | None] = mapped_column(String, nullable=True)
    release_date: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    user: Mapped["User"] = relationship(back_populates="watchlist_items")


class WatchedItem(Base):
    __tablename__ = "watched_items"
    __table_args__ = (
        UniqueConstraint("user_id", "media_type", "tmdb_id", name="uq_watched_user_media_tmdb"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    media_type: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    tmdb_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    poster_path: Mapped[str | None] = mapped_column(String, nullable=True)
    release_date: Mapped[str | None] = mapped_column(String, nullable=True)
    watched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    user: Mapped["User"] = relationship(back_populates="watched_items")


class UserList(Base):
    __tablename__ = "user_lists"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_user_lists_user_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    user: Mapped["User"] = relationship(back_populates="lists")
    items: Mapped[list["UserListItem"]] = relationship(
        back_populates="list",
        cascade="all, delete-orphan",
    )


class UserListItem(Base):
    __tablename__ = "user_list_items"
    __table_args__ = (
        UniqueConstraint("list_id", "media_type", "tmdb_id", name="uq_user_list_items_list_media_tmdb"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    list_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("user_lists.id", ondelete="CASCADE"), nullable=False, index=True)
    media_type: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    tmdb_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    poster_path: Mapped[str | None] = mapped_column(String, nullable=True)
    release_date: Mapped[str | None] = mapped_column(String, nullable=True)
    sort_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    list: Mapped["UserList"] = relationship(back_populates="items")


class NotificationSubscription(Base):
    __tablename__ = "notification_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    media_type: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    tmdb_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    poster_path: Mapped[str | None] = mapped_column(String, nullable=True)
    condition_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    deliver_in_app: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    deliver_email: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="notification_subscriptions")
    notifications: Mapped[list["UserNotification"]] = relationship(back_populates="subscription")


class UserNotification(Base):
    __tablename__ = "user_notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("notification_subscriptions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    media_type: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    tmdb_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    poster_path: Mapped[str | None] = mapped_column(String, nullable=True)
    condition_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="notifications")
    subscription: Mapped["NotificationSubscription"] = relationship(back_populates="notifications")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    action: Mapped[str] = mapped_column(String, nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    actor_email: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    target_email: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
