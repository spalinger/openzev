import { z } from 'zod'
import type { FeasibilityInput } from '../../types/api'

export type InternalEnergyPriceMode = 'absolute' | 'percentage_of_retail'
export type AnnualProductionMode = 'absolute' | 'from_kwp'

export type FeasibilityFormValues = {
  annual_production_mode: AnnualProductionMode
  annual_production_kwh: string
  pv_kwp: string
  specific_yield_kwh_per_kwp: string
  annual_consumption_kwh: string
  self_consumption_rate_pct: string
  retail_price_chf_per_kwh: string
  feed_in_price_chf_per_kwh: string
  internal_energy_price_mode: InternalEnergyPriceMode
  internal_energy_price_chf_per_kwh: string
  internal_energy_price_pct_of_retail: string
  internal_grid_fee_chf_per_kwh: string
  annual_opex_chf: string
  capex_chf: string
  horizon_years: string
  discount_rate_pct: string
}

function isNonNegativeNumber(value: string): boolean {
  if (value.trim() === '') return false
  const n = Number(value)
  return !Number.isNaN(n) && n >= 0
}

function isPercentage(value: string): boolean {
  if (value.trim() === '') return false
  const n = Number(value)
  return !Number.isNaN(n) && n >= 0 && n <= 100
}

export const feasibilityFormSchema = z.object({
  annual_production_mode: z.enum(['absolute', 'from_kwp']),
  annual_production_kwh: z.string().refine(isNonNegativeNumber),
  pv_kwp: z.string().refine(isNonNegativeNumber),
  specific_yield_kwh_per_kwp: z.string().refine(isNonNegativeNumber),
  annual_consumption_kwh: z.string().refine(isNonNegativeNumber),
  self_consumption_rate_pct: z.string().refine(isPercentage),
  retail_price_chf_per_kwh: z.string().refine(isNonNegativeNumber),
  feed_in_price_chf_per_kwh: z.string().refine(isNonNegativeNumber),
  internal_energy_price_mode: z.enum(['absolute', 'percentage_of_retail']),
  internal_energy_price_chf_per_kwh: z.string().refine(isNonNegativeNumber),
  internal_energy_price_pct_of_retail: z.string().refine(isNonNegativeNumber),
  internal_grid_fee_chf_per_kwh: z.string().refine(isNonNegativeNumber),
  annual_opex_chf: z.string().refine(isNonNegativeNumber),
  capex_chf: z.string().refine(isNonNegativeNumber),
  horizon_years: z.string().refine((v) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 1 && n <= 50
  }),
  discount_rate_pct: z.string().refine(isPercentage),
})

// Illustrative starting values plus Swiss planning-stage defaults mirroring
// backend/feasibility/defaults.py. Kept in sync manually — these only seed
// the form so it shows a live result immediately; the backend remains the
// single source of truth for the actual calculation.
export const defaultFeasibilityFormValues: FeasibilityFormValues = {
  annual_production_mode: 'absolute',
  annual_production_kwh: '10000',
  pv_kwp: '10',
  specific_yield_kwh_per_kwp: '950',
  annual_consumption_kwh: '8000',
  self_consumption_rate_pct: '50',
  retail_price_chf_per_kwh: '0.32',
  feed_in_price_chf_per_kwh: '0.09',
  internal_energy_price_mode: 'absolute',
  internal_energy_price_chf_per_kwh: '0.20',
  internal_energy_price_pct_of_retail: '62.5',
  internal_grid_fee_chf_per_kwh: '0.03',
  annual_opex_chf: '300',
  capex_chf: '2000',
  horizon_years: '20',
  discount_rate_pct: '3',
}

// JS float arithmetic on arbitrary decimals (e.g. 0.35 * 45 / 100) routinely
// produces results like 0.15749999999999997 that need far more digits to
// round-trip than the value actually has. Sent through .toString() as-is,
// that blows past the backend DecimalField's max_digits and 400s. Round to
// the same decimal_places the target field expects before stringifying.
function toFixedString(value: number, decimalPlaces: number): string {
  return value.toFixed(decimalPlaces)
}

// Annual PV production can be entered directly (kWh) or derived from an
// installed capacity (kWp) times an assumed specific yield (kWh/kWp/year).
// Mirrors backend/feasibility/calculator.py's estimate_annual_production_kwh.
export function resolveAnnualProductionKwh(values: FeasibilityFormValues): number {
  if (values.annual_production_mode === 'from_kwp') {
    return Number(values.pv_kwp) * Number(values.specific_yield_kwh_per_kwp)
  }
  return Number(values.annual_production_kwh)
}

// The internal energy price can be set directly (CHF/kWh) or as a percentage
// of the retail price — e.g. "60% of Netzstrom". Resolves to the CHF/kWh
// value the backend actually expects, regardless of which mode is active.
export function resolveInternalEnergyPriceChf(values: FeasibilityFormValues): number {
  if (values.internal_energy_price_mode === 'percentage_of_retail') {
    return (Number(values.retail_price_chf_per_kwh) * Number(values.internal_energy_price_pct_of_retail)) / 100
  }
  return Number(values.internal_energy_price_chf_per_kwh)
}

export function mapFormValuesToPayload(values: FeasibilityFormValues): FeasibilityInput {
  return {
    // decimal_places below mirror each field's DecimalField in feasibility/serializers.py.
    annual_production_kwh: toFixedString(resolveAnnualProductionKwh(values), 4),
    annual_consumption_kwh: values.annual_consumption_kwh,
    self_consumption_rate: toFixedString(Number(values.self_consumption_rate_pct) / 100, 4),
    retail_price_chf_per_kwh: values.retail_price_chf_per_kwh,
    feed_in_price_chf_per_kwh: values.feed_in_price_chf_per_kwh,
    internal_energy_price_chf_per_kwh: toFixedString(resolveInternalEnergyPriceChf(values), 5),
    internal_grid_fee_chf_per_kwh: values.internal_grid_fee_chf_per_kwh,
    annual_opex_chf: values.annual_opex_chf,
    capex_chf: values.capex_chf,
    horizon_years: Number(values.horizon_years),
    discount_rate: toFixedString(Number(values.discount_rate_pct) / 100, 4),
  }
}
