import { zodResolver } from '@hookform/resolvers/zod'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useEffect, useId, useRef } from 'react'
import { useController, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Notice } from '../../components/Notice'
import { useFocusFirstField, type FormFocus } from './useFocusFirstField'
import { BandPriceField, BandTimeFields, BandRecurrenceFields } from './TariffBandFields'
import { FormModalFooter } from '../../components/FormModalFooter'
import { TariffBandCoverage } from './TariffBandCoverage'
import type { Tariff, TariffPeriod, TariffPeriodInput } from '../../types/api'
import {
  defaultTariffPeriodFormValues,
  mapTariffPeriodFormValuesToInput,
  mapTariffPeriodToFormValues,
  tariffPeriodFormSchema,
  type TariffPeriodFormValues,
} from './useTariffForms'

type TariffPeriodFormProps = {
  initialFocus?: FormFocus
  onSubmit: (payload: TariffPeriodInput) => void
  onCancel: () => void
  /** Whether anything was changed, for the pane's unsaved-input guard. */
  onDirtyChange: (dirty: boolean) => void
  initialPeriod?: TariffPeriod
  /** The version the band belongs to: the one the pane shows. */
  defaultTariffId?: string
  /** Energy and percentage-of-energy tariffs: the only two modes that take bands. */
  tariffs: Array<Tariff & { periods?: TariffPeriod[] }>
  isPending?: boolean
  /** A failure that belongs to no field: shown in the form, not only as a toast. */
  error?: string | null
}

/** Add or change a price band of the shown version, in the detail pane. */
export function TariffPeriodForm({
  initialFocus,
  onSubmit,
  onCancel,
  onDirtyChange,
  initialPeriod,
  defaultTariffId,
  tariffs,
  isPending = false,
  error = null,
}: TariffPeriodFormProps) {
  const { t } = useTranslation()
  const formId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstField(formRef, initialFocus)

  const owner = tariffs.find((tariff) => tariff.id === (initialPeriod?.tariff ?? defaultTariffId))
  const form = useForm<TariffPeriodFormValues>({
    resolver: zodResolver(tariffPeriodFormSchema),
    // Seeded once, when the form opens: a refetch of the list behind it must
    // not overwrite what is being typed.
    defaultValues: initialPeriod
      ? mapTariffPeriodToFormValues(initialPeriod, owner?.billing_mode ?? 'energy')
      : {
        ...defaultTariffPeriodFormValues,
        tariff: defaultTariffId ?? defaultTariffPeriodFormValues.tariff,
        billing_mode: owner?.billing_mode ?? 'energy',
      },
  })

  const isDirty = form.formState.isDirty
  useEffect(() => { onDirtyChange(isDirty) }, [isDirty, onDirtyChange])

  // useWatch rather than form.watch(): the latter returns a fresh function on
  // every render, which the React Compiler refuses to memoize around.
  const periodType = useWatch({ control: form.control, name: 'period_type' })
  const weekdays = useWatch({ control: form.control, name: 'weekdays' })
  const months = useWatch({ control: form.control, name: 'months' })
  const billingMode = useWatch({ control: form.control, name: 'billing_mode' })
  const { field: fromField } = useController({ control: form.control, name: 'time_from' })
  const timeFrom = fromField.value
  const { field: toField } = useController({ control: form.control, name: 'time_to' })
  const timeTo = toField.value
  const label = useWatch({ control: form.control, name: 'label' })
  const price = useWatch({ control: form.control, name: 'price_chf_per_kwh' })
  const percentage = useWatch({ control: form.control, name: 'percentage' })
  const isPercentage = billingMode === 'percentage_of_energy'
  const { field: priceField } = useController({ control: form.control, name: isPercentage ? 'percentage' : 'price_chf_per_kwh' })

  function submit(values: TariffPeriodFormValues) {
    onSubmit(mapTariffPeriodFormValuesToInput(values))
  }

  const errors = form.formState.errors

  return (
    <div className="tariff-pane-form">
      {error && <Notice tone="error">{error}</Notice>}
      <form ref={formRef} id={formId} onSubmit={form.handleSubmit(submit)} className="form-grid" aria-busy={isPending || undefined}>
        <fieldset className="tariff-pane-fieldset" disabled={isPending}>
        <label>
          <span>{t('pages.tariffs.form.periodType')}</span>
          <select {...form.register('period_type')}>
            <option value="flat">{t('pages.tariffs.periodTypes.flat')}</option>
            <option value="high">{t('pages.tariffs.periodTypes.high')}</option>
            <option value="low">{t('pages.tariffs.periodTypes.low')}</option>
            <option value="band">{t('pages.tariffs.periodTypes.band')}</option>
          </select>
          <small className="muted">{t('pages.tariffs.form.periodTypeHint')}</small>
        </label>
        {periodType === 'band' && (
          <label>
            <span>{t('pages.tariffs.form.bandLabel')}</span>
            <input {...form.register('label')} placeholder={t('pages.tariffs.form.bandLabelPlaceholder')} />
            <small className="muted">{t('pages.tariffs.form.bandLabelHint')}</small>
          </label>
        )}
        <BandPriceField value={priceField.value} onChange={priceField.onChange} onBlur={priceField.onBlur}
          inputRef={priceField.ref} percentage={isPercentage}
          error={errors[priceField.name] ? t('pages.tariffs.form.errorRequired') : undefined} />
        {periodType !== 'flat' && <BandTimeFields band={{ time_from: timeFrom, time_to: timeTo }} disabled={isPending}
          onChange={(field, value) => (field === 'time_from' ? fromField : toField).onChange(value ?? '')}
          onBlur={field => (field === 'time_from' ? fromField : toField).onBlur()}
          inputRefs={{ time_from: fromField.ref, time_to: toField.ref }}
          errors={{ time_from: errors.time_from ? t('pages.tariffs.form.errorRequired') : undefined,
            time_to: errors.time_to ? t('pages.tariffs.form.errorRequired') : undefined }} />}
        <BandRecurrenceFields band={{ period_type: periodType, weekdays, months }}
          onChange={(field, value) => form.setValue(field, value, { shouldDirty: true })} />
        <TariffBandCoverage validity={owner} bands={[
          ...(owner?.periods ?? []).filter(period => period.id !== initialPeriod?.id),
          { id: initialPeriod?.id, period_type: periodType, label, price_chf_per_kwh: isPercentage ? null : price, percentage: isPercentage ? percentage : null,
            time_from: timeFrom || null, time_to: timeTo || null, weekdays, months },
        ]} />

        </fieldset>
      </form>
      <FormModalFooter
        formId={formId}
        onCancel={onCancel}
        isPending={isPending}
        submitLabel={isPending ? t('common.saving') : t('pages.tariffs.workspace.saveBand')}
        submitIcon={<FontAwesomeIcon icon={faCheck} fixedWidth />}
        cancelIcon={<FontAwesomeIcon icon={faXmark} fixedWidth />}
      />
    </div>
  )
}
