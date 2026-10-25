import { useId, type Ref } from 'react'
import { TimePicker } from '@mantine/dates'
import { useTranslation } from 'react-i18next'
import type { BandDraft } from './bandDrafts'
import { RecurrenceChips } from './RecurrenceChips'
import { MONTH_KEYS, WEEKDAY_KEYS } from './recurrence'

export function BandPriceField({ value, onChange, percentage = false, error, onBlur, inputRef, className }: {
  value: string
  onChange: (value: string) => void
  percentage?: boolean
  error?: string
  onBlur?: () => void
  inputRef?: Ref<HTMLInputElement>
  className?: string
}) {
  const { t } = useTranslation()
  const id = useId()
  return <label className={className}>
    <span>{t(percentage ? 'pages.tariffs.form.percentage' : 'pages.tariffs.form.pricePerKwh')}</span>
    <input ref={inputRef} className="tariff-band-price-input" name={percentage ? 'percentage' : 'price_chf_per_kwh'}
      type="number" step={percentage ? '0.01' : '0.00001'} min={percentage ? 0 : undefined} required
      value={value} onChange={event => onChange(event.target.value)} onBlur={onBlur}
      aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-error` : undefined} />
    {error && <small id={`${id}-error`} className="field-error" role="alert">{error}</small>}
  </label>
}

type TimeField = 'time_from' | 'time_to'

export function BandTimeFields({ band, onChange, errors, disabled, number, onBlur, inputRefs }: {
  band: Pick<BandDraft, 'time_from' | 'time_to'>
  onChange: (field: TimeField, value: string | null) => void
  errors?: Partial<Record<TimeField, string>>
  disabled?: boolean
  number?: number
  onBlur?: (field: TimeField) => void
  inputRefs?: Partial<Record<TimeField, Ref<HTMLInputElement>>>
}) {
  const { t } = useTranslation()
  const id = useId()
  return <div className="tariff-time-row">
    {(['time_from', 'time_to'] as const).map(field => {
      const label = t(field === 'time_from' ? 'pages.tariffs.form.timeFrom' : 'pages.tariffs.form.timeTo')
      const context = number ? `${t('pages.tariffs.bandEntry.band', { number })} ${label}` : label
      const inputId = `${id}-${field}`
      const errorProps = { 'aria-invalid': !!errors?.[field] || undefined, 'aria-describedby': errors?.[field] ? `${inputId}-error` : undefined }
      return <div key={field} data-band-time={field} data-focus-field={field}>
        <TimePicker id={inputId} name={field} label={label} format="24h" value={band[field] || ''} disabled={disabled} required
          onChange={value => onChange(field, value || null)} onBlur={() => onBlur?.(field)} hoursRef={inputRefs?.[field]}
          error={errors?.[field]} hoursInputProps={errorProps} minutesInputProps={errorProps}
          hoursInputLabel={`${context}: ${t('pages.tariffs.form.hours')}`}
          minutesInputLabel={`${context}: ${t('pages.tariffs.form.minutes')}`}
          clearable clearButtonProps={{ 'aria-label': t('pages.tariffs.form.clearTime') }} />
      </div>
    })}
  </div>
}

export function BandRecurrenceFields({ band, onChange }: {
  band: Pick<BandDraft, 'period_type' | 'weekdays' | 'months'>
  onChange: (field: 'weekdays' | 'months', value: string) => void
}) {
  const { t } = useTranslation()
  const days = WEEKDAY_KEYS.map(key => t(`pages.tariffs.weekdaysShort.${key}`))
  const months = MONTH_KEYS.map(key => t(`pages.tariffs.monthsShort.${key}`))
  return <div className="tariff-band-recurrence grid-span-full">
    {band.period_type !== 'flat' && <RecurrenceChips label={t('pages.tariffs.form.weekdays')} hint={t('pages.tariffs.form.weekdaysHint')} value={band.weekdays}
      onChange={value => onChange('weekdays', value)} options={days.map((label, value) => ({ label, value }))} columns={7} />}
    <RecurrenceChips label={t('pages.tariffs.form.months')} hint={t('pages.tariffs.form.monthsHint')} value={band.months}
      onChange={value => onChange('months', value)} options={months.map((label, value) => ({ label, value: value + 1 }))} columns={6} />
  </div>
}
