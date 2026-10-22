import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight, faCircleExclamation, faPen, faPlus, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { formatShortDate } from '../../lib/appSettings'
import { todayBusinessIso } from '../../lib/dates'
import type { AppSettings, Tariff, TariffPeriod, TariffSeries } from '../../types/api'
import { bandWindow } from './bands'
import { seriesKeyOf, useTariffDisplay } from './useTariffDisplay'
import type { TariffOverviewRow } from './validity'
import { emphasizedDate } from './datePresentation'
import { TariffPricesCell } from './TariffPricesCell'
import { validityState } from './validity'
import { bandCoverage } from './bandDrafts'
import { TariffBandCoverage } from './TariffBandEditor'

const DATE_SLOT = '\u0000'

const categoryOrder: Tariff['category'][] = ['energy', 'grid_fees', 'levies', 'metering']

/** What a group of rows is about; it decides how a row words its validity. */
export type TariffRowsKind = 'current' | 'history'

type TariffCategorySectionsProps = {
    rows: TariffOverviewRow[]
    kind: TariffRowsKind
    settings: AppSettings
    /** The series and version shown in the detail pane, so its row can be highlighted. */
    selected: { seriesKey: string, versionId: string } | null
    /** Open the exact version displayed by the row. */
    onOpenDetail: (series: TariffSeries, versionId: string) => void
    onCloseDetail: () => void
    onRepairBand?: (series: TariffSeries, versionId: string, period?: TariffPeriod) => void
}

/**
 * One row per tariff series and group, in the category order; details and
 * write actions live in the detail pane.
 */
export function TariffCategorySections({
    rows,
    kind,
    settings,
    selected,
    onOpenDetail,
    onCloseDetail,
    onRepairBand,
}: TariffCategorySectionsProps) {
    const { t } = useTranslation()
    const today = todayBusinessIso()
    const display = useTariffDisplay(settings, today)
    const { sourceById, validityBadge } = display
    const tariffSections = categoryOrder
        .map((category) => ({ category, rows: rows.filter((row) => row.series.category === category) }))
        .filter((section) => section.rows.length > 0)

    // `ab 01.01.2027`, the year (and, within this year, the month) bold. The
    // sentence is cut at its date, so each language keeps its own word order.
    function upcomingStart(validFrom: string) {
        const [before, after] = t('pages.tariffs.validity.starts', { date: DATE_SLOT }).split(DATE_SLOT)
        const parts = emphasizedDate(formatShortDate(validFrom, settings), settings.date_format_short, validFrom.slice(0, 4) === today.slice(0, 4))
        return <>{before}{parts.map((part, index) => (part.strong ? <strong key={index}>{part.text}</strong> : part.text))}{after}</>
    }

    return (
        <div className="table-card invoice-rows tariff-list">
            {tariffSections.map((section) => (
                <table key={section.category} className="tariff-table">
                    <thead>
                        <tr>
                            <th scope="col">
                                {t(`pages.tariffs.categories.${section.category}` as Parameters<typeof t>[0])}
                            </th>
                            <th scope="col" id={`tariff-applies-${kind}-${section.category}`}>{t('pages.tariffs.rateCard.applies')}</th>
                            <th scope="col" id={`tariff-price-${kind}-${section.category}`} className="numeric">{t('pages.tariffs.rateCard.price')}</th>
                            <th scope="col" id={`tariff-unit-${kind}-${section.category}`} className="tariff-table-unit">{t('pages.tariffs.rateCard.unit')}</th>
                            <th scope="col" className="tariff-table-valid">{t('pages.tariffs.rateCard.valid')}</th>
                            <th scope="col" className="tariff-table-open">
                                <span className="visually-hidden">{t('pages.tariffs.viewDetails')}</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {section.rows.map(row => {
                            const { series, version: shown } = row
                            const seriesKey = seriesKeyOf(series)

                            const dynamicSource = shown.dynamic_source ? sourceById.get(shown.dynamic_source) : undefined
                            const fetchFailed = dynamicSource?.last_fetch_status === 'failed'
                            const badge = validityBadge(shown)
                            const notes = shown.notes?.trim()
                            const isOpen = seriesKey === selected?.seriesKey
                            const scheduled = validityState(shown, today) === 'scheduled'
                            const currentHasEnd = kind === 'current' && !scheduled && Boolean(shown.valid_to)
                            const incomplete = !shown.dynamic_source && (series.billing_mode === 'energy' || series.billing_mode === 'percentage_of_energy') && shown.periods.length === 0
                            const bandToReview = shown.periods.find(period => period.period_type !== 'flat' && !bandWindow(period))
                                ?? bandCoverage(shown.periods).fallbacks[0]?.band

                            function openRow() {
                                if (isOpen && selected.versionId === shown.id) onCloseDetail()
                                else onOpenDetail(series, shown.id)
                            }

                            return (
                                <tr
                                    key={`${seriesKey}:${shown.id}`}
                                    data-row-key={`${seriesKey}:${shown.id}`}
                                    data-series-key={seriesKey}
                                    className={[isOpen && 'is-selected', kind === 'history' && 'is-ended'].filter(Boolean).join(' ') || undefined}
                                    onClick={() => { if (!window.getSelection()?.toString()) openRow() }}
                                >
                                    <td className="tariff-table-tariff">
                                        <div className="tariff-table-name">
                                            <button
                                                type="button"
                                                className="tariff-select"
                                                aria-expanded={isOpen}
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    openRow()
                                                }}
                                            >
                                                {series.name}
                                            </button>
                                            {series.gaps.length > 0 && (
                                                <span className="badge badge-danger" title={t('pages.tariffs.versions.gapTooltip')}>
                                                    <FontAwesomeIcon icon={faTriangleExclamation} fixedWidth />{' '}
                                                    {t('pages.tariffs.versions.gapBadge', { count: series.gaps.length })}
                                                </span>
                                            )}
                                            {fetchFailed && (
                                                <span
                                                    className="badge badge-danger"
                                                    title={t('pages.tariffs.dynamicFetchFailedTooltip', { error: dynamicSource.last_fetch_error })}
                                                >
                                                    <FontAwesomeIcon icon={faTriangleExclamation} fixedWidth />{' '}
                                                    {t('pages.tariffs.dynamicFetchFailed')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="tariff-table-context">
                                        {series.energy_type && (
                                            <div className="tariff-table-meta">
                                                {t(`pages.tariffs.energyTypes.${series.energy_type}` as Parameters<typeof t>[0])}
                                            </div>
                                        )}
                                        {notes && <div className="tariff-table-notes" title={notes}>{series.energy_type && <span aria-hidden="true">· </span>}{notes}</div>}
                                        </div>
                                        {!shown.dynamic_source && (series.billing_mode === 'energy' || series.billing_mode === 'percentage_of_energy') && shown.periods.length > 0 && (
                                            <TariffBandCoverage bands={shown.periods} warningsOnly />
                                        )}
                                        {(incomplete || bandToReview) && <div className="tariff-row-repair">
                                            {onRepairBand ? <button type="button" className="button button-secondary button-compact" data-action-key={`repair-${shown.id}`} onClick={event => {
                                                event.stopPropagation()
                                                onRepairBand(series, shown.id, bandToReview)
                                            }}><FontAwesomeIcon icon={incomplete ? faPlus : faPen} fixedWidth />{t(incomplete ? 'pages.tariffs.ux.addPrices' : 'pages.tariffs.ux.reviewWindow')}</button>
                                                : <span><FontAwesomeIcon icon={faTriangleExclamation} fixedWidth />{' '}{incomplete ? t('pages.tariffs.workspace.incomplete') : t('pages.tariffs.ux.reviewWindow')}</span>}
                                        </div>}
                                        {shown.dynamic_price_summary?.status === 'partial' && <div className="tariff-band-coverage">
                                            <div className="tariff-band-warning">
                                                <FontAwesomeIcon icon={faCircleExclamation} fixedWidth aria-hidden="true" />
                                                <p><button type="button" className="tariff-warning-link" onClick={event => {
                                                    event.stopPropagation()
                                                    onOpenDetail(series, shown.id)
                                                }}>{t('pages.tariffs.ux.partial')}</button></p>
                                            </div>
                                        </div>}
                                    </td>
                                    <TariffPricesCell row={row} kind={kind} today={today} settings={settings} display={display} onOpenDetail={onOpenDetail} />
                                    <td className="tariff-table-valid">
                                        {currentHasEnd ? null : scheduled
                                            ? upcomingStart(shown.valid_from)
                                            : kind === 'history'
                                                ? <span>{formatShortDate(shown.valid_from, settings)} – {formatShortDate(shown.valid_to ?? shown.valid_from, settings)}</span>
                                                : <span title={badge.tooltip}>{badge.label}</span>}
                                    </td>
                                    <td className="tariff-table-open">
                                        <button
                                            type="button"
                                            className="button button-ghost button-icon button-compact"
                                            aria-label={isOpen ? t('common.close') : t('pages.tariffs.viewDetails')}
                                            aria-expanded={isOpen}
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                if (isOpen) onCloseDetail()
                                                else openRow()
                                            }}
                                        >
                                            <FontAwesomeIcon icon={isOpen ? faChevronLeft : faChevronRight} fixedWidth />
                                        </button>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            ))}
        </div>
    )
}
