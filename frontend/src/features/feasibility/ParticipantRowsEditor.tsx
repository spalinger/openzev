import { useFieldArray, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { emptyParticipantRow, type FeasibilityFormValues } from './useFeasibilityForm'

type Props = {
    form: UseFormReturn<FeasibilityFormValues>
}

export function ParticipantRowsEditor({ form }: Props) {
    const { t } = useTranslation()
    const { fields, append, remove } = useFieldArray({ control: form.control, name: 'participants' })

    return (
        <div>
            {fields.length > 0 && (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr auto',
                        gap: '0.4rem',
                        marginBottom: '0.3rem',
                    }}
                >
                    <span className="muted" style={{ fontSize: '0.72rem' }}>{t('pages.feasibility.form.participantName')}</span>
                    <span className="muted" style={{ fontSize: '0.72rem' }}>{t('pages.feasibility.form.participantProduction')}</span>
                    <span className="muted" style={{ fontSize: '0.72rem' }}>{t('pages.feasibility.form.participantConsumption')}</span>
                    <span />
                </div>
            )}
            {fields.map((field, index) => (
                <div
                    key={field.id}
                    style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.4rem', marginBottom: '0.4rem' }}
                >
                    <input
                        placeholder={t('pages.feasibility.form.participantNamePlaceholder')}
                        {...form.register(`participants.${index}.name` as const)}
                    />
                    <input type="number" step="any" min="0" {...form.register(`participants.${index}.annual_production_kwh` as const)} />
                    <input type="number" step="any" min="0" {...form.register(`participants.${index}.annual_consumption_kwh` as const)} />
                    <button
                        type="button"
                        className="button button-danger button-compact"
                        onClick={() => remove(index)}
                        aria-label={t('common.delete')}
                    >
                        {t('common.delete')}
                    </button>
                </div>
            ))}
            <button
                type="button"
                className="button button-secondary button-compact"
                onClick={() => append(emptyParticipantRow)}
            >
                {t('pages.feasibility.form.addParticipant')}
            </button>
        </div>
    )
}
