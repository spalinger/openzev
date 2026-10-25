import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TariffBandCoverage } from './TariffBandCoverage'
import { ConfirmDialog, useConfirmDialog } from '../../components/ConfirmDialog'
import { BandPriceField, BandTimeFields, BandRecurrenceFields } from './TariffBandFields'
import { bandPreset, emptyBand, missingBandTimes, presetDiscardsChanges, type BandDraft, type BandValidity } from './bandDrafts'

export function TariffBandEditor({ value, onChange, validity, disabled = false, showErrors = false }: {
  value: BandDraft[]
  onChange: (bands: BandDraft[]) => void
  disabled?: boolean
  showErrors?: boolean
  validity?: BandValidity
}) {
  const { t } = useTranslation()
  const { dialog, confirm, handleConfirm, handleCancel } = useConfirmDialog()
  const [preset, setPreset] = useState(value.length === 1 && value[0].period_type === 'flat' ? 'flat' : 'custom')
  const focusAddedBand = useRef(false)
  const addButton = useRef<HTMLButtonElement>(null)
  function update(index: number, patch: Partial<BandDraft>) {
    if (['period_type', 'time_from', 'time_to', 'weekdays', 'months'].some(field => field in patch)) setPreset('custom')
    onChange(value.map((band, position) => position === index ? { ...band, ...patch } : band))
  }
  return <div className="tariff-band-editor grid-span-full">
    <label>
      <span>{t('pages.tariffs.bandEntry.structure')}</span>
      <select value={preset} disabled={disabled} onChange={event => {
        const next = event.target.value
        if (next !== 'flat' && next !== 'htnt') { setPreset(next); return }
        const bands = bandPreset(next, value)
        const apply = () => { setPreset(next); onChange(bands) }
        if (presetDiscardsChanges(value, bands)) confirm({
          title: t('pages.tariffs.bandEntry.replaceTitle'),
          message: t('pages.tariffs.bandEntry.replaceBody'),
          confirmText: t('pages.tariffs.bandEntry.replaceConfirm'),
          onConfirm: apply,
        })
        else apply()
      }}>
        <option value="flat">{t('pages.tariffs.bandEntry.flat')}</option>
        <option value="htnt">{t('pages.tariffs.bandEntry.htnt')}</option>
        <option value="custom">{t('pages.tariffs.bandEntry.custom')}</option>
      </select>
    </label>
    {value.map((band, index) => <fieldset key={index} className="tariff-band-draft" data-band-index={index} disabled={disabled}>
      <legend>{t('pages.tariffs.bandEntry.band', { number: index + 1 })}</legend>
      <label>
        <span>{t('pages.tariffs.form.periodType')}</span>
        <select value={band.period_type} ref={index === value.length - 1 ? node => {
          if (node && focusAddedBand.current) { focusAddedBand.current = false; node.focus() }
        } : undefined} onChange={event => update(index, { period_type: event.target.value as BandDraft['period_type'] })}>
          {(['flat', 'high', 'low', 'band'] as const).map(type => <option key={type} value={type}>{t(`pages.tariffs.periodTypes.${type}`)}</option>)}
        </select>
      </label>
      <BandPriceField value={band.price_chf_per_kwh} onChange={price_chf_per_kwh => update(index, { price_chf_per_kwh })} />
      {band.period_type === 'band' && <label className="grid-span-full"><span>{t('pages.tariffs.form.bandLabel')}</span>
        <input value={band.label} onChange={event => update(index, { label: event.target.value })} />
      </label>}
      {band.period_type !== 'flat' && <BandTimeFields band={band} number={index + 1} disabled={disabled}
        onChange={(field, next) => update(index, { [field]: next })}
        errors={Object.fromEntries(showErrors ? missingBandTimes(band).map(field => [field, t('pages.tariffs.form.errorRequired')]) : [])} />}
      <BandRecurrenceFields band={band} onChange={(field, next) => update(index, { [field]: next })} />
      {value.length > 1 && <button type="button" className="button button-secondary button-compact" aria-label={t('pages.tariffs.bandEntry.remove', { number: index + 1 })}
        onClick={() => { setPreset('custom'); onChange(value.filter((_, position) => position !== index)); addButton.current?.focus() }}>{t('pages.tariffs.bandEntry.removeButton')}</button>}
    </fieldset>)}
    <button ref={addButton} type="button" className="button button-secondary button-compact" disabled={disabled} onClick={() => {
      setPreset('custom')
      focusAddedBand.current = true
      onChange([...value, { ...emptyBand(), period_type: 'band' }])
    }}>{t('pages.tariffs.addPeriod')}</button>
    <TariffBandCoverage bands={value} validity={validity} />
    {dialog && <ConfirmDialog {...dialog} onConfirm={handleConfirm} onCancel={handleCancel} />}
  </div>
}
