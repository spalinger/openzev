import { useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons'
import { TimePicker } from '@mantine/dates'
import { useTranslation } from 'react-i18next'
import type { TariffPeriodInput } from '../../types/api'
import { RecurrenceChips } from './RecurrenceChips'
import { MONTH_KEYS, WEEKDAY_KEYS, formatSeason, formatWeekdays } from './recurrence'
import { bandCoverage, bandPreset, emptyBand, type BandDraft } from './bandDrafts'
import { bandName, bandWindow } from './bands'
import { kwhPrice } from './rateLines'

export function TariffBandCoverage({ bands, warningsOnly = false }: {
  bands: Array<Omit<TariffPeriodInput, 'tariff'> & { id?: string }>
  warningsOnly?: boolean
}) {
  const { t } = useTranslation()
  const { uncovered, overlaps, fallbacks } = bandCoverage(bands)
  if (warningsOnly && !uncovered) return null
  const monthNames = MONTH_KEYS.map(key => t(`pages.tariffs.monthsShort.${key}`))
  return <div className="tariff-band-coverage grid-span-full" role="status">
    {uncovered || overlaps ? <div className="tariff-band-warning">
      <FontAwesomeIcon icon={faCircleExclamation} fixedWidth aria-hidden="true" />
      <div>
        {uncovered && !warningsOnly && <p>{t('pages.tariffs.bandEntry.uncovered')}</p>}
        {fallbacks.map(({ band, months }, index) => {
          const name = bandName(band, t(`pages.tariffs.periodTypes.${band.period_type}`))
          const window = bandWindow(band)
          const price = band.percentage != null && band.percentage !== ''
            ? t('pages.tariffs.rateCard.percentOf', { percentage: Number(band.percentage) })
            : band.price_chf_per_kwh ? `${kwhPrice.format(Number(band.price_chf_per_kwh))} ${t('pages.tariffs.chfPerKwh')}` : '—'
          return <p key={index}>{t('pages.tariffs.bandEntry.fallback', {
            months: formatSeason(months.join(','), monthNames) || t('pages.tariffs.bandEntry.everyMonth'),
            band: [name, name !== window && window].filter(Boolean).join(' '),
            price,
          })}</p>
        })}
        {overlaps && <p>{t('pages.tariffs.bandEntry.overlaps')}</p>}
      </div>
    </div> : <p>{t('pages.tariffs.bandEntry.covered')}</p>}
  </div>
}

export function TariffBandEditor({ value, onChange, disabled = false }: {
  value: BandDraft[]
  onChange: (bands: BandDraft[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [preset, setPreset] = useState(value.length === 1 && value[0].period_type === 'flat' ? 'flat' : 'custom')
  const focusAddedBand = useRef(false)
  const addButton = useRef<HTMLButtonElement>(null)
  const dayNames = WEEKDAY_KEYS.map(key => t(`pages.tariffs.weekdaysShort.${key}`))
  const monthNames = MONTH_KEYS.map(key => t(`pages.tariffs.monthsShort.${key}`))
  function update(index: number, patch: Partial<BandDraft>) {
    if (['period_type', 'time_from', 'time_to', 'weekdays', 'months'].some(field => field in patch)) setPreset('custom')
    onChange(value.map((band, position) => position === index ? { ...band, ...patch } : band))
  }
  return <div className="tariff-band-editor grid-span-full">
    <label>
      <span>{t('pages.tariffs.bandEntry.structure')}</span>
      <select value={preset} disabled={disabled} onChange={event => {
        const next = event.target.value
        setPreset(next)
        if (next === 'flat' || next === 'htnt') onChange(bandPreset(next, value))
      }}>
        <option value="flat">{t('pages.tariffs.bandEntry.flat')}</option>
        <option value="htnt">{t('pages.tariffs.bandEntry.htnt')}</option>
        <option value="custom">{t('pages.tariffs.bandEntry.custom')}</option>
      </select>
      {preset === 'htnt' && <small className="muted">{t('pages.tariffs.bandEntry.presetHint')}</small>}
    </label>
    {value.map((band, index) => <fieldset key={index} className="tariff-band-draft" disabled={disabled}>
      <legend>{t('pages.tariffs.bandEntry.band', { number: index + 1 })}</legend>
      <label>
        <span>{t('pages.tariffs.form.periodType')}</span>
        <select value={band.period_type} ref={index === value.length - 1 ? node => {
          if (node && focusAddedBand.current) { focusAddedBand.current = false; node.focus() }
        } : undefined} onChange={event => update(index, { period_type: event.target.value as BandDraft['period_type'] })}>
          {(['flat', 'high', 'low', 'band'] as const).map(type => <option key={type} value={type}>{t(`pages.tariffs.periodTypes.${type}`)}</option>)}
        </select>
      </label>
      <label>
        <span>{t('pages.tariffs.form.pricePerKwh')}</span>
        <input className="tariff-band-price-input" type="number" step="0.00001" required
          value={band.price_chf_per_kwh}
          onChange={event => update(index, { price_chf_per_kwh: event.target.value })} />
      </label>
      {band.period_type === 'band' && <label className="grid-span-full"><span>{t('pages.tariffs.form.bandLabel')}</span>
        <input value={band.label} onChange={event => update(index, { label: event.target.value })} />
      </label>}
      {band.period_type !== 'flat' && <div className="tariff-time-row">
        {(['time_from', 'time_to'] as const).map(field => {
          const label = t(field === 'time_from' ? 'pages.tariffs.form.timeFrom' : 'pages.tariffs.form.timeTo')
          return <TimePicker key={field} label={label} format="24h" value={band[field] || ''} disabled={disabled} required
            onChange={next => update(index, { [field]: next || null })}
            hoursInputLabel={`${t('pages.tariffs.bandEntry.band', { number: index + 1 })} ${label}: ${t('pages.tariffs.form.hours')}`}
            minutesInputLabel={`${t('pages.tariffs.bandEntry.band', { number: index + 1 })} ${label}: ${t('pages.tariffs.form.minutes')}`} />
        })}
      </div>}
      <details className="tariff-band-recurrence grid-span-full">
        <summary>{t('pages.tariffs.bandEntry.recurrence')}{' · '}{[
          band.period_type !== 'flat' && formatWeekdays(band.weekdays, dayNames) || t('pages.tariffs.bandEntry.everyDay'),
          formatSeason(band.months, monthNames) || t('pages.tariffs.bandEntry.everyMonth'),
        ].join(' · ')}</summary>
        {band.period_type !== 'flat' && <RecurrenceChips label={t('pages.tariffs.form.weekdays')} hint={t('pages.tariffs.form.weekdaysHint')} value={band.weekdays}
          onChange={weekdays => update(index, { weekdays })} options={dayNames.map((label, value) => ({ label, value }))} columns={7} />}
        <RecurrenceChips label={t('pages.tariffs.form.months')} hint={t('pages.tariffs.form.monthsHint')} value={band.months}
          onChange={months => update(index, { months })} options={monthNames.map((label, value) => ({ label, value: value + 1 }))} columns={6} />
      </details>
      {value.length > 1 && <button type="button" className="button button-secondary button-compact" aria-label={t('pages.tariffs.bandEntry.remove', { number: index + 1 })}
        onClick={() => { setPreset('custom'); onChange(value.filter((_, position) => position !== index)); addButton.current?.focus() }}>{t('pages.tariffs.bandEntry.removeButton')}</button>}
    </fieldset>)}
    <button ref={addButton} type="button" className="button button-secondary button-compact" disabled={disabled} onClick={() => {
      setPreset('custom')
      focusAddedBand.current = true
      onChange([...value, { ...emptyBand(), period_type: 'band' }])
    }}>{t('pages.tariffs.addPeriod')}</button>
    <TariffBandCoverage bands={value} />
  </div>
}
