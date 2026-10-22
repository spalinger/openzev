import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
    faArrowLeft,
    faClone,
    faEllipsisVertical,
    faPen,
    faPlus,
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
import { bandName } from './bands'
import { useTariffDisplay } from './useTariffDisplay'
import { listedVersion, validityState } from './validity'
import { TariffPriceHistoryChart } from './TariffPriceHistoryChart'
import { DynamicPriceHistoryPanel } from './DynamicPriceHistoryModal'
import { DynamicSourceSummary } from './DynamicSourceSummary'
import { useAuth } from '../../lib/auth'

type TariffPaneFrameProps = {
    title: string
    titleAction?: ReactNode
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
export function TariffPaneFrame({ title, titleAction, subtitle, notice, onClose, onBack = onClose, onEscape = onClose, titleRef, actions, backLabel, children }: TariffPaneFrameProps) {
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
                    <div className="tariff-pane-title">
                        <h2 id={titleId} ref={titleRef} tabIndex={-1}>{title}</h2>
                        {titleAction}
                    </div>
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
    onOpenCreatePeriod: (tariffId: string, actionKey: string) => void
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
    editor?: { label: string, content: ReactNode, versionId?: string }
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
    const today = todayBusinessIso()
    const { sourceById, sourcesQuery, rateLines } = useTariffDisplay(settings, today)

    const versions = series.versions
    const shown = versions.find((version) => version.id === (editor?.versionId ?? shownVersionId))
        ?? listedVersion(versions, today)

    // Checked on the shown *version*, not the series: a series can hold both a
    // static and a dynamic version (an operator switching to dynamic pricing
    // at a version boundary, ADR 0018) since dynamic_source is deliberately
    // not one of the fields versions must agree on.
    const dynamicSource = shown.dynamic_source ? sourceById.get(shown.dynamic_source) : undefined
    const isDynamic = Boolean(shown.dynamic_source)
    const notes = shown.notes?.trim()
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
    const headerContext = <>{meta}{notes && <span className="tariff-version-card-notes">{notes}</span>}</>
    const versionListRef = useRef<HTMLDivElement>(null)
    const versionListId = useId()

    useEffect(() => {
        const list = versionListRef.current
        const focusedRow = list?.contains(document.activeElement)
            ? document.activeElement?.closest<HTMLElement>('.tariff-version-row') : null
        const selected = focusedRow ?? list?.querySelector<HTMLElement>('.is-shown')
        if (list && selected && list.scrollHeight > list.clientHeight) {
            const headingHeight = list.querySelector('thead')?.getBoundingClientRect().height ?? 0
            list.scrollTop += selected.getBoundingClientRect().top - list.getBoundingClientRect().top - headingHeight
        }
    }, [shown.id, versions.length, editor])

    const scheduleAction = !readOnly && (
        <button className="button button-primary button-compact" type="button" data-action-key="new-version" onClick={() => onNewVersion(series, shown)}>
            <FontAwesomeIcon icon={faPlus} fixedWidth />{t('pages.tariffs.versions.schedule')}
        </button>
    )

    if (editor) {
        return (
            <TariffPaneFrame title={series.name} subtitle={headerContext} onClose={onClose} onBack={onBack} onEscape={onEscape} titleRef={titleRef} backLabel={t('pages.tariffs.workspace.backToTariff')}>
                <div className="tariff-pane-body page-stack"><h3 className="tariff-editor-title">{editor.label}</h3>{editor.content}</div>
            </TariffPaneFrame>
        )
    }

    return (
        <TariffPaneFrame
            title={series.name}
            titleAction={!readOnly && (
                <button
                    type="button"
                    className="button button-ghost button-icon button-compact"
                    data-action-key="rename-series"
                    onClick={() => onRenameSeries(series, shown)}
                    aria-label={t('pages.tariffs.pane.task.rename')}
                    title={t('pages.tariffs.pane.task.rename')}
                >
                    <FontAwesomeIcon icon={faPen} fixedWidth />
                </button>
            )}
            subtitle={headerContext}
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
                        { key: 'duplicate', label: t('pages.tariffs.versions.duplicate'), icon: <FontAwesomeIcon icon={faClone} fixedWidth />, onClick: () => onDuplicate(series, shown) },
                    ]}
                />
            )}
        >
            <div className="tariff-pane-body page-stack">
                <section className="tariff-version-section">
                    <div ref={versionListRef} className="tariff-version-list" role="region" aria-label={t('pages.tariffs.versions.history')} tabIndex={versions.length > 5 ? 0 : undefined}>
                        <table className="tariff-pane-table tariff-version-table" aria-label={t('pages.tariffs.versions.history')}>
                            <thead>
                                <tr>
                                    <th scope="col">{t('pages.tariffs.rateCard.valid')}</th>
                                    <th scope="col" className="tariff-version-price-column">{t('pages.tariffs.pane.price')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {versions.map((version) => {
                                    const usesBands = (series.billing_mode === 'energy' && !version.dynamic_source)
                                        || series.billing_mode === 'percentage_of_energy'
                                    return (
                                        <tr
                                            key={version.id}
                                            className={`tariff-version-row${version.id === shown.id ? ' is-shown' : ''}${validityState(version, today) === 'expired' ? ' is-ended' : ''}`}
                                            onClick={(event) => {
                                                if (!(event.target as Element).closest('button')) onShowVersion(version.id)
                                            }}
                                        >
                                            <td className="tariff-version-validity">
                                                <button
                                                    type="button"
                                                    className="tariff-version-select"
                                                    aria-pressed={version.id === shown.id}
                                                    onClick={() => onShowVersion(version.id)}
                                                >
                                                    <span className="tariff-version-context">
                                                        <span className="tariff-version-status">{statusLabel(version)}</span>
                                                        <span id={`${versionListId}-${version.id}`} className="tariff-version-window">{dateWindow(version)}</span>
                                                    </span>
                                                </button>
                                                {!readOnly && (
                                                    <div className="tariff-version-actions">
                                                        <button
                                                            className="button button-ghost button-icon button-compact"
                                                            type="button"
                                                            data-action-key={`edit-${version.id}`}
                                                            onClick={() => onEditTariff(version, `edit-${version.id}`)}
                                                            aria-label={t('pages.tariffs.workspace.editVersion')}
                                                            aria-describedby={`${versionListId}-${version.id}`}
                                                            title={t('pages.tariffs.workspace.editVersion')}
                                                        >
                                                            <FontAwesomeIcon icon={faPen} fixedWidth />
                                                        </button>
                                                        <button
                                                            className="button button-ghost button-icon button-compact tariff-delete-button"
                                                            type="button"
                                                            data-action-key={`delete-version-${version.id}`}
                                                            disabled={deleteTariffDisabled}
                                                            onClick={() => onDeleteTariff(version)}
                                                            aria-label={t('pages.tariffs.versions.deleteVersion')}
                                                            aria-describedby={`${versionListId}-${version.id}`}
                                                            title={t('pages.tariffs.versions.deleteVersion')}
                                                        >
                                                            <FontAwesomeIcon icon={faTrash} fixedWidth />
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="tariff-version-price-column">
                                                <div className="tariff-version-prices">
                                                    {rateLines(series, version).map((line, index) => {
                                                        const period = usesBands ? version.periods[index] : undefined
                                                        const name = period
                                                            ? bandName(period, t(`pages.tariffs.periodTypes.${period.period_type}` as Parameters<typeof t>[0], { defaultValue: period.period_type }))
                                                            : t('pages.tariffs.pane.price')
                                                        return (
                                                            <div key={period?.id ?? index} className="tariff-version-rate">
                                                                <span className="tariff-version-applies">{line.applies}</span>
                                                                {line.price && <span className="tariff-version-amount">
                                                                    <strong>{line.price}</strong>{' '}
                                                                    <span className="tariff-version-unit">CHF {line.unit}</span>
                                                                </span>}
                                                                {!readOnly && (period || (!usesBands && !version.dynamic_source)) && (
                                                                    <div className="tariff-version-actions">
                                                                        <button
                                                                            type="button"
                                                                            className="button button-ghost button-icon button-compact"
                                                                            data-action-key={period ? `edit-period-${period.id}` : `edit-price-${version.id}`}
                                                                            onClick={() => period
                                                                                ? onEditPeriod(period, `edit-period-${period.id}`)
                                                                                : onEditTariff(version, `edit-price-${version.id}`)}
                                                                            aria-label={`${t('common.edit')}: ${name}`}
                                                                            aria-describedby={`${versionListId}-${version.id}`}
                                                                            title={t('common.edit')}
                                                                        >
                                                                            <FontAwesomeIcon icon={faPen} fixedWidth />
                                                                        </button>
                                                                        {period && <button
                                                                            type="button"
                                                                            className="button button-ghost button-icon button-compact tariff-delete-button"
                                                                            data-action-key={`delete-period-${period.id}`}
                                                                            aria-label={`${t('common.delete')}: ${name}`}
                                                                            aria-describedby={`${versionListId}-${version.id}`}
                                                                            title={t('common.delete')}
                                                                            disabled={deletePeriodDisabled}
                                                                            onClick={() => onDeletePeriod(period)}
                                                                        >
                                                                            <FontAwesomeIcon icon={faTrash} fixedWidth />
                                                                        </button>}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                                {usesBands && version.periods.length === 0 && (
                                                    <p className="tariff-period-empty">{t('pages.tariffs.workspace.incompleteBody')}</p>
                                                )}
                                                {!readOnly && usesBands && (
                                                    <button
                                                        className={`button ${version.periods.length === 0 ? 'button-secondary' : 'button-ghost'} button-compact tariff-version-add-band`}
                                                        type="button"
                                                        data-action-key={`add-period-${version.id}`}
                                                        aria-describedby={`${versionListId}-${version.id}`}
                                                        onClick={() => onOpenCreatePeriod(version.id, `add-period-${version.id}`)}
                                                    >
                                                        <FontAwesomeIcon icon={faPlus} fixedWidth />
                                                        {t(version.periods.length === 0 ? 'pages.tariffs.ux.addPrices' : 'pages.tariffs.addPeriod')}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                    {scheduleAction}
                </section>

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

                {isDynamic ? dynamicSource && (
                    <section className="tariff-chart-section" aria-label={t('pages.tariffs.priceHistory.title')}>
                        <h3>{t('pages.tariffs.priceHistory.title')}</h3>
                        <DynamicPriceHistoryPanel key={shown.id} source={dynamicSource} tariff={shown} compact />
                    </section>
                ) || (sourcesQuery.isLoading
                    ? <p className="muted">{t('common.loading')}</p>
                    : <Notice tone="error" onRetry={() => void sourcesQuery.refetch()}>{t('pages.dynamicSources.loadError')}</Notice>
                ) : null}
                {dynamicSource && (
                    <section className="tariff-source-section">
                        <h3>{t('pages.tariffs.pane.dynamicSource')}</h3>
                        <DynamicSourceSummary source={dynamicSource} settings={settings} canOperate={user?.role === 'admin'} />
                    </section>
                )}

                {!isDynamic && <TariffPriceHistoryChart series={series} allSeries={allSeries} settings={settings} />}
            </div>
        </TariffPaneFrame>
    )
}
