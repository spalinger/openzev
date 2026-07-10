import { describe, expect, it } from 'vitest'
import { isBillingAlignedPeriod } from '../src/lib/billingPeriod'

/**
 * The period selector disables its prev/next arrows when the active range is not
 * exactly one billing period, so this predicate decides whether navigation is offered.
 */
describe('isBillingAlignedPeriod', () => {
  it('accepts a range spanning exactly one billing period', () => {
    expect(isBillingAlignedPeriod('2026-05-01', '2026-05-31', 'monthly')).toBe(true)
    expect(isBillingAlignedPeriod('2026-04-01', '2026-06-30', 'quarterly')).toBe(true)
    expect(isBillingAlignedPeriod('2026-07-01', '2026-12-31', 'semi_annual')).toBe(true)
    expect(isBillingAlignedPeriod('2026-01-01', '2026-12-31', 'annual')).toBe(true)
  })

  it('rejects a range that stops short of the period end', () => {
    expect(isBillingAlignedPeriod('2026-05-01', '2026-05-30', 'monthly')).toBe(false)
  })

  it('rejects a range that starts after the period start', () => {
    expect(isBillingAlignedPeriod('2026-05-02', '2026-05-31', 'monthly')).toBe(false)
  })

  it('rejects a whole month when the interval is quarterly', () => {
    expect(isBillingAlignedPeriod('2026-05-01', '2026-05-31', 'quarterly')).toBe(false)
  })

  it('handles a leap-year February', () => {
    expect(isBillingAlignedPeriod('2024-02-01', '2024-02-29', 'monthly')).toBe(true)
    expect(isBillingAlignedPeriod('2024-02-01', '2024-02-28', 'monthly')).toBe(false)
  })

  it('rejects an empty range', () => {
    expect(isBillingAlignedPeriod('', '', 'monthly')).toBe(false)
    expect(isBillingAlignedPeriod('2026-05-01', '', 'monthly')).toBe(false)
  })
})
