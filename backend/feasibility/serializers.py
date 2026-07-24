from decimal import Decimal

from rest_framework import serializers

from . import defaults


class ParticipantInputSerializer(serializers.Serializer):
    """One row of the optional per-participant breakdown.

    Purely additive: the aggregate scenario math still runs off
    ``annual_production_kwh``/``annual_consumption_kwh`` on the parent
    serializer regardless of whether this list is supplied, empty, or
    inconsistent with those totals — see ``FeasibilityInput``'s docstring.
    """

    name = serializers.CharField(max_length=200)
    annual_production_kwh = serializers.DecimalField(max_digits=12, decimal_places=4, min_value=0, default=Decimal("0"))
    annual_consumption_kwh = serializers.DecimalField(max_digits=12, decimal_places=4, min_value=0, default=Decimal("0"))


class FeasibilityInputSerializer(serializers.Serializer):
    """Validates a feasibility scenario request body.

    Field names match ``calculator.FeasibilityInput`` 1:1 so validated_data
    can be passed straight through as kwargs (after converting
    ``participants`` dicts to ``ParticipantInput`` instances — see the view).
    Only the three values that actually define the scenario (production,
    consumption, self-consumption rate) are required; everything else falls
    back to a Swiss planning-stage default from ``defaults.py``.
    """

    annual_production_kwh = serializers.DecimalField(max_digits=12, decimal_places=4, min_value=0)
    annual_consumption_kwh = serializers.DecimalField(max_digits=12, decimal_places=4, min_value=0)
    self_consumption_rate = serializers.DecimalField(max_digits=5, decimal_places=4, min_value=0, max_value=1)

    retail_price_chf_per_kwh = serializers.DecimalField(
        max_digits=8, decimal_places=5, min_value=0, default=defaults.RETAIL_PRICE_CHF_PER_KWH
    )
    feed_in_price_chf_per_kwh = serializers.DecimalField(
        max_digits=8, decimal_places=5, min_value=0, default=defaults.FEED_IN_PRICE_CHF_PER_KWH
    )
    internal_energy_price_chf_per_kwh = serializers.DecimalField(
        max_digits=8, decimal_places=5, min_value=0, default=defaults.INTERNAL_ENERGY_PRICE_CHF_PER_KWH
    )
    annual_opex_chf = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=0, default=defaults.ANNUAL_OPEX_CHF
    )
    capex_chf = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0, default=Decimal("0"))
    horizon_years = serializers.IntegerField(min_value=1, max_value=50, default=defaults.HORIZON_YEARS)
    discount_rate = serializers.DecimalField(
        max_digits=5, decimal_places=4, min_value=0, default=defaults.DISCOUNT_RATE
    )
    participants = ParticipantInputSerializer(many=True, required=False, default=list)


class SensitivityPointSerializer(serializers.Serializer):
    self_consumption_rate = serializers.DecimalField(max_digits=5, decimal_places=4)
    annual_net_benefit_chf = serializers.DecimalField(max_digits=14, decimal_places=2)


class PriceSensitivityPointSerializer(serializers.Serializer):
    internal_price_pct_of_retail = serializers.DecimalField(max_digits=5, decimal_places=4)
    internal_price_chf_per_kwh = serializers.DecimalField(max_digits=8, decimal_places=5)
    producer_gain_chf = serializers.DecimalField(max_digits=14, decimal_places=2)
    consumer_savings_chf = serializers.DecimalField(max_digits=14, decimal_places=2)


class FairPriceRangeSerializer(serializers.Serializer):
    low_chf_per_kwh = serializers.DecimalField(max_digits=8, decimal_places=5)
    high_chf_per_kwh = serializers.DecimalField(max_digits=8, decimal_places=5)


class ParticipantResultSerializer(serializers.Serializer):
    name = serializers.CharField()
    annual_production_kwh = serializers.DecimalField(max_digits=14, decimal_places=2)
    annual_consumption_kwh = serializers.DecimalField(max_digits=14, decimal_places=2)
    self_consumed_from_own_production_kwh = serializers.DecimalField(max_digits=14, decimal_places=2)
    exported_kwh = serializers.DecimalField(max_digits=14, decimal_places=2)
    from_local_pool_kwh = serializers.DecimalField(max_digits=14, decimal_places=2)
    from_grid_kwh = serializers.DecimalField(max_digits=14, decimal_places=2)
    producer_gain_chf = serializers.DecimalField(max_digits=14, decimal_places=2)
    consumer_savings_chf = serializers.DecimalField(max_digits=14, decimal_places=2)
    net_benefit_chf = serializers.DecimalField(max_digits=14, decimal_places=2)


class FeasibilityResultSerializer(serializers.Serializer):
    """Read-only serializer for ``calculator.FeasibilityResult``.

    A plain ``Serializer`` works directly against the dataclass instance —
    fields are read via attribute access, no model required.
    """

    self_consumed_kwh = serializers.DecimalField(max_digits=14, decimal_places=2)
    grid_import_kwh = serializers.DecimalField(max_digits=14, decimal_places=2)
    grid_export_kwh = serializers.DecimalField(max_digits=14, decimal_places=2)
    autarky_rate = serializers.DecimalField(max_digits=5, decimal_places=4)

    baseline_consumer_cost_chf = serializers.DecimalField(max_digits=14, decimal_places=2)
    baseline_producer_revenue_chf = serializers.DecimalField(max_digits=14, decimal_places=2)
    vzev_consumer_cost_chf = serializers.DecimalField(max_digits=14, decimal_places=2)
    vzev_producer_revenue_chf = serializers.DecimalField(max_digits=14, decimal_places=2)
    consumer_savings_chf = serializers.DecimalField(max_digits=14, decimal_places=2)
    producer_gain_chf = serializers.DecimalField(max_digits=14, decimal_places=2)

    annual_gross_benefit_chf = serializers.DecimalField(max_digits=14, decimal_places=2)
    annual_net_benefit_chf = serializers.DecimalField(max_digits=14, decimal_places=2)
    payback_years = serializers.DecimalField(max_digits=10, decimal_places=4, allow_null=True)
    roi = serializers.DecimalField(max_digits=10, decimal_places=4, allow_null=True)
    npv_chf = serializers.DecimalField(max_digits=14, decimal_places=2)
    cashflow_by_year = serializers.ListField(child=serializers.DecimalField(max_digits=14, decimal_places=2))

    sensitivity = SensitivityPointSerializer(many=True)
    break_even_self_consumption_rate = serializers.DecimalField(max_digits=5, decimal_places=4, allow_null=True)

    price_sensitivity = PriceSensitivityPointSerializer(many=True)
    equal_split_price_chf_per_kwh = serializers.DecimalField(max_digits=8, decimal_places=5, allow_null=True)
    fair_price_range = FairPriceRangeSerializer(allow_null=True)

    participants = ParticipantResultSerializer(many=True)


class ParticipantPrefillSerializer(serializers.Serializer):
    name = serializers.CharField()
    annual_production_kwh = serializers.DecimalField(max_digits=12, decimal_places=4)
    annual_consumption_kwh = serializers.DecimalField(max_digits=12, decimal_places=4)
    has_metering_data = serializers.BooleanField()


class FeasibilityPrefillSerializer(serializers.Serializer):
    """Read-only serializer for ``prefill.FeasibilityPrefill``.

    Prices are ``allow_null`` — the frontend keeps its own Swiss default for
    any price this couldn't determine from the ZEV's actual tariffs.
    """

    participants = ParticipantPrefillSerializer(many=True)
    retail_price_chf_per_kwh = serializers.DecimalField(max_digits=8, decimal_places=5, allow_null=True)
    feed_in_price_chf_per_kwh = serializers.DecimalField(max_digits=8, decimal_places=5, allow_null=True)
    internal_energy_price_chf_per_kwh = serializers.DecimalField(max_digits=8, decimal_places=5, allow_null=True)
