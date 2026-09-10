import { describe, expect, it } from 'vitest'
import { formatChf, formatKwh, formatNumber, formatPercent } from '../src/lib/numbers'

describe('formatNumber', () => {
  it('formats without thousands grouping', () => {
    expect(formatNumber(1234.5)).toBe('1234.5')
    expect(formatNumber(1000000)).toBe('1000000')
  })

  it('rounds to maxDecimals', () => {
    expect(formatNumber(1.23456, { maxDecimals: 2 })).toBe('1.23')
    expect(formatNumber(1.235, { maxDecimals: 2 })).toBe('1.24')
  })

  it('pads to minDecimals', () => {
    expect(formatNumber(12.5, { maxDecimals: 2, minDecimals: 2 })).toBe('12.50')
  })

  it('clamps maximumFractionDigits so minDecimals alone never throws', () => {
    // minimumFractionDigits > maximumFractionDigits is a RangeError in
    // Intl.NumberFormat; the helper must keep the pair valid.
    expect(formatNumber(12.5, { minDecimals: 3 })).toBe('12.500')
    expect(formatNumber(12.5, { minDecimals: 3, maxDecimals: 1 })).toBe('12.500')
  })
})

describe('formatKwh', () => {
  it('caps at one decimal by default', () => {
    expect(formatKwh(1234.56)).toBe('1234.6')
    expect(formatKwh(0.25)).toBe('0.3')
  })

  it('honours an explicit maxDecimals', () => {
    expect(formatKwh(2.345, { maxDecimals: 2 })).toBe('2.35')
  })

  it('uses a placeholder for non-finite values', () => {
    expect(formatKwh(NaN)).toBe('–')
    expect(formatKwh(Infinity)).toBe('–')
    expect(formatKwh(-Infinity)).toBe('–')
  })
})

describe('formatChf', () => {
  it('formats with two decimals', () => {
    expect(formatChf(1234.5)).toBe('CHF 1234.50')
  })

  it('uses the typographic minus sign for negative amounts', () => {
    expect(formatChf(-12.5)).toBe('CHF \u221212.50')
  })

  it('clamps values that round to zero to CHF 0.00, never a signed zero', () => {
    expect(formatChf(0)).toBe('CHF 0.00')
    expect(formatChf(-0.004)).toBe('CHF 0.00')
    expect(formatChf(0.0049)).toBe('CHF 0.00')
  })

  it('rounds at the 0.005 boundary', () => {
    expect(formatChf(0.005)).toBe('CHF 0.01')
    expect(formatChf(-0.005)).toBe('CHF \u22120.01')
  })

  it('returns CHF 0.00 for non-finite values', () => {
    expect(formatChf(NaN)).toBe('CHF 0.00')
    expect(formatChf(Infinity)).toBe('CHF 0.00')
    expect(formatChf(-Infinity)).toBe('CHF 0.00')
  })
})

describe('formatPercent', () => {
  it('renders a percentage with up to one decimal by default', () => {
    expect(formatPercent(45.25)).toBe('45.3\u00a0%')
    expect(formatPercent(100)).toBe('100\u00a0%')
  })

  it('honours an explicit maxDecimals', () => {
    expect(formatPercent(12.345, { maxDecimals: 0 })).toBe('12\u00a0%')
  })

  it('handles zero, negative, and non-finite values', () => {
    expect(formatPercent(0)).toBe('0\u00a0%')
    expect(formatPercent(-12.34)).toBe('-12.3\u00a0%')
    expect(formatPercent(NaN)).toBe('–')
    expect(formatPercent(Infinity)).toBe('–')
  })
})
