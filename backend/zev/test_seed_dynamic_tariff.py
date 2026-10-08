"""The screenshot fixture stays local, repeatable and outside seeded billing."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest import mock

import pytest

from allocation.validity import period_window
from invoices.engine import generate_invoice
from metering.models import MeterReading, ReadingDirection
from tariffs.dynamic.models import DynamicTariffSource, FetchStatus
from tariffs.models import BillingMode, EnergyType, PeriodType, Tariff, TariffCategory, TariffPeriod
from tariffs.tasks import refresh_dynamic_tariff_sources
from testing import factories
from zev.management.commands.seed_demo import (
    Command,
    DEMO_DYNAMIC_TARIFF_NAME,
    previous_quarter,
    quarter_start,
)

pytestmark = pytest.mark.django_db


def seed(zev, end_date=date(2026, 10, 7)):
    return Command()._seed_dynamic_tariff(zev, end_date=end_date)


def test_seed_creates_a_linked_disabled_source_without_network_or_tasks(zev):
    with mock.patch("tariffs.tasks.fetch_dynamic_prices.delay") as queue, mock.patch(
        "tariffs.dynamic.fetch.fetch_tariff_document", side_effect=AssertionError("Demo must stay local")
    ):
        tariff = seed(zev)
        assert refresh_dynamic_tariff_sources()["queued"] == 0
    queue.assert_not_called()
    source = tariff.dynamic_source
    assert not source.enabled
    assert ".invalid/" in source.url
    assert "synthetisch" in source.label
    assert source.last_fetch_status == FetchStatus.OK
    assert source.last_fetch_at is not None
    assert source.last_fetch_at == source.last_success_at
    assert source.last_fetch_error == ""
    assert source.recovery_from is None
    assert tariff.name == DEMO_DYNAMIC_TARIFF_NAME
    assert tariff.category == TariffCategory.GRID_FEES
    assert tariff.billing_mode == BillingMode.ENERGY
    assert tariff.energy_type == EnergyType.GRID
    assert not tariff.periods.exists()


@pytest.mark.parametrize("end_date, quarter_hours", [
    (date(2026, 3, 29), 92),
    (date(2026, 10, 25), 100),
])
def test_prices_cover_swiss_civil_days_continuously_including_dst(zev, end_date, quarter_hours):
    source = seed(zev, end_date).dynamic_source
    source.refresh_from_db()
    start, stop = period_window(quarter_start(end_date), end_date + timedelta(days=1))
    assert (source.covers_from, source.covers_to) == (start, stop)
    points = list(source.points.order_by("valid_from"))
    assert points[0].valid_from == start
    assert points[-1].valid_to == stop
    assert all(point.valid_to - point.valid_from == timedelta(minutes=15) for point in points)
    assert all(left.valid_to == right.valid_from for left, right in zip(points, points[1:]))
    day_start, day_stop = period_window(end_date, end_date)
    assert source.points.filter(valid_from__gte=day_start, valid_from__lt=day_stop).count() == quarter_hours
    assert any(point.price_chf_per_kwh < 0 for point in points)
    assert any(point.price_chf_per_kwh > Decimal("0.10000") for point in points)


def test_reseed_preserves_source_and_prices_and_restores_disabled_state(zev):
    tariff = seed(zev)
    source = tariff.dynamic_source
    before = list(source.points.values_list("pk", "valid_from", "valid_to", "price_chf_per_kwh"))
    source.enabled = True
    source.last_fetch_status = FetchStatus.FAILED
    source.last_fetch_error = "Manual refresh failed"
    source.recovery_from = source.points.first().valid_from
    source.save()

    repeated = seed(zev)
    assert repeated.dynamic_source_id == source.pk
    source.refresh_from_db()
    assert not source.enabled
    assert source.last_fetch_status == FetchStatus.OK
    assert source.last_fetch_error == ""
    assert source.recovery_from is None
    assert list(source.points.values_list("pk", "valid_from", "valid_to", "price_chf_per_kwh")) == before
    assert DynamicTariffSource.objects.count() == 1
    assert Tariff.objects.filter(zev=zev, name=DEMO_DYNAMIC_TARIFF_NAME).count() == 1


def test_reseed_replaces_a_demo_edited_series(zev):
    tariff = seed(zev)
    tariff.valid_to = date(2026, 12, 31)
    tariff.dynamic_source = None
    tariff.save()
    TariffPeriod.objects.create(tariff=tariff, period_type=PeriodType.FLAT, price_chf_per_kwh=Decimal("0.10000"))
    Tariff.objects.create(
        zev=zev, name=DEMO_DYNAMIC_TARIFF_NAME, category=TariffCategory.GRID_FEES,
        billing_mode=BillingMode.ENERGY, energy_type=EnergyType.GRID, valid_from=date(2027, 1, 1),
    )

    repeated = seed(zev)
    assert list(Tariff.objects.filter(zev=zev, name=DEMO_DYNAMIC_TARIFF_NAME)) == [repeated]
    assert repeated.dynamic_source_id is not None
    assert (repeated.valid_from, repeated.valid_to) == (date(2026, 10, 1), None)
    assert not repeated.periods.exists()


def test_later_seed_extends_prices_without_rewriting_overlapping_intervals(zev):
    source = seed(zev, date(2026, 10, 7)).dynamic_source
    before = list(source.points.values_list("pk", "valid_from", "valid_to", "price_chf_per_kwh"))
    seed(zev, date(2026, 10, 10))
    assert list(source.points.filter(pk__in=[row[0] for row in before]).values_list(
        "pk", "valid_from", "valid_to", "price_chf_per_kwh"
    )) == before
    assert source.points.count() == len(before) + 3 * 96


def test_shifted_quarter_does_not_change_seeded_invoice_totals(zev):
    participant = factories.ParticipantFactory(zev=zev, valid_from=date(2026, 1, 1))
    meter = factories.MeteringPointFactory(zev=zev)
    factories.MeteringPointAssignmentFactory(
        metering_point=meter, participant=participant, valid_from=date(2026, 1, 1),
    )
    MeterReading.objects.create(
        metering_point=meter, timestamp=datetime(2026, 9, 15, 10, tzinfo=timezone.utc),
        energy_kwh=Decimal("10"), direction=ReadingDirection.IN,
    )
    Command()._seed_tariffs(zev, date(2026, 7, 1))
    start, end = previous_quarter(date(2026, 10, 7))
    baseline = generate_invoice(participant, start, end)
    total = baseline.total_chf
    items = list(baseline.items.values_list("description", "total_chf"))
    assert total > 0

    # This old fixture overlaps the next run's invoice period. The seed must
    # replace it before generating those invoices, rather than merely add a row.
    seed(zev, date(2026, 7, 1))
    moved = seed(zev, date(2026, 10, 7))
    assert moved.valid_from == end + timedelta(days=1)
    assert moved.valid_to is None
    repeated = generate_invoice(participant, start, end)
    assert repeated.total_chf == total
    assert list(repeated.items.values_list("description", "total_chf")) == items
    assert not repeated.dynamic_evidence.exists()
