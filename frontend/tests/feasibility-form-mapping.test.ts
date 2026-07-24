import { describe, expect, it } from 'vitest'
import {
  applyPrefillToFormValues,
  convertedInternalPriceForMode,
  defaultFeasibilityFormValues,
  mapFormValuesToPayload,
  resolveAnnualProductionKwh,
  resolveInternalEnergyPriceChf,
  resolveParticipantTotals,
  type FeasibilityFormValues,
} from '../src/features/feasibility/useFeasibilityForm'
import type { FeasibilityPrefill } from '../src/types/api'

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

  describe('convertedInternalPriceForMode', () => {
    it('converts an absolute price into the equivalent percentage of retail', () => {
      const values: FeasibilityFormValues = {
        ...defaultFeasibilityFormValues,
        retail_price_chf_per_kwh: '0.32',
        internal_energy_price_chf_per_kwh: '0.20',
      }
      // 0.20 / 0.32 = 62.5%
      expect(convertedInternalPriceForMode(values, 'percentage_of_retail')).toEqual({
        field: 'internal_energy_price_pct_of_retail',
        value: '62.5',
      })
    })

    it('converts a percentage of retail back into the equivalent absolute price', () => {
      const values: FeasibilityFormValues = {
        ...defaultFeasibilityFormValues,
        retail_price_chf_per_kwh: '0.32',
        internal_energy_price_pct_of_retail: '62.5',
      }
      // 0.32 * 62.5% = 0.20
      expect(convertedInternalPriceForMode(values, 'absolute')).toEqual({
        field: 'internal_energy_price_chf_per_kwh',
        value: '0.2',
      })
    })

    it('round-trips through the all-in retail without drifting', () => {
      const base: FeasibilityFormValues = {
        ...defaultFeasibilityFormValues,
        retail_price_chf_per_kwh: '0.348',
        internal_energy_price_chf_per_kwh: '0.18',
      }
      const toPct = convertedInternalPriceForMode(base, 'percentage_of_retail')!
      expect(toPct.value).toBe('51.7241')
      const backToAbs = convertedInternalPriceForMode(
        { ...base, internal_energy_price_pct_of_retail: toPct.value },
        'absolute',
      )!
      expect(backToAbs.value).toBe('0.18')
    })

    it('returns null when retail is not a positive number to convert against', () => {
      const values: FeasibilityFormValues = { ...defaultFeasibilityFormValues, retail_price_chf_per_kwh: '0' }
      expect(convertedInternalPriceForMode(values, 'percentage_of_retail')).toBeNull()
      expect(convertedInternalPriceForMode({ ...values, retail_price_chf_per_kwh: '' }, 'absolute')).toBeNull()
    })
  })

  describe('multi-participant mode', () => {
    const participantValues: FeasibilityFormValues = {
      ...defaultFeasibilityFormValues,
      energy_input_mode: 'participants',
      participants: [
        { name: 'Producer A', annual_production_kwh: '6000', annual_consumption_kwh: '0' },
        { name: 'Producer B', annual_production_kwh: '4000', annual_consumption_kwh: '0' },
        { name: 'Consumer C', annual_production_kwh: '0', annual_consumption_kwh: '5000' },
        { name: '', annual_production_kwh: '999', annual_consumption_kwh: '999' }, // mid-edit, no name yet
      ],
    }

    it('sums the named rows into the aggregate totals, dropping unnamed rows', () => {
      const totals = resolveParticipantTotals(participantValues)
      expect(totals.production).toBe(10000)
      expect(totals.consumption).toBe(5000)
    })

    it('sends the aggregate totals and only the named rows in the payload', () => {
      const payload = mapFormValuesToPayload(participantValues)
      expect(payload.annual_production_kwh).toBe('10000.0000')
      expect(payload.annual_consumption_kwh).toBe('5000.0000')
      expect(payload.participants).toEqual([
        { name: 'Producer A', annual_production_kwh: '6000.0000', annual_consumption_kwh: '0.0000' },
        { name: 'Producer B', annual_production_kwh: '4000.0000', annual_consumption_kwh: '0.0000' },
        { name: 'Consumer C', annual_production_kwh: '0.0000', annual_consumption_kwh: '5000.0000' },
      ])
    })

    it('falls back to the aggregate fields when no rows are named yet', () => {
      const payload = mapFormValuesToPayload({
        ...defaultFeasibilityFormValues,
        energy_input_mode: 'participants',
        participants: [{ name: '', annual_production_kwh: '999', annual_consumption_kwh: '999' }],
      })
      expect(payload.annual_production_kwh).toBe(
        resolveAnnualProductionKwh(defaultFeasibilityFormValues).toFixed(4),
      )
      expect(payload.participants).toEqual([])
    })

    it('ignores participant rows when energy_input_mode is aggregate', () => {
      const payload = mapFormValuesToPayload({ ...participantValues, energy_input_mode: 'aggregate' })
      expect(payload.participants).toEqual([])
      expect(payload.annual_production_kwh).toBe(resolveAnnualProductionKwh(defaultFeasibilityFormValues).toFixed(4))
    })
  })

  describe('applyPrefillToFormValues', () => {
    const prefill: FeasibilityPrefill = {
      participants: [
        { name: 'Alice', annual_production_kwh: '3200', annual_consumption_kwh: '4100', has_metering_data: true },
        { name: 'Bob', annual_production_kwh: '0', annual_consumption_kwh: '4500', has_metering_data: false },
      ],
      self_consumption_rate: '0.5833',
      retail_price_chf_per_kwh: '0.31000',
      feed_in_price_chf_per_kwh: null,
      internal_energy_price_chf_per_kwh: '0.18000',
    }

    it('switches to participant mode with one row per participant', () => {
      const result = applyPrefillToFormValues(prefill, defaultFeasibilityFormValues)
      expect(result.energy_input_mode).toBe('participants')
      expect(result.participants).toEqual([
        { name: 'Alice', annual_production_kwh: '3200', annual_consumption_kwh: '4100' },
        { name: 'Bob', annual_production_kwh: '0', annual_consumption_kwh: '4500' },
      ])
    })

    it('overrides only the prices the ZEV could actually determine', () => {
      const result = applyPrefillToFormValues(prefill, defaultFeasibilityFormValues)
      expect(result.retail_price_chf_per_kwh).toBe('0.31000')
      expect(result.internal_energy_price_chf_per_kwh).toBe('0.18000')
      // feed_in was null in the prefill -> untouched default survives.
      expect(result.feed_in_price_chf_per_kwh).toBe(defaultFeasibilityFormValues.feed_in_price_chf_per_kwh)
    })

    it('resets internal energy price mode to absolute so the prefilled CHF value is used as-is', () => {
      const result = applyPrefillToFormValues(prefill, {
        ...defaultFeasibilityFormValues,
        internal_energy_price_mode: 'percentage_of_retail',
      })
      expect(result.internal_energy_price_mode).toBe('absolute')
    })

    it('applies the measured self-consumption rate as a percentage', () => {
      const result = applyPrefillToFormValues(prefill, defaultFeasibilityFormValues)
      // 0.5833 ratio -> 58.33% (cleanly, without float artifacts).
      expect(result.self_consumption_rate_pct).toBe('58.33')
    })

    it('keeps the current self-consumption rate when the ZEV could not measure one', () => {
      const result = applyPrefillToFormValues(
        { ...prefill, self_consumption_rate: null },
        { ...defaultFeasibilityFormValues, self_consumption_rate_pct: '42' },
      )
      expect(result.self_consumption_rate_pct).toBe('42')
    })
  })
})
