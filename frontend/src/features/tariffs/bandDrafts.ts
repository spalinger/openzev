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

/** Explicit schedule coverage; uncovered time still uses the engine's fallback. */
export function bandCoverage<T extends Pick<TariffPeriodInput, 'period_type' | 'time_from' | 'time_to' | 'weekdays' | 'months'> & { id?: string }>(bands: T[]) {
  const seconds = (value: string | null | undefined) => value ? value.split(':').reduce((total, part, index) => total + Number(part) * [3600, 60, 1][index], 0) : null
  // Match TariffPeriod's type/start/id ordering, including unsaved editor rows.
  const windows = bands.map(band => ({ band, start: seconds(band.time_from), end: seconds(band.time_to) }))
    .sort((a, b) => a.band.period_type.localeCompare(b.band.period_type) || (a.start ?? -1) - (b.start ?? -1) || (a.band.id ?? '').localeCompare(b.band.id ?? ''))
  const boundaries = [...new Set([0, 86400, ...windows.flatMap(band => [band.start, band.end].filter((value): value is number => value !== null))])].sort((a, b) => a - b)
  const includes = (mask: string | undefined, value: number) => !mask || mask.split(',').map(Number).includes(value)
  let uncovered = false
  let overlaps = false
  const fallbacks: { band: T, months: number[] }[] = []
  for (let month = 1; month <= 12; month++) {
    const inSeason = windows.filter(({ band }) => includes(band.months, month))
    let monthUncovered = false
    for (let day = 0; day < 7; day++) {
      for (let i = 0; i < boundaries.length - 1; i++) {
        const time = boundaries[i]
        const count = inSeason.filter(({ band, start, end }) => band.period_type === 'flat' || (
          includes(band.weekdays, day) && start !== null && end !== null && (
            start < end ? time >= start && time < end : time >= start || time < end
          )
        )).length
        uncovered ||= count === 0
        monthUncovered ||= count === 0
        overlaps ||= count > 1
      }
    }
    const fallback = (inSeason[0] ?? windows[0])?.band
    if (monthUncovered && fallback) {
      const existing = fallbacks.find(entry => entry.band === fallback)
      if (existing) existing.months.push(month)
      else fallbacks.push({ band: fallback, months: [month] })
    }
  }
  return { uncovered, overlaps, fallbacks }
}
