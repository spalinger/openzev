import { describe, expect, it } from 'vitest'
import {
  defaultFeasibilityFormValues,
  mapFormValuesToPayload,
  resolveAnnualProductionKwh,
  resolveInternalEnergyPriceChf,
  type FeasibilityFormValues,
} from '../src/features/feasibility/useFeasibilityForm'

describe('feasibility form mapping', () => {
  it('maps default form values into a payload matching the backend defaults', () => {
    const payload = mapFormValuesToPayload(defaultFeasibilityFormValues)

    expect(payload.annual_production_kwh).toBe('10000.0000')
    expect(payload.annual_consumption_kwh).toBe('8000')
    expect(payload.self_consumption_rate).toBe('0.5000')
    expect(payload.internal_energy_price_chf_per_kwh).toBe('0.20000')
    expect(payload.discount_rate).toBe('0.0300')
    expect(payload.horizon_years).toBe(20)
  })

  describe('regression: JS float arithmetic must not overflow DecimalField precision', () => {
    // 0.35 * 45 / 100 === 0.15749999999999997 in plain JS float math — 17
    // digits, which blew past the backend's max_digits=8 on
    // internal_energy_price_chf_per_kwh and 400'd with "Ensure that there
    // are no more than 8 digits in total."
    const values: FeasibilityFormValues = {
      ...defaultFeasibilityFormValues,
      internal_energy_price_mode: 'percentage_of_retail',
      retail_price_chf_per_kwh: '0.35',
      internal_energy_price_pct_of_retail: '45',
    }

    it('resolves to a float artifact internally', () => {
      // Documents *why* the fix is needed — this is the raw, unrounded value.
      expect(resolveInternalEnergyPriceChf(values)).toBe(0.15749999999999997)
    })

    it('but the payload sent to the API is rounded to the field\'s decimal_places', () => {
      const payload = mapFormValuesToPayload(values)
      expect(payload.internal_energy_price_chf_per_kwh).toBe('0.15750')
      // Never more than 8 total digits (max_digits=8) for this field.
      expect(payload.internal_energy_price_chf_per_kwh.replace(/[.-]/g, '').length).toBeLessThanOrEqual(8)
    })

    it('also rounds self_consumption_rate and discount_rate cleanly', () => {
      const payload = mapFormValuesToPayload({
        ...defaultFeasibilityFormValues,
        self_consumption_rate_pct: '33.333',
        discount_rate_pct: '3.7',
      })
      expect(payload.self_consumption_rate).toBe('0.3333')
      expect(payload.discount_rate).toBe('0.0370')
    })

    it('also rounds annual_production_kwh when derived from kWp x specific yield', () => {
      const payload = mapFormValuesToPayload({
        ...defaultFeasibilityFormValues,
        annual_production_mode: 'from_kwp',
        pv_kwp: '15.7',
        specific_yield_kwh_per_kwp: '1013',
      })
      // 15.7 * 1013 happens to be exact here, but the point is the string is
      // always fixed to 4 decimal places, never a raw float artifact.
      expect(payload.annual_production_kwh).toBe(resolveAnnualProductionKwh({
        ...defaultFeasibilityFormValues,
        annual_production_mode: 'from_kwp',
        pv_kwp: '15.7',
        specific_yield_kwh_per_kwp: '1013',
      }).toFixed(4))
    })
  })
})
