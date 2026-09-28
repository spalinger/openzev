"""Django system checks for the backups app (ADR 0024).

Imported from ``BackupsConfig.ready()`` so the ``@register`` decorators run.
"""

from django.conf import settings
from django.core.checks import Tags, Warning, register
from django.db import DatabaseError

_KEY_GEN_HINT = (
    'Generate a key with `python -c "import base64, os; '
    'print(base64.urlsafe_b64encode(os.urandom(32)).decode())"` '
    "and set it as BACKUP_ENCRYPTION_KEYS. See ADR 0024."
)


@register(Tags.database)
def scheduled_backup_is_encrypted(app_configs, databases=None, **kwargs):
    """Warn when a schedule would write unencrypted archives on its own, or cannot run at all.

    A database check: only runs under ``manage.py check --database default``.
    """
    if not databases or "default" not in databases:
        return []
    try:
        from . import crypto
        from .schedule import get_schedule

        enabled = get_schedule()["enabled"]
    except DatabaseError:
        return []  # not migrated yet: nothing is scheduled
    if not enabled:
        return []
    try:
        keys = crypto.configured_keys()
    except crypto.BackupCryptoError as exc:
        message = (
            "Scheduled backups are enabled but BACKUP_ENCRYPTION_KEYS cannot be used, "
            f"so scheduled backups cannot run: {exc}"
        )
    else:
        if keys:
            return []
        if settings.BACKUP_REQUIRE_ENCRYPTION:
            message = (
                "Scheduled backups are enabled but BACKUP_ENCRYPTION_KEYS is not set, "
                "so scheduled backups cannot run: backups require encryption on this instance. "
                "Configure BACKUP_ENCRYPTION_KEYS and restart the backend and workers."
            )
        else:
            message = (
                "Scheduled backups are enabled but BACKUP_ENCRYPTION_KEYS is not set, so every scheduled archive is "
                "written unencrypted."
            )
    return [Warning(message, hint=_KEY_GEN_HINT, id="backups.W001")]
