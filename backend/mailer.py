import asyncio
import html
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
SUPPORT_EMAIL = os.environ.get("SUPPORT_EMAIL", "contact@fullstreamer.com").strip() or "contact@fullstreamer.com"


def _enabled() -> bool:
    return bool(SMTP_HOST and SMTP_PORT and SMTP_USERNAME and SMTP_PASSWORD and SMTP_FROM_EMAIL)


def _from_header() -> str:
    return f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>"


def build_password_reset_link(token: str) -> str:
    return f"{FRONTEND_BASE_URL}/reset-password?token={token}"


def build_email_change_link(token: str) -> str:
    return f"{FRONTEND_BASE_URL}/confirm-email?token={token}"


def build_signup_verification_link(token: str) -> str:
    return f"{FRONTEND_BASE_URL}/confirm-signup-email?token={token}"


def _render_email_html(
    *,
    preheader: str,
    title: str,
    subtitle: str,
    body_html: str,
    cta_label: str | None = None,
    cta_url: str | None = None,
) -> str:
    logo_url = f"{FRONTEND_BASE_URL}/logo-text-white.png"
    cta_html = ""
    if cta_label and cta_url:
        cta_html = (
            f"<div style=\"margin-top:26px;text-align:center;\">"
            f"<a href=\"{cta_url}\" style=\"display:inline-block;background:#e50914;color:#ffffff;"
            f"text-decoration:none;font-weight:700;border-radius:999px;padding:12px 22px;"
            f"font-family:Inter,Segoe UI,Arial,sans-serif;\">{cta_label}</a></div>"
        )
    return f"""
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{title}</title>
  </head>
  <body style="margin:0;padding:0;background:#0b0c10;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0c10;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;border-collapse:separate;">
            <tr>
              <td style="border-radius:22px;background:linear-gradient(135deg,#12141a 0%,#1a0f12 55%,#24070c 100%);border:1px solid #2a2f3b;padding:0;">
                <div style="padding:24px 24px 14px 24px;border-bottom:1px solid rgba(255,255,255,0.08);">
                  <img src="{logo_url}" alt="FullStreamer" width="170" style="display:block;max-width:100%;height:auto;" />
                </div>
                <div style="padding:26px 24px 24px 24px;">
                  <h1 style="margin:0 0 10px 0;color:#f1f4f9;font-size:26px;line-height:1.2;font-family:Inter,Segoe UI,Arial,sans-serif;">{title}</h1>
                  <p style="margin:0 0 18px 0;color:#cfd6e0;font-size:15px;line-height:1.6;font-family:Inter,Segoe UI,Arial,sans-serif;">{subtitle}</p>
                  <div style="color:#f1f4f9;font-size:15px;line-height:1.7;font-family:Inter,Segoe UI,Arial,sans-serif;">{body_html}</div>
                  {cta_html}
                </div>
                <div style="padding:14px 24px 24px 24px;color:#9aa4b2;font-size:12px;line-height:1.6;border-top:1px solid rgba(255,255,255,0.08);font-family:Inter,Segoe UI,Arial,sans-serif;">
                  Need help? Contact us at <a href="mailto:{SUPPORT_EMAIL}" style="color:#ff7b7b;text-decoration:none;">{SUPPORT_EMAIL}</a><br/>
                  FullStreamer
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
""".strip()


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
        f"If you did not create this account, contact {SUPPORT_EMAIL}."
    )
    html_body = _render_email_html(
        preheader="Welcome to FullStreamer",
        title="Welcome to FullStreamer",
        subtitle="Your account is ready. Start exploring movies and shows instantly.",
        body_html=(
            "<p style=\"margin:0 0 12px 0;\">You are all set up and ready to stream smarter.</p>"
            "<p style=\"margin:0;\">Set your countries and services to see exactly where content is available.</p>"
        ),
        cta_label="Open FullStreamer",
        cta_url=FRONTEND_BASE_URL,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_signup_verification_email(to_email: str, token: str, expires_minutes: int) -> bool:
    link = build_signup_verification_link(token)
    subject = "Confirm your FullStreamer email"
    text_body = (
        "Welcome to FullStreamer.\n\n"
        "Please confirm your email address to finish creating your account.\n\n"
        f"Confirm your email: {link}\n\n"
        f"This link expires in {expires_minutes} minutes.\n\n"
        "If you did not create this account, you can ignore this email."
    )
    html_body = _render_email_html(
        preheader="Confirm your FullStreamer email",
        title="Confirm Your Email",
        subtitle="One more step before your account is ready.",
        body_html=(
            f"<p style=\"margin:0 0 12px 0;\">Click the button below to confirm your email address. The link expires in <strong>{expires_minutes} minutes</strong>.</p>"
            "<p style=\"margin:0;\">If this wasn't you, ignore this message.</p>"
        ),
        cta_label="Confirm Email",
        cta_url=link,
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
    html_body = _render_email_html(
        preheader="Reset your FullStreamer password",
        title="Reset Your Password",
        subtitle="A password reset was requested for your account.",
        body_html=(
            f"<p style=\"margin:0 0 12px 0;\">This secure link expires in <strong>{expires_minutes} minutes</strong>.</p>"
            "<p style=\"margin:0;\">If this was not you, you can safely ignore this message.</p>"
        ),
        cta_label="Reset Password",
        cta_url=link,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_account_deactivated_email(to_email: str, reason: str | None = None) -> bool:
    normalized_reason = (reason or "").strip()
    reason_text = f"Reason: {normalized_reason}\n\n" if normalized_reason else ""
    reason_html = ""
    if normalized_reason:
        escaped_reason = html.escape(normalized_reason)
        reason_html = (
            "<div style=\"margin:14px 0;padding:12px 14px;border:1px solid rgba(255,255,255,0.14);"
            "border-radius:12px;background:rgba(255,255,255,0.04);\">"
            "<p style=\"margin:0 0 6px 0;font-size:12px;color:#cfd6e0;text-transform:uppercase;letter-spacing:.04em;\">Reason</p>"
            f"<p style=\"margin:0;color:#f1f4f9;\">{escaped_reason}</p>"
            "</div>"
        )
    subject = "Your FullStreamer account has been deactivated"
    text_body = (
        "Your FullStreamer account has been deactivated.\n\n"
        f"{reason_text}"
        f"If this was unexpected, contact {SUPPORT_EMAIL}."
    )
    html_body = _render_email_html(
        preheader="Your account has been deactivated",
        title="Account Deactivated",
        subtitle="Your FullStreamer account is currently disabled.",
        body_html=(
            "<p style=\"margin:0 0 12px 0;\">You may not be able to log in until the account is reactivated.</p>"
            f"{reason_html}"
            f"<p style=\"margin:0;\">If this was unexpected, contact <a href=\"mailto:{SUPPORT_EMAIL}\" style=\"color:#ff7b7b;text-decoration:none;\">{SUPPORT_EMAIL}</a>.</p>"
        ),
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_account_deleted_email(to_email: str, reason: str) -> bool:
    normalized_reason = reason.strip()
    escaped_reason = html.escape(normalized_reason)
    subject = "Your FullStreamer account has been deleted"
    text_body = (
        "Your FullStreamer account has been deleted by an administrator.\n\n"
        f"Reason: {normalized_reason}\n\n"
        f"If this was unexpected, contact {SUPPORT_EMAIL}."
    )
    html_body = _render_email_html(
        preheader="Your account has been deleted",
        title="Account Deleted",
        subtitle="Your FullStreamer account has been removed.",
        body_html=(
            "<p style=\"margin:0 0 12px 0;\">This account can no longer be accessed.</p>"
            "<div style=\"margin:14px 0;padding:12px 14px;border:1px solid rgba(255,255,255,0.14);"
            "border-radius:12px;background:rgba(255,255,255,0.04);\">"
            "<p style=\"margin:0 0 6px 0;font-size:12px;color:#cfd6e0;text-transform:uppercase;letter-spacing:.04em;\">Reason</p>"
            f"<p style=\"margin:0;color:#f1f4f9;\">{escaped_reason}</p>"
            "</div>"
            f"<p style=\"margin:0;\">If this was unexpected, contact <a href=\"mailto:{SUPPORT_EMAIL}\" style=\"color:#ff7b7b;text-decoration:none;\">{SUPPORT_EMAIL}</a>.</p>"
        ),
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_account_self_deleted_email(to_email: str) -> bool:
    subject = "Your FullStreamer account was deleted"
    text_body = (
        "Your FullStreamer account was deleted at your request.\n\n"
        f"If this was not you, contact {SUPPORT_EMAIL} immediately."
    )
    html_body = _render_email_html(
        preheader="Your account was deleted",
        title="Account Deleted",
        subtitle="Your request to delete your FullStreamer account is complete.",
        body_html=(
            "<p style=\"margin:0 0 12px 0;\">This account can no longer be accessed.</p>"
            f"<p style=\"margin:0;\">If this was not you, contact <a href=\"mailto:{SUPPORT_EMAIL}\" style=\"color:#ff7b7b;text-decoration:none;\">{SUPPORT_EMAIL}</a> immediately.</p>"
        ),
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_password_changed_email(to_email: str) -> bool:
    subject = "Your FullStreamer password was changed"
    text_body = (
        "Your FullStreamer password was changed successfully.\n\n"
        f"If this was not you, reset your password immediately and contact {SUPPORT_EMAIL}."
    )
    html_body = _render_email_html(
        preheader="Your password was changed",
        title="Password Updated",
        subtitle="Your FullStreamer password has been changed successfully.",
        body_html=(
            "<p style=\"margin:0 0 12px 0;\">If you made this change, no action is needed.</p>"
            f"<p style=\"margin:0;\">If this was not you, reset your password now and contact <a href=\"mailto:{SUPPORT_EMAIL}\" style=\"color:#ff7b7b;text-decoration:none;\">{SUPPORT_EMAIL}</a>.</p>"
        ),
        cta_label="Reset Password",
        cta_url=f"{FRONTEND_BASE_URL}/reset-password",
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_email_change_confirmation_email(to_email: str, token: str, expires_minutes: int) -> bool:
    link = build_email_change_link(token)
    subject = "Confirm your new FullStreamer email"
    text_body = (
        "Confirm your new FullStreamer email address.\n\n"
        f"Confirm email change: {link}\n\n"
        f"This link expires in {expires_minutes} minutes.\n\n"
        "If you did not request this, you can ignore this email."
    )
    html_body = _render_email_html(
        preheader="Confirm your email change",
        title="Confirm New Email",
        subtitle="Finish updating your FullStreamer account email.",
        body_html=(
            f"<p style=\"margin:0 0 12px 0;\">This confirmation link expires in <strong>{expires_minutes} minutes</strong>.</p>"
            "<p style=\"margin:0;\">If you did not request this change, ignore this message.</p>"
        ),
        cta_label="Confirm Email Change",
        cta_url=link,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_account_reactivated_email(to_email: str) -> bool:
    subject = "Your FullStreamer account has been reactivated"
    text_body = (
        "Your FullStreamer account has been reactivated.\n\n"
        f"You can log in again at {FRONTEND_BASE_URL}.\n\n"
        f"If this was unexpected, contact {SUPPORT_EMAIL}."
    )
    html_body = _render_email_html(
        preheader="Your account has been reactivated",
        title="Account Reactivated",
        subtitle="Great news. Your FullStreamer account is active again.",
        body_html=(
            "<p style=\"margin:0 0 12px 0;\">You can now sign in and continue where you left off.</p>"
            f"<p style=\"margin:0;\">If this was unexpected, contact <a href=\"mailto:{SUPPORT_EMAIL}\" style=\"color:#ff7b7b;text-decoration:none;\">{SUPPORT_EMAIL}</a>.</p>"
        ),
        cta_label="Go to FullStreamer",
        cta_url=FRONTEND_BASE_URL,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_availability_notification_email(to_email: str, *, title: str, message: str) -> bool:
    safe_title = (title or "Title").strip() or "Title"
    safe_message = (message or f"{safe_title} has a new availability update.").strip()
    escaped_message = html.escape(safe_message)
    subject = f"Availability update: {safe_title}"
    text_body = (
        f"{safe_message}\n\n"
        f"Open FullStreamer: {FRONTEND_BASE_URL}\n\n"
        "You can manage your alerts from your profile dropdown."
    )
    html_body = _render_email_html(
        preheader=f"Availability update for {safe_title}",
        title="Availability Alert",
        subtitle=f"We found a new availability update for {safe_title}.",
        body_html=(
            f"<p style=\"margin:0 0 12px 0;\">{escaped_message}</p>"
            "<p style=\"margin:0;\">You can manage your alerts in FullStreamer from your profile dropdown.</p>"
        ),
        cta_label="Open FullStreamer",
        cta_url=FRONTEND_BASE_URL,
    )
    return await send_email(to_email, subject, text_body, html_body)
