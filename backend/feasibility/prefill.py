"""Best-effort prefill of feasibility calculator inputs from a real ZEV.

Not authoritative — a starting point to review and adjust, not a substitute
for entering real numbers. Two independent approximations:

1. Per-participant production/consumption: sums each participant's assigned
   metering points' readings and extrapolates whatever history exists
   (however short) to a full year. Participants with no readings at all yet
   (a brand-new ZEV) fall back to a generic default and are flagged via
   ``has_metering_data=False`` so the frontend can call that out.
2. Tariff prices: takes the simplest currently-active flat energy tariff of
   each relevant type (category=ENERGY, billing_mode=ENERGY) and ignores
   percentage-of-energy/fixed-fee tariffs, HT/NT splits within a tariff, and
   any tariffs beyond the one currently active. Returns None for a price it
   can't determine this way — the caller falls back to the calculator's own
   Swiss defaults, exactly as it already does for any field a user leaves
   blank. There is no internal grid fee to prefill: within a vZEV, locally
   consumed energy is only ever priced as energy.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal

from django.db.models import Max, Min, Q, Sum

from metering.models import MeterReading, ReadingDirection
from tariffs.models import BillingMode, EnergyType, Tariff, TariffCategory
from zev.models import MeteringPointType, Participant, Zev

from . import defaults


@dataclass(frozen=True)
class ParticipantPrefill:
    name: str
    annual_production_kwh: Decimal
    annual_consumption_kwh: Decimal
    has_metering_data: bool


@dataclass(frozen=True)
class FeasibilityPrefill:
    participants: list[ParticipantPrefill]
    retail_price_chf_per_kwh: Decimal | None
    feed_in_price_chf_per_kwh: Decimal | None
    internal_energy_price_chf_per_kwh: Decimal | None


def _active_flat_tariff_price(zev: Zev, *, category: str, energy_type: str, today: dt.date) -> Decimal | None:
    tariff = (
        Tariff.objects.filter(
            zev=zev,
            category=category,
            energy_type=energy_type,
            billing_mode=BillingMode.ENERGY,
            valid_from__lte=today,
        )
        .filter(Q(valid_to__isnull=True) | Q(valid_to__gte=today))
        .order_by("-valid_from")
        .first()
    )
    if tariff is None:
        return None
    # TariffPeriod.Meta orders by period_type, and 'flat' sorts before
    # 'high'/'low' alphabetically, so this picks the flat rate when one
    # exists and an arbitrary HT/NT band otherwise — a rough approximation.
    period = tariff.periods.first()
    return period.price_chf_per_kwh if period else None


def _extrapolated_annual_kwh(
    participant: Participant, *, meter_types: list[str], direction: str
) -> tuple[Decimal, bool]:
    """Sum this participant's readings of the given direction/meter type and
    extrapolate to a full year based on however much history actually spans.
    Returns (annual_kwh, whether any readings were found at all)."""
    metering_point_ids = participant.metering_point_assignments.filter(
        metering_point__meter_type__in=meter_types,
    ).values_list("metering_point_id", flat=True)

    aggregate = MeterReading.objects.filter(
        metering_point_id__in=metering_point_ids,
        direction=direction,
    ).aggregate(total=Sum("energy_kwh"), first=Min("timestamp"), last=Max("timestamp"))

    if not aggregate["total"] or aggregate["first"] is None or aggregate["last"] is None:
        return Decimal("0"), False

    span_days = max((aggregate["last"] - aggregate["first"]).days, 1)
    annual = aggregate["total"] * Decimal(365) / Decimal(span_days)
    return annual, True


def build_prefill(zev: Zev) -> FeasibilityPrefill:
    today = dt.date.today()

    active_participants = zev.participants.filter(valid_from__lte=today).filter(
        Q(valid_to__isnull=True) | Q(valid_to__gte=today)
    )

    participants = []
    for participant in active_participants:
        production, has_production_data = _extrapolated_annual_kwh(
            participant,
            meter_types=[MeteringPointType.PRODUCTION, MeteringPointType.BIDIRECTIONAL],
            direction=ReadingDirection.OUT,
        )
        consumption, has_consumption_data = _extrapolated_annual_kwh(
            participant,
            meter_types=[MeteringPointType.CONSUMPTION, MeteringPointType.BIDIRECTIONAL],
            direction=ReadingDirection.IN,
        )
        has_data = has_production_data or has_consumption_data
        if not has_data:
            consumption = defaults.DEFAULT_PARTICIPANT_CONSUMPTION_KWH

        participants.append(
            ParticipantPrefill(
                name=participant.full_name,
                annual_production_kwh=production,
                annual_consumption_kwh=consumption,
                has_metering_data=has_data,
            )
        )

    return FeasibilityPrefill(
        participants=participants,
        retail_price_chf_per_kwh=_active_flat_tariff_price(
            zev, category=TariffCategory.ENERGY, energy_type=EnergyType.GRID, today=today
        ),
        feed_in_price_chf_per_kwh=_active_flat_tariff_price(
            zev, category=TariffCategory.ENERGY, energy_type=EnergyType.FEED_IN, today=today
        ),
        internal_energy_price_chf_per_kwh=_active_flat_tariff_price(
            zev, category=TariffCategory.ENERGY, energy_type=EnergyType.LOCAL, today=today
        ),
    )
