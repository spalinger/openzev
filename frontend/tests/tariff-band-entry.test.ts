import { describe, expect, it } from 'vitest'
import { bandCoverage, bandNeedingReview, bandPreset, emptyBand, presetDiscardsChanges, sameBands } from '../src/features/tariffs/bandDrafts'
import { dynamicChartData } from '../src/features/tariffs/DynamicPriceHistoryModal'

const allMonths = Array.from({ length: 12 }, (_, index) => index + 1)
const everyDay = [0, 1, 2, 3, 4, 5, 6]

describe('band schedule coverage', () => {
  it('checks only months and weekdays within a finite validity window', () => {
    const winter = [{ ...emptyBand(), months: '10,11,12' }]
    expect(bandCoverage(winter, { valid_from: '2026-10-01', valid_to: '2026-12-31' }).uncovered).toBe(false)
    expect(bandCoverage(winter, { valid_from: '2026-10-01', valid_to: null }).uncovered).toBe(true)
    const weekday = [{ ...emptyBand(), period_type: 'band' as const, time_from: '00:00', time_to: '00:00', weekdays: '0,1,2,3,4' }]
    expect(bandCoverage(weekday, { valid_from: '2026-10-26', valid_to: '2026-10-30' }).uncovered).toBe(false)
    expect(bandCoverage(weekday, { valid_from: '2026-10-26', valid_to: '2026-10-31' }).gaps).toEqual([
      { months: [10], weekdays: [5], start: 0, end: 86400 },
    ])
  })
  it('includes leap days and both ends of a year boundary', () => {
    expect(bandCoverage([], { valid_from: '2024-02-29', valid_to: '2024-02-29' }).gaps).toEqual([
      { months: [2], weekdays: [3], start: 0, end: 86400 },
    ])
    expect(bandCoverage([], { valid_from: '2026-12-31', valid_to: '2027-01-01' }).gaps).toEqual([
      { months: [1], weekdays: [4], start: 0, end: 86400 },
      { months: [12], weekdays: [3], start: 0, end: 86400 },
    ])
    expect(bandCoverage([], { valid_from: '2000-01-01', valid_to: '2999-12-31' })).toEqual(bandCoverage([]))
  })
  it('requires confirmation only when a preset replaces configured values', () => {
    const priced = [{ ...emptyBand(), price_chf_per_kwh: '0.25' }]
    expect(presetDiscardsChanges(priced, bandPreset('htnt', priced))).toBe(false)
    const configured = bandPreset('htnt', priced)
    expect(presetDiscardsChanges(configured, bandPreset('htnt', configured))).toBe(false)
    expect(presetDiscardsChanges(configured, bandPreset('flat', configured))).toBe(true)
    configured[0].weekdays = '0,1,2,3,4'
    expect(presetDiscardsChanges(configured, bandPreset('htnt', configured))).toBe(true)
    expect(presetDiscardsChanges([{ ...priced[0], label: 'Custom name' }], priced)).toBe(true)
  })
  it('targets an incomplete band first, otherwise the actual gap fallback', () => {
    const bands = bandPreset('htnt', [])
    expect(bandNeedingReview(bands)).toBeUndefined()
    bands[1].time_from = '22:00'
    expect(bandNeedingReview(bands)).toBe(bands[0])
    bands[1].time_from = null
    expect(bandNeedingReview(bands)).toBe(bands[1])
  })
  it('covers midnight and every weekday with the HT/NT preset', () => {
    expect(bandCoverage(bandPreset('htnt', []))).toEqual({ uncovered: false, overlaps: false, fallbacks: [], gaps: [] })
  })
  it('does not infer complementary hours for a missing NT window', () => {
    const bands = bandPreset('htnt', [])
    bands[1].time_from = null
    expect(bandCoverage(bands).uncovered).toBe(true)
  })
  it('checks weekends and months instead of just a representative day', () => {
    const bands = bandPreset('htnt', [])
    bands[0].weekdays = '0,1,2,3,4'
    expect(bandCoverage(bands).uncovered).toBe(true)
    expect(bandCoverage([{ ...emptyBand(), months: '1,2,3' }]).uncovered).toBe(true)
  })
  it('names the actual HT fallback for a gap between complete HT/NT windows', () => {
    const bands = bandPreset('htnt', [])
    bands[1].time_from = '22:00'
    expect(bandCoverage([...bands].reverse())).toEqual({
      uncovered: true, overlaps: false,
      fallbacks: [{ band: bands[0], months: allMonths }],
      gaps: [{ months: allMonths, weekdays: everyDay, start: 21 * 3600, end: 22 * 3600 }],
    })
  })
  it('reports each seasonal fallback, including months with no seasonal band', () => {
    const winter = { ...emptyBand(), period_type: 'high' as const, months: '1,2,3', time_from: '07:00', time_to: '21:00' }
    const summer = { ...winter, months: '4,5,6,7,8,9' }
    expect(bandCoverage([winter, summer]).fallbacks).toEqual([
      { band: winter, months: [1, 2, 3, 10, 11, 12] },
      { band: summer, months: [4, 5, 6, 7, 8, 9] },
    ])
  })
  it('matches start-time and id ordering for unnamed bands with equal starts', () => {
    const late = { ...emptyBand(), period_type: 'band' as const, id: 'c', time_from: '12:00', time_to: '18:00' }
    const early = { ...late, id: 'a', time_from: '07:00', time_to: '12:00' }
    expect(bandCoverage([late, { ...early, id: 'b' }, early]).fallbacks[0].band).toBe(early)
  })
  it('has no fallback band to name for a tariff with no prices', () => {
    expect(bandCoverage([])).toEqual({ uncovered: true, overlaps: false, fallbacks: [], gaps: [{ months: allMonths, weekdays: everyDay, start: 0, end: 86400 }] })
  })
  it('flat bands ignore weekday and time restrictions, as in the engine', () => {
    expect(bandCoverage([{ ...emptyBand(), weekdays: '0' }])).toEqual({ uncovered: false, overlaps: false, fallbacks: [], gaps: [] })
  })
  it('identifies overlaps and respects half-open boundaries', () => {
    const bands = bandPreset('htnt', [])
    bands[0].time_to = '22:00'
    expect(bandCoverage(bands)).toEqual({ uncovered: false, overlaps: true, fallbacks: [], gaps: [] })
    bands[0].time_to = '21:00'
    expect(bandCoverage(bands).overlaps).toBe(false)
  })
  it('handles a full-day wrapping band and disjoint seasons', () => {
    expect(bandCoverage([{ ...emptyBand(), period_type: 'band', time_from: '00:00', time_to: '00:00' }]).uncovered).toBe(false)
    expect(bandCoverage([{ ...emptyBand(), months: '1,2,3,10,11,12' }, { ...emptyBand(), months: '4,5,6,7,8,9' }])).toEqual({ uncovered: false, overlaps: false, fallbacks: [], gaps: [] })
  })
  it('identifies the uncovered weekend hours without including covered nights', () => {
    const bands = bandPreset('htnt', [])
    bands[0].weekdays = '0,1,2,3,4'
    expect(bandCoverage(bands).gaps).toEqual([
      { months: allMonths, weekdays: [5, 6], start: 7 * 3600, end: 21 * 3600 },
    ])
  })
  it('keeps the two missing night ranges distinct at midnight, including second boundaries', () => {
    const band = { ...emptyBand(), period_type: 'high' as const, time_from: '07:00:30', time_to: '21:00' }
    expect(bandCoverage([band]).gaps).toEqual([
      { months: allMonths, weekdays: everyDay, start: 0, end: 7 * 3600 + 30 },
      { months: allMonths, weekdays: everyDay, start: 21 * 3600, end: 86400 },
    ])
  })
  it('merges a fully uncovered season across irrelevant time boundaries', () => {
    const band = { ...emptyBand(), period_type: 'band' as const, months: '1,2,3', time_from: '07:00', time_to: '21:00' }
    expect(bandCoverage([band]).gaps).toEqual([
      { months: [1, 2, 3], weekdays: everyDay, start: 0, end: 7 * 3600 },
      { months: [1, 2, 3], weekdays: everyDay, start: 21 * 3600, end: 86400 },
      { months: [4, 5, 6, 7, 8, 9, 10, 11, 12], weekdays: everyDay, start: 0, end: 86400 },
    ])
  })
  it('compares editable fields without depending on object property order', () => {
    expect(sameBands([emptyBand()], [{ ...emptyBand(), price_chf_per_kwh: '0.25' }])).toBe(false)
    expect(sameBands([emptyBand()], [{ ...emptyBand() }])).toBe(true)
  })
})

it('breaks dynamic chart lines across missing prices and clips stored intervals to the requested window', () => {
  const points = [{ valid_from: '2026-01-01T00:00:00Z', valid_to: '2026-01-03T00:00:00Z', price_chf_per_kwh: '0.20' },
    { valid_from: '2026-01-04T00:00:00Z', valid_to: '2026-01-06T00:00:00Z', price_chf_per_kwh: '-0.10' }]
  const start = Date.parse('2026-01-02T00:00:00Z'), end = Date.parse('2026-01-05T00:00:00Z')
  const data = dynamicChartData(points, [{ from: '2026-01-03T00:00:00Z', to: '2026-01-04T00:00:00Z' }], start, end)
  expect(data[0]).toEqual({ timestamp: start, price: 0.2 })
  expect(data.at(-1)).toEqual({ timestamp: end - 1, price: -0.1 })
  expect(data.filter(point => point.price === null)).toHaveLength(2)
})
