import { describe, expect, it } from 'vitest'
import {
  endOfBillingPeriod,
  shiftBillingPeriod,
  startOfBillingPeriod,
  toIsoDate,
} from '../src/features/invoices/invoicePeriodUtils'

describe('invoice period utilities', () => {
  it('formats date as iso', () => {
    expect(toIsoDate(new Date(2026, 4, 8))).toBe('2026-05-08')
  })

  it('computes start of period for each billing interval', () => {
    const date = new Date(2026, 4, 15)

    expect(toIsoDate(startOfBillingPeriod(date, 'monthly'))).toBe('2026-05-01')
    expect(toIsoDate(startOfBillingPeriod(date, 'quarterly'))).toBe('2026-04-01')
    expect(toIsoDate(startOfBillingPeriod(date, 'semi_annual'))).toBe('2026-01-01')
    expect(toIsoDate(startOfBillingPeriod(date, 'annual'))).toBe('2026-01-01')
  })

  it('computes end of period for each billing interval', () => {
    expect(toIsoDate(endOfBillingPeriod(new Date(2026, 4, 1), 'monthly'))).toBe('2026-05-31')
    expect(toIsoDate(endOfBillingPeriod(new Date(2026, 3, 1), 'quarterly'))).toBe('2026-06-30')
    expect(toIsoDate(endOfBillingPeriod(new Date(2026, 0, 1), 'semi_annual'))).toBe('2026-06-30')
    expect(toIsoDate(endOfBillingPeriod(new Date(2026, 0, 1), 'annual'))).toBe('2026-12-31')
  })

  it('shifts period backward and forward', () => {
    expect(shiftBillingPeriod('2026-05-01', 'monthly', -1)).toEqual({
      period_start: '2026-04-01',
      period_end: '2026-04-30',
    })

    expect(shiftBillingPeriod('2026-04-01', 'quarterly', 1)).toEqual({
      period_start: '2026-07-01',
      period_end: '2026-09-30',
    })
  })
})
