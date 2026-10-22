import { describe, expect, it } from 'vitest'
import { bandCoverage, bandPreset, emptyBand, sameBands } from '../src/features/tariffs/bandDrafts'
import { dynamicChartData } from '../src/features/tariffs/DynamicPriceHistoryModal'

describe('band schedule coverage', () => {
  it('covers midnight and every weekday with the HT/NT preset', () => {
    expect(bandCoverage(bandPreset('htnt', []))).toEqual({ uncovered: false, overlaps: false, fallbacks: [] })
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
      fallbacks: [{ band: bands[0], months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }],
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
    expect(bandCoverage([])).toEqual({ uncovered: true, overlaps: false, fallbacks: [] })
  })
  it('flat bands ignore weekday and time restrictions, as in the engine', () => {
    expect(bandCoverage([{ ...emptyBand(), weekdays: '0' }])).toEqual({ uncovered: false, overlaps: false, fallbacks: [] })
  })
  it('identifies overlaps and respects half-open boundaries', () => {
    const bands = bandPreset('htnt', [])
    bands[0].time_to = '22:00'
    expect(bandCoverage(bands)).toEqual({ uncovered: false, overlaps: true, fallbacks: [] })
    bands[0].time_to = '21:00'
    expect(bandCoverage(bands).overlaps).toBe(false)
  })
  it('handles a full-day wrapping band and disjoint seasons', () => {
    expect(bandCoverage([{ ...emptyBand(), period_type: 'band', time_from: '00:00', time_to: '00:00' }]).uncovered).toBe(false)
    expect(bandCoverage([{ ...emptyBand(), months: '1,2,3,10,11,12' }, { ...emptyBand(), months: '4,5,6,7,8,9' }])).toEqual({ uncovered: false, overlaps: false, fallbacks: [] })
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
