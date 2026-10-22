import { describe, expect, it } from 'vitest'
import { resolvePeriodTariffId } from '../src/features/tariffs/useTariffCrud'
import { formatTariffError } from '../src/features/tariffs/errors'
import type { Tariff } from '../src/types/api'

describe('tariff errors', () => {
  it.each(['1,2,3', '1,2,3,4,5,6,7,8,9,10,11,12'])('translates a flat/timed conflict for months %s', months => {
    const error = { isAxiosError: true, response: { data: {
      period_type: [`A flat band and a timed band cannot both apply in months ${months}: the flat price is used for every hour, so the timed bands would never apply. Give them different months, or make them all timed.`],
    } } }
    expect(formatTariffError(error, 'fallback', key => `translated:${key}`))
      .toBe('translated:pages.tariffs.form.errorFlatTimed')
  })

  it('preserves other server errors and the fallback for errors without a response', () => {
    expect(formatTariffError({ isAxiosError: true, response: { data: { period_type: ['Another conflict'] } } }, 'fallback', key => key))
      .toBe('period_type: Another conflict')
    expect(formatTariffError(new Error('offline'), 'fallback', key => key)).toBe('fallback')
  })
})

describe('resolvePeriodTariffId', () => {
  it('returns explicitly provided tariff id', () => {
    const energyTariffs = [{ id: 'energy-1' } as unknown as Tariff]

    expect(resolvePeriodTariffId(energyTariffs, 'manual-1')).toBe('manual-1')
  })

  it('returns first energy tariff id when no explicit id is given', () => {
    const energyTariffs = [{ id: 'energy-1' } as unknown as Tariff, { id: 'energy-2' } as unknown as Tariff]

    expect(resolvePeriodTariffId(energyTariffs)).toBe('energy-1')
  })

  it('returns undefined when no energy tariff exists', () => {
    expect(resolvePeriodTariffId([])).toBeUndefined()
  })
})
