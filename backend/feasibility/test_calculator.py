"""Unit tests for the pure vZEV feasibility calculator.

No Django/DB dependency — these are plain function calls against hand-computed
expected values.
"""
from decimal import Decimal

import pytest

from .calculator import (
    FeasibilityInput,
    compute_feasibility,
    estimate_annual_production_kwh,
)


def _typical_input(**overrides) -> FeasibilityInput:
    """production=10'000 kWh, consumption=8'000 kWh, sigma=50% -> self-consumed=5'000 kWh."""
    defaults = dict(
        annual_production_kwh=Decimal("10000"),
        annual_consumption_kwh=Decimal("8000"),
        self_consumption_rate=Decimal("0.5"),
        retail_price_chf_per_kwh=Decimal("0.32"),
        feed_in_price_chf_per_kwh=Decimal("0.09"),
        internal_energy_price_chf_per_kwh=Decimal("0.20"),
        internal_grid_fee_chf_per_kwh=Decimal("0.03"),
        annual_opex_chf=Decimal("300"),
        capex_chf=Decimal("2000"),
        horizon_years=20,
        discount_rate=Decimal("0.03"),
    )
    defaults.update(overrides)
    return FeasibilityInput(**defaults)


class TestTypicalScenario:
    """Hand-computed reference scenario, see module docstring math:

    self_consumed = min(0.5*10000, 8000) = 5000
    net_unit_benefit = 0.32 - 0.09 - 0.03 = 0.20
    gross_benefit = 5000 * 0.20 = 1000.00
    """

    def test_energy_balance(self):
        result = compute_feasibility(_typical_input())
        assert result.self_consumed_kwh == Decimal("5000.00")
        assert result.grid_import_kwh == Decimal("3000.00")
        assert result.grid_export_kwh == Decimal("5000.00")
        assert result.autarky_rate == Decimal("0.625")  # 5000/8000

    def test_baseline_costs(self):
        result = compute_feasibility(_typical_input())
        assert result.baseline_consumer_cost_chf == Decimal("2560.00")  # 8000*0.32
        assert result.baseline_producer_revenue_chf == Decimal("900.00")  # 10000*0.09

    def test_vzev_costs_and_split(self):
        result = compute_feasibility(_typical_input())
        # 3000*0.32 + 5000*(0.20+0.03) = 960 + 1150
        assert result.vzev_consumer_cost_chf == Decimal("2110.00")
        # 5000*0.09 + 5000*0.20 = 450 + 1000
        assert result.vzev_producer_revenue_chf == Decimal("1450.00")
        assert result.consumer_savings_chf == Decimal("450.00")
        assert result.producer_gain_chf == Decimal("550.00")

    def test_gross_and_net_benefit(self):
        result = compute_feasibility(_typical_input())
        assert result.annual_gross_benefit_chf == Decimal("1000.00")
        assert result.annual_net_benefit_chf == Decimal("700.00")  # 1000 - 300 opex

    def test_payback_and_roi(self):
        result = compute_feasibility(_typical_input())
        expected_payback = (Decimal("2000") / Decimal("700")).quantize(Decimal("0.0001"))
        assert result.payback_years.quantize(Decimal("0.0001")) == expected_payback
        assert result.roi == Decimal("0.35")  # 700/2000

    def test_npv_matches_independent_annuity_sum(self):
        result = compute_feasibility(_typical_input())
        expected = Decimal("-2000")
        for year in range(1, 21):
            expected += Decimal("700") / (Decimal("1.03") ** year)
        assert result.npv_chf == expected.quantize(Decimal("0.01"))

    def test_break_even_self_consumption_rate(self):
        # plateau at sigma=1: S=min(10000,8000)=8000 -> gross=1600, net=1300 > 0, so a
        # break-even exists in the unconstrained (linear) region: opex / (P*net_unit_benefit)
        # = 300 / (10000*0.20) = 0.15, which lands exactly on the 5%-step sampling grid.
        result = compute_feasibility(_typical_input())
        assert result.break_even_self_consumption_rate == Decimal("0.15")

    def test_sensitivity_curve_shape(self):
        result = compute_feasibility(_typical_input())
        assert len(result.sensitivity) == 21
        assert result.sensitivity[0].self_consumption_rate == Decimal("0")
        assert result.sensitivity[0].annual_net_benefit_chf == Decimal("-300.00")  # S=0, net=-opex
        assert result.sensitivity[-1].self_consumption_rate == Decimal("1")

    def test_cashflow_by_year(self):
        result = compute_feasibility(_typical_input())
        assert len(result.cashflow_by_year) == 21  # horizon_years + 1 (year 0 = -capex)
        assert result.cashflow_by_year[0] == Decimal("-2000.00")
        assert result.cashflow_by_year[1] == Decimal("-1300.00")  # -2000 + 700
        assert result.cashflow_by_year[-1] == Decimal("-2000.00") + 20 * Decimal("700.00")


class TestSinglePeriodNpv:
    """A scenario chosen so the year-1 discounting divides out exactly:
    1030 / 1.03 == 1000 with no rounding, giving NPV == 0 by hand."""

    def test_npv_zero_at_break_even_single_year(self):
        inputs = FeasibilityInput(
            annual_production_kwh=Decimal("1000"),
            annual_consumption_kwh=Decimal("1000"),
            self_consumption_rate=Decimal("1"),
            retail_price_chf_per_kwh=Decimal("1.50"),
            feed_in_price_chf_per_kwh=Decimal("0.30"),
            internal_energy_price_chf_per_kwh=Decimal("0.50"),
            internal_grid_fee_chf_per_kwh=Decimal("0.17"),
            annual_opex_chf=Decimal("0"),
            capex_chf=Decimal("1000"),
            horizon_years=1,
            discount_rate=Decimal("0.03"),
        )
        result = compute_feasibility(inputs)
        assert result.annual_net_benefit_chf == Decimal("1030.00")  # 1000*(1.50-0.30-0.17)
        assert result.npv_chf == Decimal("0.00")
        assert result.roi == Decimal("1.03")
        assert result.payback_years.quantize(Decimal("0.0001")) == (
            Decimal("1000") / Decimal("1030")
        ).quantize(Decimal("0.0001"))


class TestInternalPriceInvariant:
    """internal_energy_price only redistributes value between producer and
    consumers; it must never change the total pie."""

    def test_gross_benefit_unaffected_by_internal_energy_price(self):
        cheap = compute_feasibility(_typical_input(internal_energy_price_chf_per_kwh=Decimal("0.10")))
        expensive = compute_feasibility(_typical_input(internal_energy_price_chf_per_kwh=Decimal("0.28")))

        assert cheap.annual_gross_benefit_chf == expensive.annual_gross_benefit_chf
        assert cheap.annual_net_benefit_chf == expensive.annual_net_benefit_chf
        # but the split between producer and consumers does change
        assert cheap.producer_gain_chf != expensive.producer_gain_chf
        assert cheap.consumer_savings_chf != expensive.consumer_savings_chf
        assert cheap.producer_gain_chf + cheap.consumer_savings_chf == cheap.annual_gross_benefit_chf
        assert expensive.producer_gain_chf + expensive.consumer_savings_chf == expensive.annual_gross_benefit_chf


class TestEdgeCases:
    def test_zero_self_consumption_rate_yields_zero_gross_benefit(self):
        result = compute_feasibility(_typical_input(self_consumption_rate=Decimal("0")))
        assert result.self_consumed_kwh == Decimal("0.00")
        assert result.annual_gross_benefit_chf == Decimal("0.00")
        assert result.annual_net_benefit_chf == Decimal("-300.00")  # just -opex
        # payback is undefined without a positive net benefit, regardless of capex...
        assert result.payback_years is None
        # ...but ROI is defined purely from capex, independent of benefit sign.
        assert result.roi == Decimal("-0.15")  # -300/2000

    def test_zero_production_gives_zero_benefit_regardless_of_rate(self):
        result = compute_feasibility(
            _typical_input(annual_production_kwh=Decimal("0"), self_consumption_rate=Decimal("1"))
        )
        assert result.self_consumed_kwh == Decimal("0.00")
        assert result.grid_export_kwh == Decimal("0.00")
        assert result.grid_import_kwh == Decimal("8000.00")
        assert result.producer_gain_chf == Decimal("0.00")
        assert result.consumer_savings_chf == Decimal("0.00")

    def test_zero_consumption_gives_zero_benefit(self):
        result = compute_feasibility(
            _typical_input(annual_consumption_kwh=Decimal("0"), self_consumption_rate=Decimal("1"))
        )
        assert result.self_consumed_kwh == Decimal("0.00")
        assert result.grid_import_kwh == Decimal("0.00")
        assert result.grid_export_kwh == Decimal("10000.00")
        assert result.autarky_rate == Decimal("0")
        assert result.annual_gross_benefit_chf == Decimal("0.00")

    def test_self_consumption_capped_by_consumption_not_production(self):
        # sigma=1 with production >> consumption: self-consumed can't exceed consumption.
        result = compute_feasibility(
            _typical_input(
                annual_production_kwh=Decimal("10000"),
                annual_consumption_kwh=Decimal("2000"),
                self_consumption_rate=Decimal("1"),
            )
        )
        assert result.self_consumed_kwh == Decimal("2000.00")
        assert result.grid_import_kwh == Decimal("0.00")
        assert result.grid_export_kwh == Decimal("8000.00")

    def test_break_even_none_when_unreachable(self):
        # opex so high that even 100% self-consumption (capped at consumption=8000)
        # can't cover it: plateau = 8000*0.20 - 5000 = -3400 < 0.
        result = compute_feasibility(_typical_input(annual_opex_chf=Decimal("5000")))
        assert result.break_even_self_consumption_rate is None

    def test_payback_zero_when_no_capex_but_positive_benefit(self):
        result = compute_feasibility(_typical_input(capex_chf=Decimal("0")))
        assert result.payback_years == Decimal("0")
        assert result.roi is None  # ROI undefined without an investment base

    def test_npv_ignores_capex_when_zero(self):
        result = compute_feasibility(_typical_input(capex_chf=Decimal("0")))
        expected = Decimal("0")
        for year in range(1, 21):
            expected += Decimal("700") / (Decimal("1.03") ** year)
        assert result.npv_chf == expected.quantize(Decimal("0.01"))


class TestValidation:
    @pytest.mark.parametrize(
        "field,value",
        [
            ("self_consumption_rate", Decimal("-0.01")),
            ("self_consumption_rate", Decimal("1.01")),
            ("annual_production_kwh", Decimal("-1")),
            ("annual_consumption_kwh", Decimal("-1")),
            ("retail_price_chf_per_kwh", Decimal("-0.01")),
            ("feed_in_price_chf_per_kwh", Decimal("-0.01")),
            ("internal_energy_price_chf_per_kwh", Decimal("-0.01")),
            ("internal_grid_fee_chf_per_kwh", Decimal("-0.01")),
            ("annual_opex_chf", Decimal("-1")),
            ("capex_chf", Decimal("-1")),
            ("discount_rate", Decimal("-0.01")),
        ],
    )
    def test_invalid_field_raises(self, field, value):
        with pytest.raises(ValueError):
            _typical_input(**{field: value})

    def test_zero_horizon_years_raises(self):
        with pytest.raises(ValueError):
            _typical_input(horizon_years=0)

    def test_boundary_self_consumption_rate_allowed(self):
        # 0 and 1 are valid boundaries, must not raise.
        compute_feasibility(_typical_input(self_consumption_rate=Decimal("0")))
        compute_feasibility(_typical_input(self_consumption_rate=Decimal("1")))


class TestEstimateAnnualProduction:
    def test_multiplies_kwp_by_specific_yield(self):
        result = estimate_annual_production_kwh(Decimal("10"), Decimal("950"))
        assert result == Decimal("9500")
