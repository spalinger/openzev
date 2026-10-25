import type { TariffPeriodInput } from '../../types/api'

export type BandDraft = {
  period_type: TariffPeriodInput['period_type']
  label: string
  price_chf_per_kwh: string
  percentage: string
  time_from: string | null
  time_to: string | null
  weekdays: string
  months: string
}

export function missingBandTimes(band: Pick<BandDraft, 'period_type' | 'time_from' | 'time_to'>) {
  return (['time_from', 'time_to'] as const).filter(field => band.period_type !== 'flat' && !band[field]?.trim())
}

export const emptyBand = (): BandDraft => ({ period_type: 'flat', label: '', price_chf_per_kwh: '', percentage: '', time_from: null, time_to: null, weekdays: '', months: '' })
export function bandPreset(kind: 'flat' | 'htnt', current: BandDraft[]): BandDraft[] {
  const first = { ...emptyBand(), price_chf_per_kwh: current[0]?.price_chf_per_kwh ?? '', percentage: current[0]?.percentage ?? '' }
  return kind === 'flat' ? [first] : [
    { ...first, period_type: 'high', time_from: '07:00', time_to: '21:00' },
    { ...emptyBand(), period_type: 'low', time_from: '21:00', time_to: '07:00', price_chf_per_kwh: current[1]?.price_chf_per_kwh ?? '', percentage: current[1]?.percentage ?? '' },
  ]
}

const fields = ['period_type', 'label', 'price_chf_per_kwh', 'percentage', 'time_from', 'time_to', 'weekdays', 'months'] as const
export function sameBands(a: BandDraft[], b: BandDraft[]) {
  return a.length === b.length && a.every((band, index) => fields.every(field => band[field] === b[index][field]))
}

export type CoverageGap = { months: number[], weekdays: number[], start: number, end: number }

type ScheduledBand = Pick<TariffPeriodInput, 'period_type' | 'time_from' | 'time_to' | 'weekdays' | 'months'> & { id?: string }

/** Explicit schedule coverage; uncovered time still uses the engine's fallback. */
export function bandCoverage<T extends ScheduledBand>(bands: T[]) {
  const seconds = (value: string | null | undefined) => value ? value.split(':').reduce((total, part, index) => total + Number(part) * [3600, 60, 1][index], 0) : null
  // Match TariffPeriod's type/start/id ordering, including unsaved editor rows.
  const windows = bands.map(band => ({ band, start: seconds(band.time_from), end: seconds(band.time_to) }))
    .sort((a, b) => a.band.period_type.localeCompare(b.band.period_type) || (a.start ?? -1) - (b.start ?? -1) || (a.band.id ?? '').localeCompare(b.band.id ?? ''))
  const boundaries = [...new Set([0, 86400, ...windows.flatMap(band => [band.start, band.end].filter((value): value is number => value !== null))])].sort((a, b) => a - b)
  const includes = (mask: string | undefined, value: number) => !mask || mask.split(',').map(Number).includes(value)
  let uncovered = false
  let overlaps = false
  const fallbacks: { band: T, months: number[] }[] = []
  const gaps: CoverageGap[] = []
  for (let month = 1; month <= 12; month++) {
    const inSeason = windows.filter(({ band }) => includes(band.months, month))
    let monthUncovered = false
    const monthGaps: Omit<CoverageGap, 'months'>[] = []
    for (let i = 0; i < boundaries.length - 1; i++) {
      const time = boundaries[i]
      const weekdays: number[] = []
      for (let day = 0; day < 7; day++) {
        const count = inSeason.filter(({ band, start, end }) => band.period_type === 'flat' || (
          includes(band.weekdays, day) && start !== null && end !== null && (
            start < end ? time >= start && time < end : time >= start || time < end
          )
        )).length
        if (count === 0) weekdays.push(day)
        overlaps ||= count > 1
      }
      if (weekdays.length === 0) continue
      monthUncovered = true
      uncovered = true
      const previous = monthGaps.at(-1)
      if (previous?.end === time && previous.weekdays.join() === weekdays.join()) previous.end = boundaries[i + 1]
      else monthGaps.push({ weekdays, start: time, end: boundaries[i + 1] })
    }
    for (const gap of monthGaps) {
      const existing = gaps.find(entry => entry.start === gap.start && entry.end === gap.end && entry.weekdays.join() === gap.weekdays.join())
      if (existing) existing.months.push(month)
      else gaps.push({ ...gap, months: [month] })
    }
    const fallback = (inSeason[0] ?? windows[0])?.band
    if (monthUncovered && fallback) {
      const existing = fallbacks.find(entry => entry.band === fallback)
      if (existing) existing.months.push(month)
      else fallbacks.push({ band: fallback, months: [month] })
    }
  }
  return { uncovered, overlaps, fallbacks, gaps }
}

export function bandNeedingReview<T extends ScheduledBand>(bands: T[]): T | undefined {
  return bands.find(band => band.period_type !== 'flat' && (!band.time_from || !band.time_to))
    ?? bandCoverage(bands).fallbacks[0]?.band
}
