"""Seed the standard Swiss VAT history (7.7% 2018-2023, 8.1% from 2024).

One-time installation step so fresh and upgraded databases can bill
historical periods without running ``seed_demo`` or configuring VAT first.
Existing administrator-managed rows are preserved: each candidate is skipped
entirely if any stored row overlaps it (inclusive boundaries, mirroring
``allocation.validity.active_during``). A partial custom history may therefore
leave some periods without a rate; those need manual completion. Reverse is a deliberate no-op —
without a provenance field, rollback cannot tell migration-owned rows from
later edits, so rows are kept.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db import migrations, models


def seed_vat_rates(apps, schema_editor):
    VatRate = apps.get_model("accounts", "VatRate")
    alias = schema_editor.connection.alias
    rates = VatRate.objects.using(alias)
    candidates = (
        (Decimal("0.0770"), datetime.date(2018, 1, 1), datetime.date(2023, 12, 31)),
        (Decimal("0.0810"), datetime.date(2024, 1, 1), None),
    )
    for rate, valid_from, valid_to in candidates:
        overlaps = (
            rates.filter(valid_from__lte=valid_to or datetime.date.max)
            .filter(models.Q(valid_to__isnull=True) | models.Q(valid_to__gte=valid_from))
            .exists()
        )
        if not overlaps:
            rates.create(rate=rate, valid_from=valid_from, valid_to=valid_to)


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0014_user_preferred_zev"),
    ]

    operations = [
        migrations.RunPython(seed_vat_rates, migrations.RunPython.noop),
    ]
