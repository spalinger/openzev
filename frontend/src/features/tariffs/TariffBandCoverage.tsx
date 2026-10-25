import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import type { TariffPeriodInput } from '../../types/api'
import { MONTH_KEYS, WEEKDAY_KEYS, formatSeason, formatWeekdays } from './recurrence'
import { bandCoverage, type BandValidity } from './bandDrafts'
import { bandName, bandWindow } from './bands'
import { kwhPrice } from './rateLines'

export function TariffBandCoverage({ bands, validity, warningsOnly = false }: {
  bands: Array<Omit<TariffPeriodInput, 'tariff'> & { id?: string }>
  validity?: BandValidity
  warningsOnly?: boolean
}) {
  const { t } = useTranslation()
  const { uncovered, overlaps, fallbacks, gaps } = bandCoverage(bands, validity)
  if (warningsOnly && !uncovered && !overlaps) return null
  const monthNames = MONTH_KEYS.map(key => t(`pages.tariffs.monthsShort.${key}`))
  const dayNames = WEEKDAY_KEYS.map(key => t(`pages.tariffs.weekdaysShort.${key}`))
  const formatTime = (seconds: number) => {
    const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60]
    if (seconds % 60) parts.push(seconds % 60)
    return parts.map(part => String(part).padStart(2, '0')).join(':')
  }
  function formatGaps(months?: number[]) {
    const schedules = new Map<string, string[]>()
    for (const gap of gaps) {
      const matchingMonths = gap.months.filter(month => !months || months.includes(month))
      if (matchingMonths.length === 0) continue
      const schedule = [
        formatSeason(matchingMonths.join(','), monthNames) || t('pages.tariffs.bandEntry.everyMonth'),
        formatWeekdays(gap.weekdays.join(','), dayNames) || t('pages.tariffs.bandEntry.everyDay'),
      ].join(' · ')
      schedules.set(schedule, [...(schedules.get(schedule) ?? []), `${formatTime(gap.start)}–${formatTime(gap.end)}`])
    }
    return [...schedules].map(([schedule, times]) => `${schedule} · ${times.join(', ')}`).join('; ')
  }
  return <div className="tariff-band-coverage grid-span-full" role="status">
    {uncovered || overlaps ? <div className="tariff-band-warning">
      <FontAwesomeIcon icon={faCircleExclamation} fixedWidth aria-hidden="true" />
      <div>
        {uncovered && fallbacks.length === 0 && <p>{t('pages.tariffs.bandEntry.uncovered', { schedule: formatGaps() })}</p>}
        {fallbacks.map(({ band, months }, index) => {
          const name = bandName(band, t(`pages.tariffs.periodTypes.${band.period_type}`))
          const window = bandWindow(band)
          const price = band.percentage != null && band.percentage !== ''
            ? t('pages.tariffs.rateCard.percentOf', { percentage: Number(band.percentage) })
            : band.price_chf_per_kwh ? `${kwhPrice.format(Number(band.price_chf_per_kwh))} ${t('pages.tariffs.chfPerKwh')}` : '—'
          return <p key={index}>{t('pages.tariffs.bandEntry.fallback', {
            schedule: formatGaps(months),
            band: [name, name !== window && window].filter(Boolean).join(' '),
            price,
          })}</p>
        })}
        {overlaps && <p>{t('pages.tariffs.bandEntry.overlaps')}</p>}
      </div>
    </div> : <p>{t('pages.tariffs.bandEntry.covered')}</p>}
  </div>
}
