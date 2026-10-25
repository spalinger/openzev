import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faTriangleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons'
import dayjs from 'dayjs'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormModalFooter } from '../../components/FormModalFooter'
import { Notice } from '../../components/Notice'
import { focusMissingBandTime, useFocusFirstField } from './useFocusFirstField'
import { CivilDateInput } from '../../components/CivilDateInput'
import { formatShortDate } from '../../lib/appSettings'
import { todayBusinessIso } from '../../lib/dates'
import type { AppSettings, TariffVersion, TariffVersionInput } from '../../types/api'
import type { VersionDialog } from './useTariffVersions'
import { TariffBandCoverage } from './TariffBandCoverage'
import { missingBandTimes, sameBands, type BandDraft } from './bandDrafts'
import { bandName } from './bands'
import { BandPriceField, BandTimeFields, BandRecurrenceFields } from './TariffBandFields'

type TariffVersionFormProps = {
  /** The task and the version it starts from. */
  dialog: NonNullable<VersionDialog>
  settings: AppSettings
  isPending: boolean
  /** Form-level error. */
  error?: string | null
  onCancel: () => void
  /** Reports unsaved changes. */
  onDirtyChange: (dirty: boolean) => void
  onSubmitNewVersion: (id: string, payload: TariffVersionInput) => void
  onSubmitDuplicate: (id: string, payload: TariffVersionInput & { name: string }) => void
  onSubmitRename: (id: string, name: string) => void
}

function draftsFrom(source: TariffVersion): BandDraft[] {
  // Preserve band labels and recurrence when copying.
  return source.periods.map((period) => ({
    period_type: period.period_type,
    label: period.label ?? '',
    price_chf_per_kwh: period.price_chf_per_kwh != null ? String(period.price_chf_per_kwh) : '',
    percentage: period.percentage != null ? String(period.percentage) : '',
    time_from: period.time_from ?? null,
    time_to: period.time_to ?? null,
    weekdays: period.weekdays ?? '',
    months: period.months ?? '',
  }))
}

function seedFor(dialog: NonNullable<VersionDialog>) {
  const { source, series, kind } = dialog
  return {
    validFrom: kind === 'rename' ? '' : kind === 'new-version' && dialog.validFrom ? dialog.validFrom : todayBusinessIso(),
    name: kind === 'duplicate' ? '' : series.name,
    fixedPrice: source.fixed_price_chf ? String(source.fixed_price_chf) : '',
    minimumPrice: source.minimum_price_chf_per_kwh ? String(source.minimum_price_chf_per_kwh) : '',
    periods: draftsFrom(source),
  }
}

/** Seed a new task from its source version; retain its bands and seasons. */
export function TariffVersionForm({
  dialog,
  settings,
  isPending,
  error = null,
  onCancel,
  onDirtyChange,
  onSubmitNewVersion,
  onSubmitDuplicate,
  onSubmitRename,
}: TariffVersionFormProps) {
  const { t } = useTranslation()
  const formId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstField(formRef, { field: dialog.kind === 'new-version' ? 'valid_from' : 'name' })
  const seed = useMemo(() => seedFor(dialog), [dialog])
  const [validFrom, setValidFrom] = useState(seed.validFrom)
  const [name, setName] = useState(seed.name)
  const [fixedPrice, setFixedPrice] = useState(seed.fixedPrice)
  const [minimumPrice, setMinimumPrice] = useState(seed.minimumPrice)
  const [periods, setPeriods] = useState<BandDraft[]>(seed.periods)
  const [showBandErrors, setShowBandErrors] = useState(false)

  const isDirty = validFrom !== seed.validFrom
    || name !== seed.name
    || fixedPrice !== seed.fixedPrice
    || minimumPrice !== seed.minimumPrice
    || !sameBands(periods, seed.periods)
  useEffect(() => { onDirtyChange(isDirty) }, [isDirty, onDirtyChange])

  const { kind, series, source } = dialog
  const isDynamic = Boolean(source.dynamic_source)
  // A percentage tariff carries the same kind of bands an energy tariff does
  // (§5.7) — it is never dynamic, so no `!isDynamic` guard is needed for it.
  const isPercentage = series.billing_mode === 'percentage_of_energy'
  const usesPeriods = (series.billing_mode === 'energy' && !isDynamic) || isPercentage
  const usesFixedPrice = !usesPeriods && !isDynamic
  const usesMinimumPrice = isDynamic && series.energy_type === 'feed_in'
  const hasIncompleteTimes = usesPeriods && periods.some(period => missingBandTimes(period).length > 0)

  function buildPayload(): TariffVersionInput {
    const payload: TariffVersionInput = { valid_from: validFrom }
    if (usesFixedPrice) payload.fixed_price_chf = fixedPrice || null
    if (usesMinimumPrice) payload.minimum_price_chf_per_kwh = minimumPrice || null
    if (usesPeriods) {
      payload.periods = periods.map((period) => ({
        period_type: period.period_type,
        label: period.label,
        price_chf_per_kwh: isPercentage ? null : period.price_chf_per_kwh,
        percentage: isPercentage ? period.percentage : null,
        time_from: period.time_from || null,
        time_to: period.time_to || null,
        weekdays: period.weekdays,
        months: period.months,
      }))
    }
    return payload
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (kind === 'rename') {
      onSubmitRename(source.id, name.trim())
      return
    }
    if (!validFrom) return
    if (hasIncompleteTimes) {
      setShowBandErrors(true)
      focusMissingBandTime(formRef.current, periods)
      return
    }
    if (kind === 'duplicate') {
      onSubmitDuplicate(source.id, { ...buildPayload(), name: name.trim() })
      return
    }
    onSubmitNewVersion(source.id, buildPayload())
  }

  const ordered = [...series.versions].sort((a, b) => a.valid_from.localeCompare(b.valid_from))
  const predecessor = ordered.filter((version) => version.valid_from < validFrom).at(-1)
  const successor = ordered.find((version) => version.valid_from > validFrom)
  const dayBefore = (date: string) => dayjs(date).subtract(1, 'day').format('YYYY-MM-DD')
  const closingDate = predecessor && validFrom
    ? predecessor.valid_to && predecessor.valid_to < validFrom ? predecessor.valid_to : dayBefore(validFrom)
    : null
  const endingDate = successor ? dayBefore(successor.valid_from) : null
  const duplicateEnd = source.valid_to && source.valid_to >= validFrom ? source.valid_to : null
  const submitDisabled = isPending
    || (kind === 'rename' && (!name.trim() || name.trim() === series.name))
    || (kind === 'duplicate' && (!name.trim() || !validFrom))
    || (kind === 'new-version' && !validFrom)

  const submitLabel = isPending
    ? t('common.saving')
    : kind === 'new-version'
      ? t('pages.tariffs.workspace.scheduleChange')
      : kind === 'duplicate'
        ? t('pages.tariffs.versions.duplicate')
        : t('common.save')

  return (
    <div className="tariff-pane-form">
      {error && <Notice tone="error">{error}</Notice>}
      <form ref={formRef} id={formId} onSubmit={submit} className="form-grid" aria-busy={isPending || undefined}>
        <fieldset className="tariff-pane-fieldset" disabled={isPending}>
        {kind === 'rename' && series.version_count > 1 && (
          <p className="muted grid-span-full m-0">
            {t('pages.tariffs.versions.renameHint', { count: series.version_count })}
          </p>
        )}
        {(kind === 'rename' || kind === 'duplicate') && (
          <label className="grid-span-full">
            <span>{t('pages.tariffs.form.name')}</span>
            <input name="name" value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
        )}

        {kind !== 'rename' && (
          <label data-focus-field="valid_from" className={kind === 'new-version' ? 'tariff-version-effective-date' : undefined}>
            <span>
              {kind === 'new-version'
                ? t('pages.tariffs.versions.effectiveFrom')
                : t('pages.tariffs.form.validFrom')}
            </span>
            <CivilDateInput
              value={validFrom || null}
              onChange={(iso) => setValidFrom(iso ?? '')}
              error={!validFrom ? t('pages.tariffs.form.errorRequired') : undefined}
              errorId={`${formId}-valid-from-error`}
            />
          </label>
        )}

        {kind === 'new-version' && validFrom && endingDate && (
          <div className="tariff-version-effective-date">
            <span>{t('pages.tariffs.form.validTo')}</span>
            <span className="tariff-readonly-value">{formatShortDate(endingDate, settings)}</span>
            <small className="muted">{t('pages.tariffs.workspace.endAutomatic')}</small>
          </div>
        )}

        {kind === 'duplicate' && validFrom && <div>
          <span>{t('pages.tariffs.form.validTo')}</span>
          <span className="tariff-readonly-value">{duplicateEnd ? formatShortDate(duplicateEnd, settings) : t('pages.tariffs.openEnded')}</span>
        </div>}

        {kind === 'new-version' && validFrom && closingDate && (
          <div className="tariff-change-preview">
            <p>{t('pages.tariffs.versions.closesPrevious', { date: formatShortDate(closingDate, settings) })}</p>
          </div>
        )}

        {kind !== 'rename' && usesFixedPrice && (
          <label>
            <span>{t('pages.tariffs.versions.amountChf')}</span>
            <input
              type="number"
              step="0.01"
              value={fixedPrice}
              onChange={(event) => setFixedPrice(event.target.value)}
              required
            />
          </label>
        )}

        {kind !== 'rename' && usesMinimumPrice && (
          <label>
            <span>{t('pages.tariffs.form.minimumPrice')}</span>
            <input
              type="number"
              step="0.00001"
              min="0"
              placeholder={t('pages.tariffs.form.minimumPricePlaceholder')}
              value={minimumPrice}
              onChange={(event) => setMinimumPrice(event.target.value)}
            />
            <small className="muted">{t('pages.tariffs.form.minimumPriceHint')}</small>
          </label>
        )}

        {kind !== 'rename' && usesPeriods && (
          <div className="grid-span-full">
            <strong>{t('pages.tariffs.versions.prices')}</strong>
            {periods.length === 0 ? (
              <p className="muted mt-05">
                <FontAwesomeIcon icon={faTriangleExclamation} fixedWidth />{' '}
                {t('pages.tariffs.versions.noPricesToCopy')}
              </p>
            ) : (
              <div className="tariff-version-price-list">
                {periods.map((period, index) => (
                  <fieldset key={`${period.period_type}-${index}`} className="tariff-band-draft tariff-version-band" data-band-index={index}>
                    <legend>{bandName(period, t(`pages.tariffs.periodTypes.${period.period_type}` as Parameters<typeof t>[0], {
                      defaultValue: period.period_type,
                    }))}</legend>
                    <BandPriceField className="grid-span-full" percentage={isPercentage}
                      value={isPercentage ? period.percentage : period.price_chf_per_kwh}
                      onChange={value => setPeriods(current => current.map((entry, position) => position === index
                        ? { ...entry, [isPercentage ? 'percentage' : 'price_chf_per_kwh']: value } : entry))} />
                    {period.period_type !== 'flat' && <BandTimeFields band={period} number={index + 1} disabled={isPending}
                      errors={Object.fromEntries(showBandErrors ? missingBandTimes(period).map(field => [field, t('pages.tariffs.form.errorRequired')]) : [])}
                      onChange={(field, value) => setPeriods(current => current.map((entry, position) => position === index ? { ...entry, [field]: value } : entry))} />}
                    <BandRecurrenceFields band={period}
                      onChange={(field, value) => setPeriods(current => current.map((entry, position) => position === index ? { ...entry, [field]: value } : entry))} />
                  </fieldset>
                ))}
              </div>
            )}
            <TariffBandCoverage bands={periods} validity={{ valid_from: validFrom, valid_to: kind === 'new-version' ? endingDate : duplicateEnd }} />
          </div>
        )}

        </fieldset>
      </form>
      <FormModalFooter
        formId={formId}
        onCancel={onCancel}
        isPending={isPending}
        disabled={submitDisabled}
        submitLabel={submitLabel}
        submitIcon={<FontAwesomeIcon icon={faCheck} fixedWidth />}
        cancelIcon={<FontAwesomeIcon icon={faXmark} fixedWidth />}
      />
    </div>
  )
}
