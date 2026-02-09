import os
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql+asyncpg://moviefinder:moviefinder@localhost:5432/moviefinder")

engine = create_async_engine(DATABASE_URL, pool_size=5, max_overflow=10)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session


async def init_db():
    from . import models  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)
        # Lightweight schema upgrades for environments without a migration runner.
        # Existing deployments keep working when new user-management columns are added.
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ NULL"))
        await conn.execute(
            text(
                "ALTER TABLE user_preferences "
                "ADD COLUMN IF NOT EXISTS notification_deliver_in_app BOOLEAN NOT NULL DEFAULT TRUE"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE user_preferences "
                "ADD COLUMN IF NOT EXISTS notification_deliver_email BOOLEAN NOT NULL DEFAULT FALSE"
            )
        )

        configured_admins = [
            email.strip().lower()
            for email in os.environ.get("ADMIN_EMAILS", "").split(",")
            if email.strip()
        ]
        for email in configured_admins:
            await conn.execute(
                text("UPDATE users SET is_admin = TRUE WHERE lower(email) = :email"),
                {"email": email},
            )

        admin_count = await conn.scalar(
            text("SELECT COUNT(*) FROM users WHERE is_admin = TRUE")
        )
        if (admin_count or 0) == 0:
            total_users = await conn.scalar(text("SELECT COUNT(*) FROM users"))
            # Safe bootstrap for single-user installs: keep admin access possible
            # without manual DB updates.
            if (total_users or 0) == 1:
                await conn.execute(
                    text(
                        "UPDATE users SET is_admin = TRUE "
                        "WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)"
                    )
                )


async def close_db():
    await engine.dispose()
