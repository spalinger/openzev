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

export function missingBandTimes(band: { period_type: BandDraft['period_type'], time_from?: string | null, time_to?: string | null }) {
  return (['time_from', 'time_to'] as const).filter(field => band.period_type !== 'flat' && !band[field]?.trim())
}

export const emptyBand = (): BandDraft => ({ period_type: 'flat', label: '', price_chf_per_kwh: '', percentage: '', time_from: null, time_to: null, weekdays: '', months: '' })
export function bandPreset(kind: 'flat' | 'htnt', current: BandDraft[]): BandDraft[] {
  const source = current.find(band => band.period_type === (kind === 'flat' ? 'flat' : 'high')) ?? current[0]
  const low = current.find(band => band.period_type === 'low') ?? current[1]
  const first = { ...emptyBand(), price_chf_per_kwh: source?.price_chf_per_kwh ?? '', percentage: source?.percentage ?? '' }
  return kind === 'flat' ? [first] : [
    { ...first, period_type: 'high', time_from: '07:00', time_to: '21:00' },
    { ...emptyBand(), period_type: 'low', time_from: '21:00', time_to: '07:00', price_chf_per_kwh: low?.price_chf_per_kwh ?? '', percentage: low?.percentage ?? '' },
  ]
}

const fields = ['period_type', 'label', 'price_chf_per_kwh', 'percentage', 'time_from', 'time_to', 'weekdays', 'months'] as const
export function presetDiscardsChanges(current: BandDraft[], next: BandDraft[]) {
  const empty = emptyBand()
  return current.some((band, index) => fields.some(field => band[field] !== empty[field] && band[field] !== next[index]?.[field]))
}
export function sameBands(a: BandDraft[], b: BandDraft[]) {
  return a.length === b.length && a.every((band, index) => fields.every(field => band[field] === b[index][field]))
}

export type CoverageGap = { months: number[], weekdays: number[], start: number, end: number }
export type BandValidity = { valid_from?: string, valid_to?: string | null }

type ScheduledBand = Pick<TariffPeriodInput, 'period_type' | 'time_from' | 'time_to' | 'weekdays' | 'months'> & { id?: string }

/** Explicit schedule coverage; uncovered time still uses the engine's fallback. */
export function bandCoverage<T extends ScheduledBand>(bands: T[], validity?: BandValidity) {
  let applicableDays: Set<number> | undefined
  if (validity?.valid_from && validity.valid_to) {
    const date = new Date(`${validity.valid_from}T12:00:00Z`)
    const end = new Date(`${validity.valid_to}T12:00:00Z`)
    if (Number.isFinite(date.getTime()) && Number.isFinite(end.getTime())) {
      applicableDays = new Set()
      // Month/weekday pairs repeat; stop once the whole annual schedule is represented.
      for (; date <= end && applicableDays.size < 84; date.setUTCDate(date.getUTCDate() + 1)) {
        applicableDays.add(date.getUTCMonth() * 7 + (date.getUTCDay() + 6) % 7)
      }
    }
  }
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
        if (applicableDays && !applicableDays.has((month - 1) * 7 + day)) continue
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

export function bandNeedingReview<T extends ScheduledBand>(bands: T[], validity?: BandValidity): T | undefined {
  const { gaps, fallbacks } = bandCoverage(bands, validity)
  return bands.find(band => band.period_type !== 'flat' && (!band.time_from || !band.time_to)
    && gaps.some(gap => gap.months.some(month => !band.months || band.months.split(',').map(Number).includes(month))))
    ?? fallbacks[0]?.band
}
