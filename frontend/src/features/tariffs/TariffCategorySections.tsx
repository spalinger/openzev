import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { formatShortDate } from '../../lib/appSettings'
import { todayBusinessIso } from '../../lib/dates'
import type { AppSettings, Tariff, TariffSeries } from '../../types/api'
import { seriesKeyOf, useTariffDisplay } from './useTariffDisplay'
import type { TariffOverviewRow } from './validity'
import { emphasizedDate } from './datePresentation'
import { TariffPricesCell } from './TariffPricesCell'
import { validityState } from './validity'

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
                                    onClick={openRow}
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
                                            {!shown.dynamic_source && (series.billing_mode === 'energy' || series.billing_mode === 'percentage_of_energy') && shown.periods.length === 0 && <span className="badge badge-warning">{t('pages.tariffs.workspace.incomplete')}</span>}
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
                                        {notes && <div className="tariff-table-notes" title={notes}>{notes}</div>}
                                        </div>
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
