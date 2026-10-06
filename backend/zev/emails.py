"""Outbound mail for onboarding a participant.

Kept out of ``invoices.emails``, which is where the magic-link mail lives: that
one is a participant asking for their own way in from an invoice they already
hold, and this is an operator adding someone who has nothing yet. Different
trigger, different reason to change.
"""
import logging

from django.conf import settings
from django.core.mail import EmailMessage

from config.safe_format import render_with_fallback
from invoices.email_context import build_onboarding_email_context

logger = logging.getLogger(__name__)


def format_expiry_date(expires_at) -> str:
    """Readable expiry for the mailed link, in ``AppSettings.date_format_short``."""
    from accounts.models import AppSettings
    from invoices.dates import format_date_value

    return format_date_value(expires_at, AppSettings.load().date_format_short)


def send_onboarding_email(participant, inviter_name: str, link_url: str, expires_at) -> None:
    """Email the onboarding link to the address on the participant's record.

    Onboarding precedes invoices and uses a global template, independent of
    the ZEV's ``invoice_language``.
    """
    from invoices.models import EMAIL_TEMPLATE_DEFAULTS, EmailTemplate

    defaults = EMAIL_TEMPLATE_DEFAULTS["participant_onboarding"]
    override = EmailTemplate.objects.filter(template_key="participant_onboarding").first()
    subject_tpl = override.subject if override else defaults["subject"]
    body_tpl = override.body if override else defaults["body"]

    context = build_onboarding_email_context(
        participant_name=participant.full_name,
        inviter_name=inviter_name,
        zev_name=participant.zev.name,
        link_url=link_url,
        expiry_date=format_expiry_date(expires_at),
    )

    def _render(template: str, fallback: str) -> str:
        return render_with_fallback(
            template,
            fallback,
            context,
            on_error=lambda _exc: logger.warning("Invalid onboarding template; using default."),
        )

    EmailMessage(
        subject=_render(subject_tpl, defaults["subject"]),
        body=_render(body_tpl, defaults["body"]),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[participant.email],
    ).send(fail_silently=False)
