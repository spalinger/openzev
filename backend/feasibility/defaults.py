"""Default assumptions for the vZEV feasibility calculator.

Rough Swiss planning-stage figures so the calculator form is useful before a
user enters anything. Not regulatory values — once prefill-from-ZEV exists
(a later phase), a real scenario should read tariffs from the ZEV's actual
``tariffs.Tariff`` records instead.
"""
from decimal import Decimal

SPECIFIC_YIELD_KWH_PER_KWP = Decimal("950")
RETAIL_PRICE_CHF_PER_KWH = Decimal("0.32")
FEED_IN_PRICE_CHF_PER_KWH = Decimal("0.09")
INTERNAL_ENERGY_PRICE_CHF_PER_KWH = Decimal("0.20")
INTERNAL_GRID_FEE_CHF_PER_KWH = Decimal("0.03")
ANNUAL_OPEX_CHF = Decimal("300")
DISCOUNT_RATE = Decimal("0.03")
HORIZON_YEARS = 20
