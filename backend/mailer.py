import asyncio
import logging
import os
import smtplib
from email.message import EmailMessage

logger = logging.getLogger(__name__)

SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "").strip()
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "").strip()
SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL", SMTP_USERNAME or "").strip()
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "FullStreamer").strip() or "FullStreamer"
SMTP_SECURITY = os.environ.get("SMTP_SECURITY", "starttls").strip().lower()
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173").strip().rstrip("/")


def _enabled() -> bool:
    return bool(SMTP_HOST and SMTP_PORT and SMTP_USERNAME and SMTP_PASSWORD and SMTP_FROM_EMAIL)


def _from_header() -> str:
    return f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>"


def build_password_reset_link(token: str) -> str:
    return f"{FRONTEND_BASE_URL}/reset-password?token={token}"


def _send_sync(to_email: str, subject: str, text_body: str, html_body: str | None = None) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = _from_header()
    msg["To"] = to_email
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    if SMTP_SECURITY == "ssl":
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(msg)
        return

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
        server.ehlo()
        if SMTP_SECURITY != "none":
            server.starttls()
            server.ehlo()
        server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.send_message(msg)


async def send_email(to_email: str, subject: str, text_body: str, html_body: str | None = None) -> bool:
    if not _enabled():
        logger.warning("Email skipped: SMTP is not configured (target=%s, subject=%s)", to_email, subject)
        return False
    try:
        await asyncio.to_thread(_send_sync, to_email, subject, text_body, html_body)
        return True
    except Exception:
        logger.exception("Failed to send email (target=%s, subject=%s)", to_email, subject)
        return False


async def send_welcome_email(to_email: str) -> bool:
    subject = "Welcome to FullStreamer"
    text_body = (
        "Welcome to FullStreamer.\n\n"
        "Your account is ready, and you can start exploring what to watch right away.\n\n"
        f"Open FullStreamer: {FRONTEND_BASE_URL}\n\n"
        "If you did not create this account, please contact support."
    )
    html_body = (
        "<p>Welcome to <strong>FullStreamer</strong>.</p>"
        "<p>Your account is ready, and you can start exploring what to watch right away.</p>"
        f"<p><a href=\"{FRONTEND_BASE_URL}\">Open FullStreamer</a></p>"
        "<p>If you did not create this account, please contact support.</p>"
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_password_reset_email(to_email: str, reset_token: str, expires_minutes: int) -> bool:
    link = build_password_reset_link(reset_token)
    subject = "Reset your FullStreamer password"
    text_body = (
        "We received a request to reset your FullStreamer password.\n\n"
        f"Reset your password: {link}\n\n"
        f"This link expires in {expires_minutes} minutes.\n\n"
        "If you did not request this, you can ignore this email."
    )
    html_body = (
        "<p>We received a request to reset your FullStreamer password.</p>"
        f"<p><a href=\"{link}\">Reset your password</a></p>"
        f"<p>This link expires in {expires_minutes} minutes.</p>"
        "<p>If you did not request this, you can ignore this email.</p>"
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_account_deactivated_email(to_email: str) -> bool:
    subject = "Your FullStreamer account has been deactivated"
    text_body = (
        "Your FullStreamer account has been deactivated.\n\n"
        "If this was unexpected, please contact support."
    )
    html_body = (
        "<p>Your FullStreamer account has been deactivated.</p>"
        "<p>If this was unexpected, please contact support.</p>"
    )
    return await send_email(to_email, subject, text_body, html_body)
