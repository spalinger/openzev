"""Outbound mail for the public invoice-access flow.

Kept out of ``zev.services`` because that module's mail is about *managing*
participants — an owner inviting someone. This is a participant asking for
their own way in, and the two should not share a template or a reason to
change.
"""
import logging

from django.conf import settings
from django.core.mail import EmailMessage

from accounts.models import MAGIC_LINK_LIFETIME
from config.safe_format import render_with_fallback

from .email_context import build_magic_link_email_context

logger = logging.getLogger(__name__)


def send_magic_link_email(participant, zev, link) -> None:
    """Send the sign-in link to the address on file.

    The recipient is always ``participant.email``; the requester cannot choose it.
    Shipped defaults follow the ZEV's ``invoice_language``. A global template
    override applies to every language and opts out of translation.
    """
    from .models import (
        MAGIC_LINK_EMAIL_DEFAULTS_BY_LANGUAGE,
        EmailTemplate,
    )

    defaults = MAGIC_LINK_EMAIL_DEFAULTS_BY_LANGUAGE.get(
        zev.invoice_language or "de",
        MAGIC_LINK_EMAIL_DEFAULTS_BY_LANGUAGE["en"],
    )
    override = EmailTemplate.objects.filter(template_key="participant_magic_link").first()
    subject_tpl = override.subject if override else defaults["subject"]
    body_tpl = override.body if override else defaults["body"]

    context = build_magic_link_email_context(
        participant_name=participant.full_name,
        zev_name=zev.name,
        link_url=f"{settings.FRONTEND_URL.rstrip('/')}/signin/{link.token}",
        valid_minutes=int(MAGIC_LINK_LIFETIME.total_seconds() // 60),
    )

    def _render(template: str, fallback: str) -> str:
        return render_with_fallback(
            template,
            fallback,
            context,
            on_error=lambda _exc: logger.warning("Invalid magic-link template; using default."),
        )

    EmailMessage(
        subject=_render(subject_tpl, defaults["subject"]),
        body=_render(body_tpl, defaults["body"]),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[participant.email],
    ).send(fail_silently=False)
