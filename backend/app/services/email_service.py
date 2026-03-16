import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from app.core.config import get_settings


class EmailDeliveryError(RuntimeError):
    pass


def send_email(*, to_email: str, subject: str, text_body: str, html_body: str) -> None:
    settings = get_settings()
    if not settings.smtp_username or not settings.smtp_password:
        raise EmailDeliveryError("SMTP email delivery is not configured.")

    message = EmailMessage()
    message["Subject"] = subject
    message["To"] = to_email
    message["From"] = formataddr(
        (settings.smtp_from_name, settings.smtp_from_email or settings.smtp_username)
    )
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    try:
        if settings.smtp_use_ssl:
            with smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=settings.smtp_timeout_seconds,
            ) as smtp:
                smtp.login(settings.smtp_username, settings.smtp_password)
                smtp.send_message(message)
            return

        with smtplib.SMTP(
            settings.smtp_host,
            settings.smtp_port,
            timeout=settings.smtp_timeout_seconds,
        ) as smtp:
            smtp.ehlo()
            if settings.smtp_use_tls:
                smtp.starttls()
                smtp.ehlo()
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    except Exception as exc:  # pragma: no cover - network failure path
        raise EmailDeliveryError("Email delivery failed.") from exc
