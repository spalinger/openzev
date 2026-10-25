import { Fragment, type ReactNode } from 'react'
import { Popover } from '@mantine/core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faChevronUp, faClock, faCircleExclamation, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { formatShortDate } from '../../lib/appSettings'
import { todayBusinessIso } from '../../lib/dates'
import type { AppSettings, Tariff, TariffSeries } from '../../types/api'
import { useTariffDisplay } from './useTariffDisplay'
import { seriesKeyOf } from './selection'
import type { TariffOverviewRow } from './validity'
import { emphasizedDate } from './datePresentation'
import { TariffPricesCell } from './TariffPricesCell'
import { validityState } from './validity'
import { bandNeedingReview } from './bandDrafts'
import { sharedTariffNotes } from './notes'

const DATE_SLOT = '\u0000'

const categoryOrder: Tariff['category'][] = ['energy', 'grid_fees', 'levies', 'metering']

/** What a group of rows is about; it decides how a row words its validity. */
export type TariffRowsKind = 'current' | 'history'

type TariffCategorySectionsProps = {
    rows: TariffOverviewRow[]
    kind: TariffRowsKind
    settings: AppSettings
    /** Open the exact version displayed by the row. */
    onOpenDetail: (series: TariffSeries, versionId: string) => void
    onCloseDetail: (series: TariffSeries) => void
    expandedVersion: (series: TariffSeries) => string | null
    renderActions?: (series: TariffSeries, versionId: string) => ReactNode
    renderDetail: (series: TariffSeries, versionId: string) => ReactNode
}

/**
 * Light overview rows; inspection unfolds below, editing uses the task pane.
 */
export function TariffCategorySections({
    rows,
    kind,
    settings,
    onOpenDetail,
    onCloseDetail,
    expandedVersion,
    renderActions,
    renderDetail,
}: TariffCategorySectionsProps) {
    const { t } = useTranslation()
    const today = todayBusinessIso()
    const display = useTariffDisplay(settings)
    const { sourceById, currentValidity } = display
    const tariffSections = categoryOrder
        .map((category) => ({ category, rows: rows.filter((row) => row.series.category === category) }))
        .filter((section) => section.rows.length > 0)

    // `ab 01.01.2027`, the year (and, within this year, the month) bold. The
    // sentence is cut at its date, so each language keeps its own word order.
    function upcomingStart(validFrom: string) {
        const [before, after] = t('pages.tariffs.validity.starts', { date: DATE_SLOT }).split(DATE_SLOT)
        const parts = emphasizedDate(formatShortDate(validFrom, settings), settings.date_format_short, validFrom.slice(0, 4) === today.slice(0, 4))
        return <><span className="tariff-future-icon" role="img" aria-label={t('pages.tariffs.overview.upcoming')} title={t('pages.tariffs.overview.upcoming')}><FontAwesomeIcon icon={faClock} fixedWidth aria-hidden="true" /></span>{' '}{before}{parts.map((part, index) => (part.strong ? <strong key={index}>{part.text}</strong> : part.text))}{after}</>
    }

    return (
        <div className="tariff-list">
            {tariffSections.map((section) => (
                <section key={section.category} className="tariff-category" aria-labelledby={`tariff-category-${kind}-${section.category}`}>
                    <h2 className="tariff-category-title" id={`tariff-category-${kind}-${section.category}`}>
                        {t(`pages.tariffs.categories.${section.category}` as Parameters<typeof t>[0])}
                    </h2>
                    <div className="tariff-category-body">
                        <table className="tariff-table" aria-labelledby={`tariff-category-${kind}-${section.category}`}>
                            <thead className="visually-hidden">
                                <tr>
                                    <th scope="col">
                                        {t(`pages.tariffs.categories.${section.category}` as Parameters<typeof t>[0])}
                                    </th>
                                    <th scope="col" id={`tariff-applies-${kind}-${section.category}`}>{t('pages.tariffs.rateCard.applies')}</th>
                                    <th scope="col" id={`tariff-price-${kind}-${section.category}`} className="numeric">{t('pages.tariffs.rateCard.price')}</th>
                                    <th scope="col" id={`tariff-unit-${kind}-${section.category}`}>{t('pages.tariffs.rateCard.unit')}</th>
                                    <th scope="col" className="tariff-table-valid">{t('pages.tariffs.rateCard.valid')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {section.rows.map(row => {
                                    const { series, version: shown } = row
                                    const seriesKey = seriesKeyOf(series)

                                    const dynamicSource = shown.dynamic_source ? sourceById.get(shown.dynamic_source) : undefined
                                    const fetchFailed = dynamicSource?.last_fetch_status === 'failed'
                                    const validity = currentValidity(shown)
                                    const expandedId = expandedVersion(series)
                                    const isOpen = expandedId !== null
                                    const sharedNotes = sharedTariffNotes(series)
                                    const notes = sharedNotes ?? shown.notes?.trim()
                                    const detailId = `tariff-expanded-${kind}-${shown.id}`
                                    const scheduled = validityState(shown, today) === 'scheduled'
                                    const usesBands = !shown.dynamic_source && (series.billing_mode === 'energy' || series.billing_mode === 'percentage_of_energy')
                                    const incomplete = usesBands && shown.periods.length === 0
                                    const bandToReview = !isOpen && usesBands
                                        ? bandNeedingReview(shown.periods, shown)
                                        : undefined
                                    const warning = incomplete ? t('pages.tariffs.workspace.incomplete')
                                        : bandToReview ? t('pages.tariffs.bandEntry.uncoveredSummary')
                                        : shown.dynamic_price_summary?.status === 'partial' ? t('pages.tariffs.ux.partial') : null

                                    function openRow() {
                                        if (isOpen) onCloseDetail(series)
                                        else onOpenDetail(series, shown.id)
                                    }

                                    // The task editor stays mounted separately while the overview changes.
                                    return (
                                        <Fragment key={seriesKey}><tr
                                            data-row-key={`${seriesKey}:${shown.id}`}
                                            data-series-key={seriesKey}
                                            className={['tariff-summary-row', isOpen && 'is-selected', kind === 'history' && 'is-ended'].filter(Boolean).join(' ')}
                                            onClick={event => {
                                                if (!(event.target as Element).closest('button, a, input, select, textarea, summary') && !window.getSelection()?.toString()) openRow()
                                            }}
                                        >
                                            <td className="tariff-table-tariff">
                                                <div className="tariff-table-name">
                                                    <button
                                                        type="button"
                                                        className="tariff-select"
                                                        aria-expanded={isOpen}
                                                        aria-controls={isOpen ? detailId : undefined}
                                                        onClick={(event) => {
                                                            event.stopPropagation()
                                                            openRow()
                                                        }}
                                                    >
                                                        {series.name}
                                                    </button>
                                                    {series.energy_type && <Popover width={280} position="bottom-start" withArrow>
                                                        <Popover.Target>
                                                            <button type="button" className="tariff-table-meta"
                                                                aria-label={`${t('pages.tariffs.form.energyType')}: ${t(`pages.tariffs.energyTypes.${series.energy_type}` as Parameters<typeof t>[0])}`}
                                                                onClick={event => event.stopPropagation()}>
                                                                {t(`pages.tariffs.energyTypes.${series.energy_type}` as Parameters<typeof t>[0])}
                                                            </button>
                                                        </Popover.Target>
                                                        <Popover.Dropdown onClick={event => event.stopPropagation()}>
                                                            {t(`pages.tariffs.form.energyTypeHints.${series.energy_type}` as Parameters<typeof t>[0])}
                                                        </Popover.Dropdown>
                                                    </Popover>}
                                                    <span className="tariff-title-actions">
                                                        {expandedId && renderActions?.(series, expandedId)}
                                                        <span className="tariff-table-open">
                                                            <button
                                                                type="button"
                                                                className="button button-ghost button-icon button-compact"
                                                                aria-label={t(isOpen ? 'pages.tariffs.workspace.hideDetails' : 'pages.tariffs.workspace.showDetails', { name: series.name })}
                                                                aria-expanded={isOpen}
                                                                aria-controls={isOpen ? detailId : undefined}
                                                                onClick={(event) => {
                                                                    event.stopPropagation()
                                                                    openRow()
                                                                }}
                                                            >
                                                                <FontAwesomeIcon icon={isOpen ? faChevronUp : faChevronDown} fixedWidth />
                                                            </button>
                                                        </span>
                                                    </span>
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
                                                {notes && (!isOpen || sharedNotes) && <div className={`tariff-table-notes${sharedNotes ? ' tariff-shared-notes' : ''}`} title={notes}>{notes}</div>}
                                            </td>
                                            <TariffPricesCell row={row} kind={kind} today={today} settings={settings} display={display} onOpenDetail={onOpenDetail}
                                                warning={!isOpen && warning && <div className="tariff-band-coverage tariff-price-warning" role="status">
                                                    <div className="tariff-band-warning">
                                                        <FontAwesomeIcon icon={faCircleExclamation} fixedWidth aria-hidden="true" />
                                                        <p>{warning}</p>
                                                    </div>
                                                </div>} />
                                            <td className="tariff-table-valid">
                                                {scheduled
                                                    ? upcomingStart(shown.valid_from)
                                                    : kind === 'history'
                                                        ? <span>{formatShortDate(shown.valid_from, settings)} – {formatShortDate(shown.valid_to ?? shown.valid_from, settings)}</span>
                                                        : <span title={validity.tooltip}>{validity.label}</span>}
                                            </td>

                                        </tr>{expandedId && <tr className="tariff-detail-row"><td colSpan={5}><div id={detailId} className="tariff-expanded-content" data-detail-series-key={seriesKey}>{renderDetail(series, expandedId)}</div></td></tr>}</Fragment>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>
            ))}
        </div>
    )
}
