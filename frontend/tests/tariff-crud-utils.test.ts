import { describe, expect, it } from 'vitest'
import { resolvePeriodModalTariffId } from '../src/features/tariffs/useTariffCrud'
import type { Tariff } from '../src/types/api'

describe('resolvePeriodModalTariffId', () => {
  it('returns explicitly provided tariff id', () => {
    const energyTariffs = [{ id: 'energy-1' } as unknown as Tariff]

    expect(resolvePeriodModalTariffId(energyTariffs, 'manual-1')).toBe('manual-1')
  })

  it('returns first energy tariff id when no explicit id is given', () => {
    const energyTariffs = [{ id: 'energy-1' } as unknown as Tariff, { id: 'energy-2' } as unknown as Tariff]

    expect(resolvePeriodModalTariffId(energyTariffs)).toBe('energy-1')
  })

  it('returns undefined when no energy tariff exists', () => {
    expect(resolvePeriodModalTariffId([])).toBeUndefined()
  })
})
