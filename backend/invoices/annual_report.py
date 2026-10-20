"""Annual ZEV report: a year's energy balance, its monthly trend, what
participation saved each consumer, and what selling locally earned each
producer over feeding the grid.

Owner/admin view of one ZEV and one calendar year (docs/specs/
2026-09-annual-zev-report.md). Energy figures come from
``metering.annual_balance``; the dashboard's per-reading path remains the
reference. Savings are the annual statement's (``compute_savings``) summed per
participant, and the producer uplift sums the per-invoice figures the engine
stored, so the report reconciles with the invoices.
"""

from datetime import date
from decimal import Decimal

from metering.annual_balance import year_energy
from metering.supplementary.stats import civil_window
from metering.supplementary.surfaces import participants_gross
from zev.models import Participant

from .annual_statement import compute_savings
from .models import billed_invoices


def _rate(numerator: float, denominator: float) -> float | None:
    """``numerator / denominator`` as a percentage to one decimal, or None when undefined."""
    if denominator <= 0:
        return None
    return round(numerator / denominator * 100, 1)


def _balance(entry: dict) -> dict:
    """kWh figures plus the two rates the report is about.

    Self-consumption rate: share of production used inside the ZEV.
    Self-sufficiency rate: share of consumption covered by the ZEV.
    """
    self_consumed = max(entry["produced_kwh"] - entry["exported_kwh"], 0.0)
    return {
        "produced_kwh": entry["produced_kwh"],
        "consumed_kwh": entry["consumed_kwh"],
        "imported_kwh": entry["imported_kwh"],
        "exported_kwh": entry["exported_kwh"],
        "self_consumed_kwh": self_consumed,
        "self_consumption_rate": _rate(self_consumed, entry["produced_kwh"]),
        "self_sufficiency_rate": _rate(self_consumed, entry["consumed_kwh"]),
    }


def _empty_month() -> dict:
    return {"produced_kwh": 0.0, "consumed_kwh": 0.0, "imported_kwh": 0.0, "exported_kwh": 0.0}


def _invoices_by_participant(zev, year: int) -> dict[str, list]:
    """The year's billed invoices of ``zev`` grouped by participant id.

    Same invoice selection as the annual statement (``billed_invoices``), so a
    participant's rows here match their statement.
    """
    invoices = (
        billed_invoices(zev, date(year, 1, 1), date(year, 12, 31))
        .prefetch_related("items")
        .order_by("period_start")
    )
    grouped: dict[str, list] = {}
    for invoice in invoices:
        grouped.setdefault(str(invoice.participant_id), []).append(invoice)
    return grouped


def compute_producer_uplift(invoices) -> dict | None:
    """What selling locally earned over feeding the grid, summed over ``invoices``.

    The engine stores, per invoice, the energy sold locally, what the ZEV
    credited for it, and what the same kWh would have earned at the feed-in
    tariff interval by interval. None when there is nothing to compare: no
    local sales, or any invoice whose benchmark is unknown (no feed-in tariff,
    a gap in a fetched series, or issued before the figures were stored) —
    summing only the known invoices would mix periods.

    Unlike ``compute_savings`` a negative result is kept: a ZEV price below
    the feed-in tariff costs the producer money, and hiding that would make
    the column look better than it is.
    """
    if not invoices or any(invoice.local_sale_feed_in_chf is None for invoice in invoices):
        return None

    sold_kwh = sum((invoice.total_local_sold_kwh for invoice in invoices), Decimal("0"))
    if sold_kwh <= 0:
        return None
    local_chf = sum((invoice.local_sale_chf for invoice in invoices), Decimal("0"))
    feed_in_chf = sum((invoice.local_sale_feed_in_chf for invoice in invoices), Decimal("0"))

    return {
        "local_sold_kwh": f"{sold_kwh:.2f}",
        "local_chf": f"{local_chf:.2f}",
        "local_rp": f"{local_chf / sold_kwh * 100:.2f}",
        "feed_in_chf": f"{feed_in_chf:.2f}",
        "feed_in_rp": f"{feed_in_chf / sold_kwh * 100:.2f}",
        "uplift_chf": f"{local_chf - feed_in_chf:.2f}",
    }


def build_annual_report(zev, year: int) -> dict:
    """The annual report payload for ``zev`` and civil ``year``."""
    current = year_energy(zev, year, with_participants=True)
    previous = year_energy(zev, year - 1)

    months = []
    for month in range(1, 13):
        row = {"month": month, **_balance(current.months.get(month, _empty_month()))}
        prior = _balance(previous.months[month]) if month in previous.months else None
        row["previous_self_consumption_rate"] = prior["self_consumption_rate"] if prior else None
        row["previous_self_sufficiency_rate"] = prior["self_sufficiency_rate"] if prior else None
        months.append(row)

    invoices = _invoices_by_participant(zev, year)
    savings = {pid: compute_savings(rows) for pid, rows in invoices.items()}
    uplift = {pid: compute_producer_uplift(rows) for pid, rows in invoices.items()}
    names = {str(p.id): f"{p.first_name} {p.last_name}".strip() for p in zev.participants.all()}
    # Historical or direct-DB assignments may reference a participant outside
    # this ZEV; the dashboard still names those rows.
    missing_names = [pid for pid in current.participants if pid not in names]
    if missing_names:
        names.update(
            {
                str(p.id): f"{p.first_name} {p.last_name}".strip()
                for p in Participant.objects.filter(id__in=missing_names)
            }
        )

    participants = {}
    for pid, stat in current.participants.items():
        participants[pid] = {
            "participant_id": pid,
            "participant_name": names.get(pid, ""),
            "consumed_kwh": stat.consumed_kwh,
            "produced_kwh": stat.produced_kwh,
            "from_zev_kwh": stat.from_zev_kwh,
            "from_grid_kwh": stat.from_grid_kwh,
            "self_sufficiency_rate": (
                None
                if stat.has_behind_meter_generation
                else _rate(stat.from_zev_kwh, stat.consumed_kwh)
            ),
            "has_behind_meter_generation": stat.has_behind_meter_generation,
            "savings": savings.get(pid),
            "uplift": uplift.get(pid),
        }
    # Invoiced but without readings in the year (e.g. a data gap): the savings
    # are still real money, so the row stays.
    for pid, row_savings in savings.items():
        if pid not in participants and pid in names:
            participants[pid] = {
                "participant_id": pid,
                "participant_name": names[pid],
                "consumed_kwh": 0.0,
                "produced_kwh": 0.0,
                "from_zev_kwh": 0.0,
                "from_grid_kwh": 0.0,
                "self_sufficiency_rate": None,
                "has_behind_meter_generation": False,
                "savings": row_savings,
                "uplift": uplift.get(pid),
            }

    gross = participants_gross(list(participants), *civil_window(date(year, 1, 1), date(year, 12, 31)))
    for pid, row in participants.items():
        row["gross_energy"] = gross.get(pid)

    saved = [Decimal(row["savings"]["saved_chf"]) for row in participants.values() if row["savings"]]
    uplifts = [Decimal(row["uplift"]["uplift_chf"]) for row in participants.values() if row["uplift"]]

    return {
        "zev_id": str(zev.id),
        "year": year,
        "has_data": current.has_data,
        "has_behind_meter_generation": current.has_behind_meter_generation,
        "totals": _balance(current.totals),
        "previous_totals": _balance(previous.totals) if previous.has_data else None,
        "months": months,
        "participants": sorted(
            participants.values(),
            key=lambda row: (row["participant_name"].lower(), row["participant_id"]),
        ),
        "savings_total_chf": f"{sum(saved, Decimal('0')):.2f}" if saved else None,
        "uplift_total_chf": f"{sum(uplifts, Decimal('0')):.2f}" if uplifts else None,
    }
