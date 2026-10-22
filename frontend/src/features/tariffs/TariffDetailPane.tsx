import { useId, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
    faArrowLeft,
    faClone,
    faEllipsisVertical,
    faPen,
    faPlus,
    faTag,
    faTrash,
    faTriangleExclamation,
    faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { Notice } from '../../components/Notice'
import { ActionMenu } from '../../components/ActionMenu'
import { formatShortDate } from '../../lib/appSettings'
import { todayBusinessIso } from '../../lib/dates'
import type { AppSettings, TariffPeriod, TariffSeries, TariffVersion } from '../../types/api'
import { bandName, bandWindow } from './bands'
import { MONTH_KEYS, WEEKDAY_KEYS, formatSeason, formatWeekdays } from './recurrence'
import { kwhPrice } from './rateLines'
import { useTariffDisplay } from './useTariffDisplay'
import { listedVersion, validityState } from './validity'
import { TariffPriceHistoryChart } from './TariffPriceHistoryChart'
import { DynamicPriceHistoryPanel } from './DynamicPriceHistoryModal'
import { DynamicSourceSummary } from './DynamicSourceSummary'
import { useAuth } from '../../lib/auth'

type TariffPaneFrameProps = {
    title: string
    /** One quiet line under the title. */
    subtitle?: ReactNode
    /** Something under the line that needs a look (a failed price fetch). */
    notice?: ReactNode
    /** X always leaves the pane. Back and Escape may cancel editing. */
    onClose: () => void
    onBack?: () => void
    onEscape?: () => void
    /** The title is where focus lands when the pane is opened on purpose. */
    titleRef?: Ref<HTMLHeadingElement>
    actions?: ReactNode
    backLabel?: string
    children: ReactNode
}

/**
 * The pane's chrome, the same for viewing and editing: a region named by its
 * title, a close button, and the body. Not modal: no `aria-modal`, no focus
 * trap, nothing around it made inert.
 */
export function TariffPaneFrame({ title, subtitle, notice, onClose, onBack = onClose, onEscape = onClose, titleRef, actions, backLabel, children }: TariffPaneFrameProps) {
    const { t } = useTranslation()
    const titleId = useId()

    function onKeyDown(event: KeyboardEvent<HTMLElement>) {
        // A menu or picker inside the pane takes the Escape that dismisses it.
        if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault()
            onEscape()
        }
    }

    return (
        <section className="tariff-pane" aria-labelledby={titleId} onKeyDown={onKeyDown}>
            <button type="button" className="button button-ghost tariff-pane-back" onClick={onBack}>
                <FontAwesomeIcon icon={faArrowLeft} fixedWidth />{backLabel ?? t('pages.tariffs.workspace.back')}
            </button>
            <header className="tariff-pane-header">
                <div className="tariff-pane-heading">
                    <h2 id={titleId} ref={titleRef} tabIndex={-1}>{title}</h2>
                    {subtitle && <p className="tariff-pane-meta">{subtitle}</p>}
                    {notice}
                </div>
                <div className="tariff-pane-header-actions">
                    {actions}
                    <button
                        type="button"
                        className="button button-ghost button-icon tariff-pane-close"
                        onClick={onClose}
                        aria-label={t('common.close')}
                        title={t('common.close')}
                    >
                        <FontAwesomeIcon icon={faXmark} fixedWidth />
                    </button>
                </div>
            </header>
            {children}
        </section>
    )
}

type TariffDetailPaneProps = {
    series: TariffSeries
    /** Every series in scope — percentage tariffs derive their price from the grid ones. */
    allSeries: TariffSeries[]
    settings: AppSettings
    /** The version within `series` currently shown, defaulting to the one in force. */
    shownVersionId: string | null
    onShowVersion: (versionId: string) => void
    deleteTariffDisabled: boolean
    deletePeriodDisabled: boolean
    onClose: () => void
    onBack?: () => void
    onEscape?: () => void
    onEditTariff: (tariff: TariffVersion, actionKey: string) => void
    onDeleteTariff: (tariff: TariffVersion) => void
    onOpenCreatePeriod: (tariffId: string) => void
    onEditPeriod: (period: TariffPeriod, actionKey: string) => void
    onDeletePeriod: (period: TariffPeriod) => void
    onNewVersion: (series: TariffSeries, source: TariffVersion, validFrom?: string) => void
    onDuplicate: (series: TariffSeries, source: TariffVersion) => void
    onRenameSeries: (series: TariffSeries, source: TariffVersion) => void
    /** A viewer reads only (#761): no version, edit, rename, duplicate, delete or band changes. */
    readOnly?: boolean
    /** The title is where focus lands when the pane is opened on purpose. */
    titleRef?: Ref<HTMLHeadingElement>
    /** A form that replaces the body while the tariff is edited, with what it is for. */
    editor?: { label: string, content: ReactNode }
}

/** Selected version, its prices/history and the active editing task. */
export function TariffDetailPane({
    series,
    allSeries,
    settings,
    shownVersionId,
    onShowVersion,
    deleteTariffDisabled,
    deletePeriodDisabled,
    onClose,
    onBack,
    onEscape,
    onEditTariff,
    onDeleteTariff,
    onOpenCreatePeriod,
    onEditPeriod,
    onDeletePeriod,
    onNewVersion,
    onDuplicate,
    onRenameSeries,
    readOnly = false,
    titleRef,
    editor,
}: TariffDetailPaneProps) {
    const { t } = useTranslation()
    const { user } = useAuth()
    const monthNames = MONTH_KEYS.map(
        (key) => t(`pages.tariffs.monthsShort.${key}` as Parameters<typeof t>[0]),
    )
    const dayNames = WEEKDAY_KEYS.map(
        (key) => t(`pages.tariffs.weekdaysShort.${key}` as Parameters<typeof t>[0]),
    )
    const today = todayBusinessIso()
    const { sourceById, sourcesQuery, priceSummary, dynamicAverageLabel, pricingTooltipFor } = useTariffDisplay(settings, today)

    const versions = series.versions
    const shown = versions.find((version) => version.id === shownVersionId)
        ?? listedVersion(versions, today)
    const shownState = validityState(shown, today)

    // Checked on the shown *version*, not the series: a series can hold both a
    // static and a dynamic version (an operator switching to dynamic pricing
    // at a version boundary, ADR 0018) since dynamic_source is deliberately
    // not one of the fields versions must agree on.
    const dynamicSource = shown.dynamic_source ? sourceById.get(shown.dynamic_source) : undefined
    const isDynamic = Boolean(shown.dynamic_source)
    // A percentage tariff is never dynamic (only billing_mode=energy can link
    // a fetched series), so its bands always apply.
    const usesPeriods = (series.billing_mode === 'energy' && !isDynamic)
        || series.billing_mode === 'percentage_of_energy'
    const isPercentageTariff = series.billing_mode === 'percentage_of_energy'
    const baseRate = shown.percentage_base_summary?.price_chf_per_kwh
        ? Number(shown.percentage_base_summary.price_chf_per_kwh)
        : null
    const pricingLabel = priceSummary(series, shown)
    const pricingTooltip = pricingTooltipFor(series, shown, dynamicSource)
    const notes = shown.notes?.trim()
    // Keep identity and the selected version together while inspecting prices.
    const redundantGridType = series.category === 'grid_fees' && series.energy_type === 'grid'
    const meta = [
        t(`pages.tariffs.categories.${series.category}` as Parameters<typeof t>[0]),
        series.energy_type && !redundantGridType && t(`pages.tariffs.energyTypes.${series.energy_type}` as Parameters<typeof t>[0]),
    ].filter(Boolean).join(' · ')

    const dateWindow = (version: TariffVersion) => `${formatShortDate(version.valid_from, settings)} – ${
        version.valid_to ? formatShortDate(version.valid_to, settings) : t('pages.tariffs.openEnded')}`

    const failedFetch = dynamicSource?.last_fetch_status === 'failed' && (
        <span
            className="badge badge-danger"
            title={t('pages.tariffs.dynamicFetchFailedTooltip', { error: dynamicSource.last_fetch_error })}
        >
            <FontAwesomeIcon icon={faTriangleExclamation} fixedWidth />{' '}
            {t('pages.tariffs.dynamicFetchFailed')}
        </span>
    )

    const statusLabel = (version: TariffVersion) => t(validityState(version, today) === 'active'
        ? 'pages.tariffs.workspace.current'
        : validityState(version, today) === 'scheduled'
            ? 'pages.tariffs.overview.upcoming'
            : 'pages.tariffs.versions.statusEnded')
    const versionContext = <>{meta}<span className="tariff-pane-window">
        <span className={`badge ${shownState === 'scheduled' ? 'badge-brand' : 'badge-neutral'}`}>{statusLabel(shown)}</span>
        {dateWindow(shown)}
    </span></>

    if (editor) {
        return (
            <TariffPaneFrame title={series.name} subtitle={versionContext} onClose={onClose} onBack={onBack} onEscape={onEscape} titleRef={titleRef} backLabel={t('pages.tariffs.workspace.backToTariff')}>
                <div className="tariff-pane-body page-stack"><h3 className="tariff-editor-title">{editor.label}</h3>{editor.content}</div>
            </TariffPaneFrame>
        )
    }

    return (
        <TariffPaneFrame
            title={series.name}
            subtitle={versionContext}
            notice={failedFetch || undefined}
            onClose={onClose}
            onBack={onBack}
            onEscape={onEscape}
            titleRef={titleRef}
            actions={!readOnly && (
                <ActionMenu
                        label={t('common.actions')}
                        icon={<FontAwesomeIcon icon={faEllipsisVertical} fixedWidth />}
                        iconOnly
                        actionKey="series-actions"
                        items={[
                            { key: 'rename', label: t('pages.tariffs.versions.rename'), icon: <FontAwesomeIcon icon={faTag} fixedWidth />, onClick: () => onRenameSeries(series, shown) },
                            { key: 'duplicate', label: t('pages.tariffs.versions.duplicate'), icon: <FontAwesomeIcon icon={faClone} fixedWidth />, onClick: () => onDuplicate(series, shown) },
                            { key: 'delete', label: t('pages.tariffs.versions.deleteVersion'), icon: <FontAwesomeIcon icon={faTrash} fixedWidth />, danger: true, disabled: deleteTariffDisabled, onClick: () => onDeleteTariff(shown) },
                        ]}
                />
            )}
        >
            <div className="tariff-pane-body page-stack">
                {!readOnly && (
                    <div className="tariff-pane-actions">
                        <button className="button button-primary button-compact" type="button" data-action-key="new-version" onClick={() => onNewVersion(series, shown)}>
                            <FontAwesomeIcon icon={faPlus} fixedWidth />{t('pages.tariffs.versions.schedule')}
                        </button>
                        <button className="button button-secondary button-compact" type="button" data-action-key={`edit-${shown.id}`} onClick={() => onEditTariff(shown, `edit-${shown.id}`)}>
                            <FontAwesomeIcon icon={faPen} fixedWidth />{t('pages.tariffs.workspace.correct')}
                        </button>
                    </div>
                )}
                {usesPeriods && shown.periods.length === 0 && (
                    <Notice tone="warning">
                        <strong>{t('pages.tariffs.workspace.incomplete')}</strong>
                        <p>{t('pages.tariffs.workspace.incompleteBody')}</p>
                        {!readOnly && <button type="button" className="button button-secondary button-compact" data-action-key="add-first-price" onClick={() => onOpenCreatePeriod(shown.id)}>{t('pages.tariffs.workspace.addFirstPrice')}</button>}
                    </Notice>
                )}
                {!usesPeriods && !isDynamic && <p className="tariff-version-card-price" title={pricingTooltip}>{pricingLabel}</p>}

                {series.gaps.length > 0 && (
                    <div className="tariff-gap-warning">
                        <FontAwesomeIcon icon={faTriangleExclamation} fixedWidth />
                        <div>
                            <strong>{t('pages.tariffs.versions.gapWarningTitle')}</strong>
                            <p>
                                {series.gaps.map((gap) => (
                                    `${formatShortDate(gap.start, settings)} – ${formatShortDate(gap.end, settings)}`
                                )).join(', ')}
                            </p>
                            <p className="muted">{t('pages.tariffs.versions.gapWarningBody')}</p>
                            {!readOnly && series.gaps.map((gap) => (
                                <button key={gap.start} type="button" className="button button-secondary button-compact" onClick={() => {
                                    const source = [...versions].filter((version) => version.valid_from < gap.start).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]
                                    onNewVersion(series, source, gap.start)
                                }}>{t('pages.tariffs.workspace.fillGap', { from: formatShortDate(gap.start, settings), to: formatShortDate(gap.end, settings) })}</button>
                            ))}
                        </div>
                    </div>
                )}

                {isDynamic && (
                    <section className="tariff-source-section">
                        <h3>{t('pages.tariffs.workspace.dynamicPrice')}</h3>
                        <strong>{dynamicAverageLabel(shown)}</strong>
                        {shown.dynamic_price_summary?.reference_from && shown.dynamic_price_summary.reference_to && (
                            <p className="muted tariff-period-meta">{t('pages.tariffs.workspace.referencePeriod', {
                                from: formatShortDate(shown.dynamic_price_summary.reference_from, settings),
                                to: formatShortDate(shown.dynamic_price_summary.reference_to, settings),
                            })}</p>
                        )}
                    </section>
                )}
                {dynamicSource && (
                    <section className="tariff-source-section">
                        <h3>{t('pages.tariffs.pane.dynamicSource')}</h3>
                        <DynamicSourceSummary source={dynamicSource} settings={settings} canOperate={user?.role === 'admin'} />
                    </section>
                )}

                {notes && <p className="tariff-version-card-notes">{notes}</p>}

                {usesPeriods && (
                    <section className="tariff-period-section">
                        <div className="tariff-period-section-header">
                            <h3>{t('pages.tariffs.pane.prices')}</h3>
                            {!readOnly && (
                                <button
                                    className="button button-ghost button-compact"
                                    type="button"
                                    data-action-key="add-period"
                                    onClick={() => onOpenCreatePeriod(shown.id)}
                                >
                                    <FontAwesomeIcon icon={faPlus} fixedWidth />
                                    {t('pages.tariffs.addPeriod')}
                                </button>
                            )}
                        </div>

                        {shown.periods.length === 0 ? (
                            <p className="muted tariff-period-empty">{t('pages.tariffs.noPeriods')}</p>
                        ) : (
                            <table className="tariff-pane-table tariff-period-table" aria-label={t('pages.tariffs.tariffPeriods')}>
                                <thead>
                                    <tr>
                                        <th scope="col">{t('pages.tariffs.rateCard.applies')}</th>
                                        <th scope="col" className="numeric">{isPercentageTariff ? '%' : t('pages.tariffs.chfPerKwh')}</th>
                                        {!readOnly && <th scope="col" className="tariff-pane-table-action"><span className="visually-hidden">{t('common.actions')}</span></th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {shown.periods.map((period) => {
                                        const name = bandName(period, t(`pages.tariffs.periodTypes.${period.period_type}` as Parameters<typeof t>[0], { defaultValue: period.period_type }))
                                        const window = period.period_type === 'flat' ? t('pages.tariffs.allDay')
                                            : bandWindow(period) || t('pages.tariffs.rateCard.noTimeWindow')
                                        return (
                                            <tr key={period.id} className="tariff-period-row">
                                                <td>
                                                    <strong className="tariff-period-name">{name}</strong>
                                                    <div className="muted tariff-period-meta">
                                                        {[
                                                            name === window ? null : window,
                                                            formatWeekdays(period.weekdays, dayNames),
                                                            formatSeason(period.months, monthNames),
                                                        ].filter(Boolean).join(' · ')}
                                                    </div>
                                                </td>
                                                <td className="numeric tariff-period-price">
                                                    {isPercentageTariff ? (
                                                        <>
                                                            <strong>{period.percentage} %</strong>
                                                            {baseRate != null && period.percentage != null && (
                                                                <div className="muted tariff-period-meta">
                                                                    {t('pages.tariffs.approxPrice', { price: (baseRate * Number(period.percentage) / 100).toFixed(3) })}
                                                                </div>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <strong>{period.price_chf_per_kwh != null ? kwhPrice.format(Number(period.price_chf_per_kwh)) : '—'}</strong>
                                                    )}
                                                </td>
                                                {!readOnly && (
                                                    <td className="tariff-pane-table-action">
                                                        <button
                                                            type="button"
                                                            className="button button-ghost button-icon button-compact"
                                                            data-action-key={`edit-period-${period.id}`}
                                                            onClick={() => onEditPeriod(period, `edit-period-${period.id}`)}
                                                            aria-label={`${t('common.edit')}: ${name}`}
                                                            title={t('common.edit')}
                                                        >
                                                            <FontAwesomeIcon icon={faPen} fixedWidth />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="button button-ghost button-icon button-compact tariff-delete-button"
                                                            aria-label={`${t('common.delete')}: ${name}`}
                                                            title={t('common.delete')}
                                                            disabled={deletePeriodDisabled}
                                                            onClick={() => onDeletePeriod(period)}
                                                        >
                                                            <FontAwesomeIcon icon={faTrash} fixedWidth />
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        )}
                    </section>
                )}

                {versions.length > 1 && (
                    <section className="tariff-version-section">
                        <h3>{t('pages.tariffs.versions.history')}</h3>
                        <table className="tariff-pane-table tariff-version-table" aria-label={t('pages.tariffs.versions.history')}>
                                <thead>
                                    <tr>
                                        <th scope="col">{t('pages.tariffs.rateCard.valid')}</th>
                                        <th scope="col" className="numeric">{t('pages.tariffs.pane.price')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {versions.map((version) => (
                                        <tr key={version.id} className={`tariff-version-row${version.id === shown.id ? ' is-shown' : ''}${validityState(version, today) === 'expired' ? ' is-ended' : ''}`}>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="tariff-version-select"
                                                    aria-pressed={version.id === shown.id}
                                                    onClick={() => onShowVersion(version.id)}
                                                >
                                                    <span className="tariff-version-status">{statusLabel(version)}</span>
                                                    <span className="tariff-version-window">{dateWindow(version)}</span>
                                                </button>
                                            </td>
                                            <td className="numeric"><strong title={priceSummary(series, version)}>{version.dynamic_source ? dynamicAverageLabel(version) : priceSummary(series, version)}</strong></td>
                                        </tr>
                                    ))}
                                </tbody>
                        </table>
                    </section>
                )}

                {isDynamic ? dynamicSource && (
                    <section className="tariff-chart-section" aria-label={t('pages.tariffs.priceHistory.title')}>
                        <h3>{t('pages.tariffs.priceHistory.title')}</h3>
                        <DynamicPriceHistoryPanel key={shown.id} source={dynamicSource} tariff={shown} compact />
                    </section>
                ) || (sourcesQuery.isLoading
                    ? <p className="muted">{t('common.loading')}</p>
                    : <Notice tone="error" onRetry={() => void sourcesQuery.refetch()}>{t('pages.dynamicSources.loadError')}</Notice>
                ) : <TariffPriceHistoryChart series={series} allSeries={allSeries} settings={settings} />}
            </div>
        </TariffPaneFrame>
    )
}
