"""Celery tasks for account maintenance."""

from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from .models import OAuthExchangeCode, OAuthState


@shared_task
def cleanup_expired_oauth_tokens() -> dict[str, int]:
    """Delete expired OAuth states and exchange codes."""
    now = timezone.now()

    expired_state_cutoff = now - timedelta(minutes=10)
    expired_code_cutoff = now - timedelta(seconds=60)

    deleted_states, _ = OAuthState.objects.filter(created_at__lt=expired_state_cutoff).delete()
    deleted_codes, _ = OAuthExchangeCode.objects.filter(created_at__lt=expired_code_cutoff).delete()

    return {
        "deleted_states": deleted_states,
        "deleted_codes": deleted_codes,
    }