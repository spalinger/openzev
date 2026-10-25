import { zodResolver } from '@hookform/resolvers/zod'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faPlus, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useQuery } from '@tanstack/react-query'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Textarea } from '@mantine/core'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormModalFooter } from '../../components/FormModalFooter'
import { CivilDateInput } from '../../components/CivilDateInput'
import { fetchDynamicTariffSources } from '../../lib/api/tariffs'
import { queryKeys } from '../../lib/api/queryKeys'
import type { TariffBillingMode, TariffInput, TariffVersion } from '../../types/api'
import { dynamicSourceOptions, impliedEnergyType } from './dynamicSources'
import { DynamicSourceForm } from './DynamicSourceFormModal'
import { Notice } from '../../components/Notice'
import { focusMissingBandTime, useFocusFirstField, type FormFocus } from './useFocusFirstField'
import { TariffBandEditor } from './TariffBandEditor'
import { emptyBand, sameBands, type BandDraft } from './bandDrafts'
import {
  defaultTariffFormValues,
  mapTariffFormValuesToInput,
  mapTariffToFormValues,
  tariffFormSchema,
  type TariffFormValues,
} from './useTariffForms'

/** Label for the fixed-price field, per billing mode that has one. */
const FIXED_PRICE_LABELS: Partial<Record<TariffBillingMode, string>> = {
  monthly_fee: 'pages.tariffs.form.monthlyFee',
  yearly_fee: 'pages.tariffs.form.yearlyFee',
  per_metering_point_monthly_fee: 'pages.tariffs.form.mpMonthlyFee',
  per_metering_point_yearly_fee: 'pages.tariffs.form.mpYearlyFee',
  shared_monthly_fee: 'pages.tariffs.form.sharedMonthlyFee',
  shared_yearly_fee: 'pages.tariffs.form.sharedYearlyFee',
}

const SHARED_FEE_MODES: TariffBillingMode[] = ['shared_monthly_fee', 'shared_yearly_fee']

type TariffFormProps = {
  initialFocus?: FormFocus
  initialTariff?: TariffVersion
  selectedZevId: string
  isPending?: boolean
  /** Form-level error. */
  error?: string | null
  onSubmit: (payload: TariffInput) => void
  onCancel: () => void
  /** Reports unsaved changes. */
  onDirtyChange: (dirty: boolean) => void
  onSourcePendingChange?: (pending: boolean) => void
}

/**
 * Create a tariff, or edit one version of it, in the detail pane. Creating a
 * dynamic source happens in a section of this form, not a dialog over it.
 */
export function TariffForm({
  initialFocus,
  initialTariff,
  selectedZevId,
  isPending = false,
  error = null,
  onSubmit,
  onCancel,
  onDirtyChange,
  onSourcePendingChange,
}: TariffFormProps) {
  const { t } = useTranslation()
  const formId = useId()
  const [showSourceSection, setShowSourceSection] = useState(false)
  const [sourceDirty, setSourceDirty] = useState(false)
  const [initialBands, setInitialBands] = useState<BandDraft[]>([emptyBand()])
  const [showBandErrors, setShowBandErrors] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const sourceButtonRef = useRef<HTMLButtonElement>(null)
  useFocusFirstField(formRef, initialFocus)

  useEffect(() => {
    if (!showSourceSection) return
    const sourceButton = sourceButtonRef.current
    return () => sourceButton?.focus()
  }, [showSourceSection])

  const form = useForm<TariffFormValues>({
    resolver: zodResolver(tariffFormSchema),
    // Seeded once, when the form opens: a refetch of the list behind it must
    // not overwrite what is being typed.
    defaultValues: initialTariff ? mapTariffToFormValues(initialTariff) : defaultTariffFormValues,
  })

  const billingMode = useWatch({
    control: form.control,
    name: 'billing_mode',
  })
  const validFrom = useWatch({ control: form.control, name: 'valid_from' })
  const validTo = useWatch({ control: form.control, name: 'valid_to' })
  const isSharedFee = SHARED_FEE_MODES.includes(billingMode)
  const splitKey = useWatch({
    control: form.control,
    name: 'split_key',
  })
  const dynamicSourceId = useWatch({
    control: form.control,
    name: 'dynamic_source',
  })
  const energyType = useWatch({
    control: form.control,
    name: 'energy_type',
  })
  // An existing version keeps the identity fields shared by its tariff series.
  const isVersion = Boolean(initialTariff)
  // Versions with bands cannot link a dynamic source.
  const hasExistingPeriods = (initialTariff?.periods.length ?? 0) > 0

  // Preload source choices before the energy picker mounts.
  const sourcesQuery = useQuery({
    queryKey: queryKeys.tariffs.dynamicSources(),
    queryFn: fetchDynamicTariffSources,
    staleTime: 5 * 60 * 1000,
  })
  const sourcesData = sourcesQuery.data
  const availableSources = dynamicSourceOptions(sourcesData ?? [], isVersion ? initialTariff?.energy_type : undefined)
  const selectedSourceAggregatedTypes = useMemo(() => {
    const source = sourcesData?.find((candidate) => candidate.id === dynamicSourceId)
    return source?.aggregated_tariff_types ?? []
  }, [sourcesData, dynamicSourceId])

  const isDirty = form.formState.isDirty || (showSourceSection && sourceDirty)
    || (!isVersion && billingMode === 'energy' && !dynamicSourceId && !sameBands(initialBands, [emptyBand()]))
  useEffect(() => { onDirtyChange(isDirty) }, [isDirty, onDirtyChange])

  const errors = form.formState.errors
  const errorText = (field: keyof TariffFormValues) => errors[field]
    ? t(errors[field]?.message === 'number' ? 'pages.tariffs.form.errorNumber' : 'pages.tariffs.form.errorRequired')
    : undefined
  const errorId = (field: keyof TariffFormValues) => `${formId}-${field}-error`
  const fieldError = (field: keyof TariffFormValues) => errors[field]
    ? <small id={errorId(field)} className="field-error" role="alert">{errorText(field)}</small>
    : null
  const errorProps = (field: keyof TariffFormValues) => ({
    'aria-invalid': !!errors[field] || undefined,
    'aria-describedby': errors[field] ? errorId(field) : undefined,
  })

  // A new tariff takes its energy type from the selected source.
  useEffect(() => {
    if (isVersion || !dynamicSourceId || !sourcesData) return
    const source = sourcesData.find((candidate) => candidate.id === dynamicSourceId)
    if (source) {
      const energyType = impliedEnergyType(source)
      if (energyType) form.setValue('energy_type', energyType, { shouldValidate: true })
    }
  }, [dynamicSourceId, isVersion, sourcesData, form])

  function submit(values: TariffFormValues) {
    const payload = mapTariffFormValuesToInput(values, selectedZevId)
    // A concurrent rename must not be undone by the mount-time form seed.
    if (initialTariff) payload.name = initialTariff.name
    else if (values.billing_mode === 'energy' && !values.dynamic_source) {
      if (focusMissingBandTime(formRef.current, initialBands)) {
        setShowBandErrors(true)
        return
      }
      payload.initial_periods = initialBands.map(band => ({ ...band, percentage: null }))
    }
    onSubmit(payload)
  }

  const selectedSource = sourcesData?.find((source) => source.id === dynamicSourceId)
  const sourceEnergyType = selectedSource && impliedEnergyType(selectedSource)
  const energyTypeHintId = `${formId}-energy-type-hint`
  const energyTypeField = !isVersion && (
    <label>
      <span>{t('pages.tariffs.form.energyType')}</span>
      {billingMode === 'energy' && sourceEnergyType ? (
        <span className="tariff-readonly-value">{t(`pages.tariffs.energyTypes.${sourceEnergyType}`)}</span>
      ) : (
        <select {...form.register('energy_type')} aria-describedby={energyTypeHintId}>
          <option value="local">{t('pages.tariffs.energyTypes.local')}</option>
          <option value="grid">{t('pages.tariffs.energyTypes.grid')}</option>
          <option value="feed_in">{t('pages.tariffs.energyTypes.feed_in')}</option>
        </select>
      )}
      <small id={energyTypeHintId} className="muted">
        {t(`pages.tariffs.form.energyTypeHints.${billingMode === 'energy' && sourceEnergyType ? sourceEnergyType : energyType}`)}
      </small>
    </label>
  )

  const validityFields = (
        <div className="tariff-validity-fields">
          <label data-focus-field="valid_from">
            <span>{t('pages.tariffs.form.validFrom')}</span>
            <Controller
              control={form.control}
              name="valid_from"
              render={({ field }) => (
                <CivilDateInput
                  error={errorText(field.name)}
                  errorId={errorId(field.name)}
                  value={field.value || null}
                  onChange={(iso) => field.onChange(iso ?? '')}
                />
              )}
            />
          </label>
          <label data-focus-field="valid_to">
            <span>{t('pages.tariffs.form.validTo')}</span>
            <Controller
              control={form.control}
              name="valid_to"
              render={({ field }) => (
                <CivilDateInput
                  error={errorText(field.name)}
                  errorId={errorId(field.name)}
                  value={field.value || null}
                  onChange={(iso) => field.onChange(iso ?? '')}
                />
              )}
            />
          </label>
        </div>
  )

  const notesField = <Textarea
          className="tariff-notes-field"
          label={t('pages.tariffs.form.notes')}
          minRows={isVersion ? 5 : 2}
          maxRows={12}
          autosize
          {...form.register('notes')}
        />

  return (
    <div className="tariff-pane-form">
      {isVersion && <p className="muted">{t('pages.tariffs.workspace.correctionHint')}</p>}
      {error && !showSourceSection && <Notice tone="error">{error}</Notice>}
      {Object.keys(errors).some(key => !['name', 'minimum_price_chf_per_kwh', 'initial_percentage', 'fixed_price_chf', 'valid_from', 'valid_to'].includes(key)) && <Notice tone="error">{t('pages.tariffs.form.errorRequired')}</Notice>}
      <form ref={formRef} id={formId} onSubmit={event => void form.handleSubmit(submit)(event)} className="form-grid tariff-configuration-form" data-creation={!isVersion} hidden={showSourceSection} aria-busy={isPending || undefined}>
        <fieldset className="tariff-pane-fieldset" disabled={isPending}>
        {isVersion && validityFields}
        {!isVersion && (
          <>
            <label>
              <span>{t('pages.tariffs.form.name')}</span>
              <input {...form.register('name')} {...errorProps('name')} required />
              {fieldError('name')}
            </label>
            <label>
              <span>{t('pages.tariffs.form.category')}</span>
              <select {...form.register('category')}>
                <option value="energy">{t('pages.tariffs.categories.energy')}</option>
                <option value="grid_fees">{t('pages.tariffs.categories.grid_fees')}</option>
                <option value="levies">{t('pages.tariffs.categories.levies')}</option>
                <option value="metering">{t('pages.tariffs.categories.metering')}</option>
              </select>
            </label>
            <label>
              <span>{t('pages.tariffs.form.billingMode')}</span>
              <select {...form.register('billing_mode')}>
                <option value="energy">{t('pages.tariffs.billingModes.energy')}</option>
                <option value="percentage_of_energy">{t('pages.tariffs.billingModes.percentage_of_energy')}</option>
                <option value="monthly_fee">{t('pages.tariffs.billingModes.monthly_fee')}</option>
                <option value="yearly_fee">{t('pages.tariffs.billingModes.yearly_fee')}</option>
                <option value="per_metering_point_monthly_fee">{t('pages.tariffs.billingModes.per_metering_point_monthly_fee')}</option>
                <option value="per_metering_point_yearly_fee">{t('pages.tariffs.billingModes.per_metering_point_yearly_fee')}</option>
                <option value="shared_monthly_fee">{t('pages.tariffs.billingModes.shared_monthly_fee')}</option>
                <option value="shared_yearly_fee">{t('pages.tariffs.billingModes.shared_yearly_fee')}</option>
              </select>
            </label>
          </>
        )}

        {/* Only a plain energy tariff can be dynamic — a percentage-of-energy
            or fixed-fee tariff has nothing a fetched series could price. */}
        {billingMode === 'energy' && !hasExistingPeriods && (
          <div className="grid-span-full tariff-source-choice">
            <label>
              <span>{t('pages.tariffs.form.dynamicSource')}</span>
              <select {...form.register('dynamic_source')} value={dynamicSourceId} disabled={sourcesQuery.isLoading}>
                <option value="">{t('pages.tariffs.form.dynamicSourceNone')}</option>
                {availableSources.map((source) => (
                  <option key={source.id} value={source.id}>{source.label}</option>
                ))}
              </select>
              <small className="muted">
                {dynamicSourceId
                    ? t('pages.tariffs.form.dynamicSourceHintActive')
                    : t('pages.tariffs.form.dynamicSourceHint')}
              </small>
            </label>
            {energyTypeField}
            {energyType === 'feed_in' && dynamicSourceId && (
              <label>
                <span>{t('pages.tariffs.form.minimumPrice')}</span>
                <input
                  type="number"
                  step="0.00001"
                  min="0"
                  placeholder={t('pages.tariffs.form.minimumPricePlaceholder')}
                  {...form.register('minimum_price_chf_per_kwh')} {...errorProps('minimum_price_chf_per_kwh')}
                />
                <small className="muted">{t('pages.tariffs.form.minimumPriceHint')}</small>
                {fieldError('minimum_price_chf_per_kwh')}
              </label>
            )}
            {dynamicSourceId && <p className="muted tariff-form-hint">{t('pages.tariffs.form.sharedSourceHint')}</p>}
            {selectedSourceAggregatedTypes.length > 0 && (
              <div className="warning-banner">
                {t('pages.dynamicSources.form.doubleCountingWarning', {
                  components: selectedSourceAggregatedTypes
                    .map((type) => t(`pages.dynamicSources.types.${type}` as Parameters<typeof t>[0]))
                    .join(', '),
                })}
              </div>
            )}
            {!isVersion && (
              <div>
                <button
                  className="button button-secondary button-compact"
                  type="button"
                  ref={sourceButtonRef}
                  onClick={() => setShowSourceSection(true)}
                >
                  <FontAwesomeIcon icon={faPlus} fixedWidth />
                  {t('pages.tariffs.form.createDynamicSource')}
                </button>
              </div>
            )}
          </div>
        )}

        {billingMode === 'percentage_of_energy' && energyTypeField}
        {!isVersion && billingMode === 'energy' && !dynamicSourceId && (
          <TariffBandEditor value={initialBands} onChange={setInitialBands} disabled={isPending} showErrors={showBandErrors} validity={{ valid_from: validFrom, valid_to: validTo }} />
        )}
        {billingMode === 'percentage_of_energy' ? (
          // Editing a version already has bands to manage in the pane, so
          // the field is create-only (§5.7) — it just seeds the first one.
          !isVersion && (
            <label>
              <span>{t('pages.tariffs.form.initialPercentage')}</span>
              <input type="number" step="0.01" min="0" {...form.register('initial_percentage')} {...errorProps('initial_percentage')} required />
              <small className="muted">{t('pages.tariffs.form.initialPercentageHint')}</small>
              {fieldError('initial_percentage')}
            </label>
          )
        ) : billingMode !== 'energy' ? (
          <label>
            <span>{t(FIXED_PRICE_LABELS[billingMode] ?? 'pages.tariffs.form.monthlyFee')}</span>
            <input type="number" step="0.01" {...form.register('fixed_price_chf')} {...errorProps('fixed_price_chf')} required />
            {fieldError('fixed_price_chf')}
          </label>
        ) : null}

        {isSharedFee && (
          <label>
            <span>{t('pages.tariffs.form.splitKey')}</span>
            <select {...form.register('split_key')}>
              <option value="equal">{t('pages.tariffs.form.splitKeyEqual')}</option>
              <option value="weight">{t('pages.tariffs.form.splitKeyWeight')}</option>
            </select>
            <small className="muted">
              {t(splitKey === 'weight' ? 'pages.tariffs.form.sharedFeeHintWeight' : 'pages.tariffs.form.sharedFeeHint')}
            </small>
          </label>
        )}

        {!isVersion && validityFields}
        {notesField}
        {isVersion && <div className="tariff-version-identity grid-span-full">
          <p className="muted tariff-form-hint">{t(`pages.tariffs.categories.${initialTariff!.category}` as Parameters<typeof t>[0])}
            {' · '}{t(`pages.tariffs.billingModes.${initialTariff!.billing_mode}` as Parameters<typeof t>[0])}
            {initialTariff?.energy_type && ` · ${t(`pages.tariffs.energyTypes.${initialTariff.energy_type}` as Parameters<typeof t>[0])}`}</p>
          <p className="muted tariff-form-hint">{t('pages.tariffs.form.identityLockedHint')}</p>
        </div>}

        </fieldset>
      </form>
      {showSourceSection && (
        <section className="tariff-pane-section" aria-labelledby={`${formId}-source`}>
          <h3 id={`${formId}-source`}>{t('pages.dynamicSources.createTitle')}</h3>
          <DynamicSourceForm
            onClose={() => setShowSourceSection(false)}
            onDirtyChange={setSourceDirty}
            onPendingChange={onSourcePendingChange}
            onSaved={(source) => {
              form.setValue('dynamic_source', source.id, { shouldValidate: true, shouldDirty: true })
              const energyType = impliedEnergyType(source)
              if (energyType) form.setValue('energy_type', energyType, { shouldValidate: true })
            }}
          />
        </section>
      )}
      {!showSourceSection && <FormModalFooter
        formId={formId}
        onCancel={onCancel}
        isPending={isPending}
        submitLabel={isPending ? t('common.saving') : initialTariff ? t('pages.tariffs.workspace.saveCorrection') : t('pages.tariffs.createTariff')}
        submitIcon={<FontAwesomeIcon icon={faCheck} fixedWidth />}
        cancelIcon={<FontAwesomeIcon icon={faXmark} fixedWidth />}
      />}
    </div>
  )
}
