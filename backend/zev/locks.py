"""Serialize instance-wide meter identity validation and persistence."""

from django.db import connection


METER_IDENTITY_LOCK_NAMESPACE = 1641413


def lock_meter_identities():
    """Call inside the transaction before validating or locking a point."""
    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(%s, %s)",
                [METER_IDENTITY_LOCK_NAMESPACE, 0],
            )
