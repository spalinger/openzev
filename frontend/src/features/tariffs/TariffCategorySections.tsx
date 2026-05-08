import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
    faPen,
    faPlus,
    faTrash,
} from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { formatShortDate } from '../../lib/appSettings'
import type { AppSettings, Tariff, TariffPeriod } from '../../types/api'

type TariffSection = {
    category: Tariff['category']
    tariffs: Tariff[]
}

type TariffCategorySectionsProps = {
    tariffSections: TariffSection[]
    periodsByTariff: Map<string, TariffPeriod[]>
    settings: AppSettings
    deleteTariffDisabled: boolean
    deletePeriodDisabled: boolean
    onEditTariff: (tariff: Tariff) => void
    onDeleteTariff: (tariff: Tariff) => void
    onOpenCreatePeriodModal: (tariffId: string) => void
    onEditPeriod: (period: TariffPeriod) => void
    onDeletePeriod: (period: TariffPeriod) => void
}

export function TariffCategorySections({
    tariffSections,
    periodsByTariff,
    settings,
    deleteTariffDisabled,
    deletePeriodDisabled,
    onEditTariff,
    onDeleteTariff,
    onOpenCreatePeriodModal,
    onEditPeriod,
    onDeletePeriod,
}: TariffCategorySectionsProps) {
    const { t } = useTranslation()

    return (
        <div className="tariff-category-sections">
            {tariffSections.map((section) => (
                <section
                    key={section.category}
                    className={`tariff-category-section tariff-category-section-${section.category.replace(/_/g, '-')}`}
                >
                    <div className="tariff-category-header">
                        <div className="tariff-category-title-row">
                            <h3>{t(`pages.tariffs.categories.${section.category}` as Parameters<typeof t>[0])}</h3>
                            <span className="badge badge-neutral">{section.tariffs.length}</span>
                        </div>
                    </div>

                    <div className="tariff-card-list">
                        {section.tariffs.map((tariff) => {
                            const tariffPeriods = periodsByTariff.get(tariff.id) ?? []
                            const usesPeriods = tariff.billing_mode === 'energy'
                            const pricingLabel = tariff.billing_mode === 'energy'
                                ? t(`pages.tariffs.energyTypes.${tariff.energy_type || 'local'}` as Parameters<typeof t>[0])
                                : tariff.billing_mode === 'percentage_of_energy'
                                    ? `${tariff.percentage ?? '0'}% · ${t(`pages.tariffs.energyTypes.${tariff.energy_type || 'local'}` as Parameters<typeof t>[0])}`
                                    : `CHF ${tariff.fixed_price_chf || '0.00'}`

                            return (
                                <article key={tariff.id} className="tariff-card">
                                    <div className="tariff-card-header">
                                        <div className="tariff-card-title">
                                            <div className="tariff-card-heading">
                                                <strong>{tariff.name}</strong>
                                                <div className="tariff-name-badges">
                                                    <span className="badge badge-info">
                                                        {t(`pages.tariffs.billingModes.${tariff.billing_mode}` as Parameters<typeof t>[0], { defaultValue: tariff.billing_mode })}
                                                    </span>
                                                    {tariff.energy_type && (
                                                        <span className="badge badge-success">
                                                            {t(`pages.tariffs.energyTypes.${tariff.energy_type}` as Parameters<typeof t>[0])}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="tariff-card-actions">
                                            <button className="button button-primary button-compact" type="button" onClick={() => onEditTariff(tariff)}>
                                                <FontAwesomeIcon icon={faPen} fixedWidth />
                                                {t('common.edit')}
                                            </button>
                                            <button
                                                className="button button-danger button-compact"
                                                type="button"
                                                disabled={deleteTariffDisabled}
                                                onClick={() => onDeleteTariff(tariff)}
                                            >
                                                <FontAwesomeIcon icon={faTrash} fixedWidth />
                                                {t('common.delete')}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="tariff-card-details">
                                        <div className="tariff-detail-card">
                                            <span className="tariff-detail-label">{t('pages.tariffs.col.pricing')}</span>
                                            <span className="tariff-detail-value">{pricingLabel}</span>
                                        </div>
                                        <div className="tariff-detail-card">
                                            <span className="tariff-detail-label">{t('pages.tariffs.col.validity')}</span>
                                            <span className="tariff-detail-value">
                                                {formatShortDate(tariff.valid_from, settings)} - {tariff.valid_to ? formatShortDate(tariff.valid_to, settings) : '-'}
                                            </span>
                                        </div>
                                        <div className="tariff-detail-card tariff-detail-card-wide">
                                            <span className="tariff-detail-label">{t('pages.tariffs.form.notes')}</span>
                                            <span className="tariff-detail-value">{tariff.notes?.trim() || t('pages.tariffs.noNotes')}</span>
                                        </div>
                                    </div>

                                    <div className="tariff-period-section">
                                        <div className="tariff-period-section-header">
                                            <div className="tariff-period-section-title-row">
                                                <h4>{t('pages.tariffs.tariffPeriods')}</h4>
                                                {usesPeriods && tariffPeriods.length > 0 && (
                                                    <span className="badge badge-neutral">{tariffPeriods.length}</span>
                                                )}
                                            </div>
                                            {usesPeriods && (
                                                <button
                                                    className="button button-secondary button-compact"
                                                    type="button"
                                                    onClick={() => onOpenCreatePeriodModal(tariff.id)}
                                                >
                                                    <FontAwesomeIcon icon={faPlus} fixedWidth />
                                                    {t('pages.tariffs.addPeriod')}
                                                </button>
                                            )}
                                        </div>

                                        {!usesPeriods ? (
                                            <p className="muted tariff-period-empty">{t('pages.tariffs.fixedFeeHint')}</p>
                                        ) : tariffPeriods.length === 0 ? (
                                            <p className="muted tariff-period-empty">{t('pages.tariffs.noPeriods')}</p>
                                        ) : (
                                            <div className="tariff-period-list">
                                                {tariffPeriods.map((period) => (
                                                    <div key={period.id} className="tariff-period-row">
                                                        <div className="tariff-period-main">
                                                            <div className="tariff-period-line">
                                                                <span className="badge badge-neutral">
                                                                    {t(`pages.tariffs.periodTypes.${period.period_type}` as Parameters<typeof t>[0], { defaultValue: period.period_type })}
                                                                </span>
                                                                <strong>CHF {period.price_chf_per_kwh}/kWh</strong>
                                                            </div>
                                                            <div className="muted tariff-period-meta">
                                                                {period.period_type === 'flat'
                                                                    ? `${t('pages.tariffs.allDay')} · ${t('pages.tariffs.allWeekdays')}`
                                                                    : `${period.time_from || '--'} - ${period.time_to || '--'} · ${period.weekdays || t('pages.tariffs.allWeekdays')}`}
                                                            </div>
                                                        </div>

                                                        <div className="tariff-period-actions">
                                                            <button className="button button-secondary button-compact" type="button" onClick={() => onEditPeriod(period)}>
                                                                <FontAwesomeIcon icon={faPen} fixedWidth />
                                                                {t('common.edit')}
                                                            </button>
                                                            <button
                                                                className="button button-danger button-compact"
                                                                type="button"
                                                                disabled={deletePeriodDisabled}
                                                                onClick={() => onDeletePeriod(period)}
                                                            >
                                                                <FontAwesomeIcon icon={faTrash} fixedWidth />
                                                                {t('common.delete')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </article>
                            )
                        })}
                    </div>
                </section>
            ))}
        </div>
    )
}
