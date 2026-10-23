"""Serialize billing-input writes and invoice generation within a community."""

import zlib

from django.db import connection


BILLING_INPUT_LOCK_NAMESPACE = 1641412


def protect_billing_scope(zev):
    """Prevent live restore from replacing the community until this transaction ends."""
    if zev is not None and connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute('SELECT "id" FROM "zev_zev" WHERE "id" = %s FOR KEY SHARE', [zev.pk])


def lock_billing_inputs(zev):
    protect_billing_scope(zev)
    if zev is not None and connection.vendor == "postgresql":
        key = zlib.crc32(str(zev.pk).encode())
        if key >= 2**31:
            key -= 2**32
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s, %s)", [BILLING_INPUT_LOCK_NAMESPACE, key])
