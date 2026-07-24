import { z } from 'zod'
import type { FeasibilityInput } from '../../types/api'

export type FeasibilityFormValues = {
  annual_production_kwh: string
  annual_consumption_kwh: string
  self_consumption_rate_pct: string
  retail_price_chf_per_kwh: string
  feed_in_price_chf_per_kwh: string
  internal_energy_price_chf_per_kwh: string
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
  annual_production_kwh: z.string().refine(isNonNegativeNumber),
  annual_consumption_kwh: z.string().refine(isNonNegativeNumber),
  self_consumption_rate_pct: z.string().refine(isPercentage),
  retail_price_chf_per_kwh: z.string().refine(isNonNegativeNumber),
  feed_in_price_chf_per_kwh: z.string().refine(isNonNegativeNumber),
  internal_energy_price_chf_per_kwh: z.string().refine(isNonNegativeNumber),
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
  annual_production_kwh: '10000',
  annual_consumption_kwh: '8000',
  self_consumption_rate_pct: '50',
  retail_price_chf_per_kwh: '0.32',
  feed_in_price_chf_per_kwh: '0.09',
  internal_energy_price_chf_per_kwh: '0.20',
  internal_grid_fee_chf_per_kwh: '0.03',
  annual_opex_chf: '300',
  capex_chf: '2000',
  horizon_years: '20',
  discount_rate_pct: '3',
}

export function mapFormValuesToPayload(values: FeasibilityFormValues): FeasibilityInput {
  return {
    annual_production_kwh: values.annual_production_kwh,
    annual_consumption_kwh: values.annual_consumption_kwh,
    self_consumption_rate: (Number(values.self_consumption_rate_pct) / 100).toString(),
    retail_price_chf_per_kwh: values.retail_price_chf_per_kwh,
    feed_in_price_chf_per_kwh: values.feed_in_price_chf_per_kwh,
    internal_energy_price_chf_per_kwh: values.internal_energy_price_chf_per_kwh,
    internal_grid_fee_chf_per_kwh: values.internal_grid_fee_chf_per_kwh,
    annual_opex_chf: values.annual_opex_chf,
    capex_chf: values.capex_chf,
    horizon_years: Number(values.horizon_years),
    discount_rate: (Number(values.discount_rate_pct) / 100).toString(),
  }
}
