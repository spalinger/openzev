"""Pure profitability calculator for vZEV planning ("should we form a vZEV?").

Models the *incremental* decision to form a vZEV over the baseline where PV
production is sold entirely to the grid at the feed-in tariff and every
participant buys 100% of consumption from the grid at retail. No metering
data is required — self-consumption is driven by a single planning-stage
assumption, the self-consumption rate::

    self_consumption_rate (sigma) = self-consumed kWh / produced kWh

which mirrors the per-timestamp local-pool allocation used for real invoices
(``min(production, consumption)``, see ``invoices.pdf``) but collapsed to one
annual assumption since no readings exist yet.

Value created by the vZEV is proportional to self-consumed energy, priced at
``retail - feed_in - internal_grid_fee`` — the internal energy price only
redistributes that value between producer and consumers, it does not change
the total (see ``test_calculator.py`` for the invariant check).
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

TWO_PLACES = Decimal("0.01")

# Resolution of the self-consumption sensitivity curve: 0%, 5%, ..., 100%.
SENSITIVITY_STEPS = 21


def _money(value: Decimal) -> Decimal:
    return value.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class FeasibilityInput:
    """Inputs for a single vZEV feasibility scenario.

    All prices are "all-in" CHF/kWh (energy + grid fees + levies) unless
    noted otherwise, matching how a participant actually reads their grid
    bill today.
    """

    annual_production_kwh: Decimal
    annual_consumption_kwh: Decimal
    self_consumption_rate: Decimal
    retail_price_chf_per_kwh: Decimal
    feed_in_price_chf_per_kwh: Decimal
    internal_energy_price_chf_per_kwh: Decimal
    internal_grid_fee_chf_per_kwh: Decimal = Decimal("0")
    annual_opex_chf: Decimal = Decimal("0")
    capex_chf: Decimal = Decimal("0")
    horizon_years: int = 20
    discount_rate: Decimal = Decimal("0.03")

    def __post_init__(self) -> None:
        _validate(self)


def _validate(inputs: FeasibilityInput) -> None:
    if not (Decimal("0") <= inputs.self_consumption_rate <= Decimal("1")):
        raise ValueError("self_consumption_rate must be between 0 and 1")

    non_negative_fields = (
        "annual_production_kwh",
        "annual_consumption_kwh",
        "retail_price_chf_per_kwh",
        "feed_in_price_chf_per_kwh",
        "internal_energy_price_chf_per_kwh",
        "internal_grid_fee_chf_per_kwh",
        "annual_opex_chf",
        "capex_chf",
    )
    for name in non_negative_fields:
        if getattr(inputs, name) < 0:
            raise ValueError(f"{name} must not be negative")

    if inputs.horizon_years < 1:
        raise ValueError("horizon_years must be at least 1")
    if inputs.discount_rate < 0:
        raise ValueError("discount_rate must not be negative")


@dataclass(frozen=True)
class SensitivityPoint:
    self_consumption_rate: Decimal
    annual_net_benefit_chf: Decimal


@dataclass(frozen=True)
class FeasibilityResult:
    self_consumed_kwh: Decimal
    grid_import_kwh: Decimal
    grid_export_kwh: Decimal
    autarky_rate: Decimal

    baseline_consumer_cost_chf: Decimal
    baseline_producer_revenue_chf: Decimal
    vzev_consumer_cost_chf: Decimal
    vzev_producer_revenue_chf: Decimal
    consumer_savings_chf: Decimal
    producer_gain_chf: Decimal

    annual_gross_benefit_chf: Decimal
    annual_net_benefit_chf: Decimal
    payback_years: Decimal | None
    roi: Decimal | None
    npv_chf: Decimal
    cashflow_by_year: list[Decimal]

    sensitivity: list[SensitivityPoint]
    break_even_self_consumption_rate: Decimal | None


def _self_consumed_kwh(rate: Decimal, production_kwh: Decimal, consumption_kwh: Decimal) -> Decimal:
    """Self-consumed energy can never exceed total consumption, even if
    ``rate * production`` would suggest otherwise."""
    return min(rate * production_kwh, consumption_kwh)


def _net_unit_benefit(inputs: FeasibilityInput) -> Decimal:
    return (
        inputs.retail_price_chf_per_kwh
        - inputs.feed_in_price_chf_per_kwh
        - inputs.internal_grid_fee_chf_per_kwh
    )


def _annual_net_benefit_for_rate(rate: Decimal, inputs: FeasibilityInput) -> Decimal:
    self_consumed = _self_consumed_kwh(rate, inputs.annual_production_kwh, inputs.annual_consumption_kwh)
    return self_consumed * _net_unit_benefit(inputs) - inputs.annual_opex_chf


def _build_sensitivity(inputs: FeasibilityInput) -> list[SensitivityPoint]:
    points = []
    for i in range(SENSITIVITY_STEPS):
        rate = Decimal(i) / Decimal(SENSITIVITY_STEPS - 1)
        benefit = _annual_net_benefit_for_rate(rate, inputs)
        points.append(SensitivityPoint(self_consumption_rate=rate, annual_net_benefit_chf=_money(benefit)))
    return points


def _break_even_rate(sensitivity: list[SensitivityPoint]) -> Decimal | None:
    """Linearly interpolate the self-consumption rate where net benefit
    crosses zero. The underlying function is piecewise-linear with at most
    one kink (where self-consumption saturates at total consumption), so
    interpolation between sampled points is exact except within a single
    sampling step around that kink.
    """
    for prev, curr in zip(sensitivity, sensitivity[1:]):
        v0, v1 = prev.annual_net_benefit_chf, curr.annual_net_benefit_chf
        if v0 <= 0 <= v1:
            if v1 == v0:
                return prev.self_consumption_rate
            fraction = (Decimal("0") - v0) / (v1 - v0)
            span = curr.self_consumption_rate - prev.self_consumption_rate
            return prev.self_consumption_rate + fraction * span
    return None


def _payback_years(annual_net_benefit: Decimal, capex: Decimal) -> Decimal | None:
    if annual_net_benefit <= 0:
        return None
    if capex <= 0:
        return Decimal("0")
    return capex / annual_net_benefit


def _roi(annual_net_benefit: Decimal, capex: Decimal) -> Decimal | None:
    if capex <= 0:
        return None
    return annual_net_benefit / capex


def _npv(annual_net_benefit: Decimal, capex: Decimal, horizon_years: int, discount_rate: Decimal) -> Decimal:
    npv = -capex
    for year in range(1, horizon_years + 1):
        npv += annual_net_benefit / (Decimal("1") + discount_rate) ** year
    return npv


def _cashflow_by_year(annual_net_benefit: Decimal, capex: Decimal, horizon_years: int) -> list[Decimal]:
    cashflow = [-capex]
    for _ in range(horizon_years):
        cashflow.append(cashflow[-1] + annual_net_benefit)
    return cashflow


def compute_feasibility(inputs: FeasibilityInput) -> FeasibilityResult:
    """Compute the full vZEV feasibility result for a single scenario."""
    self_consumed = _self_consumed_kwh(
        inputs.self_consumption_rate, inputs.annual_production_kwh, inputs.annual_consumption_kwh
    )
    grid_import = inputs.annual_consumption_kwh - self_consumed
    grid_export = inputs.annual_production_kwh - self_consumed
    autarky_rate = (
        self_consumed / inputs.annual_consumption_kwh if inputs.annual_consumption_kwh > 0 else Decimal("0")
    )

    baseline_consumer_cost = inputs.annual_consumption_kwh * inputs.retail_price_chf_per_kwh
    baseline_producer_revenue = inputs.annual_production_kwh * inputs.feed_in_price_chf_per_kwh

    internal_all_in = inputs.internal_energy_price_chf_per_kwh + inputs.internal_grid_fee_chf_per_kwh
    vzev_consumer_cost = grid_import * inputs.retail_price_chf_per_kwh + self_consumed * internal_all_in
    vzev_producer_revenue = (
        grid_export * inputs.feed_in_price_chf_per_kwh + self_consumed * inputs.internal_energy_price_chf_per_kwh
    )

    consumer_savings = baseline_consumer_cost - vzev_consumer_cost
    producer_gain = vzev_producer_revenue - baseline_producer_revenue
    annual_gross_benefit = consumer_savings + producer_gain
    annual_net_benefit = annual_gross_benefit - inputs.annual_opex_chf

    sensitivity = _build_sensitivity(inputs)

    return FeasibilityResult(
        self_consumed_kwh=_money(self_consumed),
        grid_import_kwh=_money(grid_import),
        grid_export_kwh=_money(grid_export),
        autarky_rate=autarky_rate,
        baseline_consumer_cost_chf=_money(baseline_consumer_cost),
        baseline_producer_revenue_chf=_money(baseline_producer_revenue),
        vzev_consumer_cost_chf=_money(vzev_consumer_cost),
        vzev_producer_revenue_chf=_money(vzev_producer_revenue),
        consumer_savings_chf=_money(consumer_savings),
        producer_gain_chf=_money(producer_gain),
        annual_gross_benefit_chf=_money(annual_gross_benefit),
        annual_net_benefit_chf=_money(annual_net_benefit),
        payback_years=_payback_years(annual_net_benefit, inputs.capex_chf),
        roi=_roi(annual_net_benefit, inputs.capex_chf),
        npv_chf=_money(_npv(annual_net_benefit, inputs.capex_chf, inputs.horizon_years, inputs.discount_rate)),
        cashflow_by_year=[
            _money(v) for v in _cashflow_by_year(annual_net_benefit, inputs.capex_chf, inputs.horizon_years)
        ],
        sensitivity=sensitivity,
        break_even_self_consumption_rate=_break_even_rate(sensitivity),
    )


def estimate_annual_production_kwh(pv_kwp: Decimal, specific_yield_kwh_per_kwp: Decimal) -> Decimal:
    """Estimate annual PV production from installed capacity and a specific-yield assumption."""
    return pv_kwp * specific_yield_kwh_per_kwp
