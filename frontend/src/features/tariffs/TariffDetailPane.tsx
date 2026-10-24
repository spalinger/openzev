import { useId, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
    faArrowLeft,
    faClone,
    faClock,
    faEllipsisVertical,
    faPen,
    faPlus,
    faTrash,
    faTriangleExclamation,
    faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { Notice } from '../../components/Notice'
import { ActionMenu, type ActionMenuItem } from '../../components/ActionMenu'
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
    /** One quiet line under the title. */
    subtitle?: ReactNode
    /** Every exit closes only the focused task. */
    onClose: () => void
    /** The title is where focus lands when the pane is opened on purpose. */
    titleRef?: Ref<HTMLHeadingElement>
    backLabel?: string
    children: ReactNode
}

/**
 * Focused task panel; the tariff stays expanded in the list beside it.
 * Non-modal, with the existing draft guard owning all exits.
 */
export function TariffPaneFrame({ title, subtitle, onClose, titleRef, backLabel, children }: TariffPaneFrameProps) {
    const { t } = useTranslation()
    const titleId = useId()

    function onKeyDown(event: KeyboardEvent<HTMLElement>) {
        // A menu or picker inside the pane takes the Escape that dismisses it.
        if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault()
            onClose()
        }
    }

    return (
        <section className="tariff-pane" aria-labelledby={titleId} onKeyDown={onKeyDown}>
            <button type="button" className="button button-ghost tariff-pane-back" onClick={onClose}>
                <FontAwesomeIcon icon={faArrowLeft} fixedWidth />{backLabel ?? t('pages.tariffs.workspace.back')}
            </button>
            <header className="tariff-pane-header">
                <div className="tariff-pane-heading">
                    <div className="tariff-pane-title">
                        <h2 id={titleId} ref={titleRef} tabIndex={-1}>{title}</h2>
                    </div>
                    {subtitle && <p className="tariff-pane-meta">{subtitle}</p>}
                </div>
                <div className="tariff-pane-header-actions">
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

type TariffDetailProps = {
    series: TariffSeries
    /** Every series in scope — percentage tariffs derive their price from the grid ones. */
    allSeries: TariffSeries[]
    settings: AppSettings
    /** The version within `series` currently shown, defaulting to the one in force. */
    shownVersionId: string | null
    onShowVersion: (versionId: string) => void
    deleteTariffDisabled: boolean
    deletePeriodDisabled: boolean
    onEditTariff: (tariff: TariffVersion, actionKey: string) => void
    onDeleteTariff: (tariff: TariffVersion) => void
    onOpenCreatePeriod: (tariffId: string, actionKey: string) => void
    onEditPeriod: (period: TariffPeriod, actionKey: string) => void
    onDeletePeriod: (period: TariffPeriod) => void
    onNewVersion: (series: TariffSeries, source: TariffVersion, validFrom?: string) => void
    /** A viewer reads only (#761): no version, edit, rename, duplicate, delete or band changes. */
    readOnly?: boolean
}

/** Full tariff details stay in the expanded row; actions open a separate task. */
export function TariffDetail({
    series,
    allSeries,
    settings,
    shownVersionId,
    onShowVersion,
    deleteTariffDisabled,
    deletePeriodDisabled,
    onEditTariff,
    onDeleteTariff,
    onOpenCreatePeriod,
    onEditPeriod,
    onDeletePeriod,
    onNewVersion,
    readOnly = false,
}: TariffDetailProps) {
    const { t } = useTranslation()
    const { user } = useAuth()
    const today = todayBusinessIso()
    const { sourceById, sourcesQuery, rateLines } = useTariffDisplay(settings, today)

    const versions = series.versions
    const shown = versions.find((version) => version.id === shownVersionId)
        ?? listedVersion(versions, today)

    // Checked on the shown *version*, not the series: a series can hold both a
    // static and a dynamic version (an operator switching to dynamic pricing
    // at a version boundary, ADR 0018) since dynamic_source is deliberately
    // not one of the fields versions must agree on.
    const dynamicSource = shown.dynamic_source ? sourceById.get(shown.dynamic_source) : undefined
    const isDynamic = Boolean(shown.dynamic_source)
    const versionListId = useId()

    function versionActions(version: TariffVersion): ActionMenuItem[] {
        const actionKey = `version-actions-${version.id}`
        const usesBands = (series.billing_mode === 'energy' && !version.dynamic_source)
            || series.billing_mode === 'percentage_of_energy'
        return [
            ...(usesBands ? version.periods : []).map((period, index) => {
                const name = bandName(period, t(`pages.tariffs.periodTypes.${period.period_type}` as Parameters<typeof t>[0], { defaultValue: period.period_type }))
                return { key: `delete-${period.id}`, label: `${t('common.delete')}: ${name}`,
                    section: index === 0 ? t('pages.tariffs.pane.price') : undefined, danger: true, disabled: deletePeriodDisabled,
                    icon: <FontAwesomeIcon icon={faTrash} fixedWidth />, onClick: () => onDeletePeriod(period) }
            }),
            ...(usesBands ? [{ key: 'add-period', label: t(version.periods.length ? 'pages.tariffs.addPeriod' : 'pages.tariffs.ux.addPrices'),
                icon: <FontAwesomeIcon icon={faPlus} fixedWidth />,
                onClick: () => onOpenCreatePeriod(version.id, actionKey) }] : []),
            { key: 'delete', label: t('pages.tariffs.versions.deleteVersion'), section: t('pages.tariffs.rateCard.period'),
                danger: true, disabled: deleteTariffDisabled, icon: <FontAwesomeIcon icon={faTrash} fixedWidth />,
                onClick: () => onDeleteTariff(version) },
        ]
    }

    return (
        <div className="tariff-detail page-stack">
            <section className="tariff-version-section">
                <div className="tariff-version-list tariff-version-table" role="region"
                    aria-label={t('pages.tariffs.versions.history')}>
                    {versions.map((version) => {
                        const usesBands = (series.billing_mode === 'energy' && !version.dynamic_source)
                            || series.billing_mode === 'percentage_of_energy'
                        const state = validityState(version, today)
                        const dates = `${formatShortDate(version.valid_from, settings)} – ${version.valid_to ? formatShortDate(version.valid_to, settings) : t('pages.tariffs.openEnded')}`
                        return (
                            <div key={version.id}
                                className={`tariff-version-row${version.id === shown.id ? ' is-shown' : ''}${state === 'expired' ? ' is-ended' : ''}`}
                            >
                                <div className="tariff-version-validity">
                                    <button type="button" className="tariff-version-select" aria-pressed={version.id === shown.id}
                                        aria-label={`${t('pages.tariffs.viewDetails')}: ${dates}`} title={t('pages.tariffs.viewDetails')}
                                        onClick={() => onShowVersion(version.id)}>
                                        <span className="tariff-version-context">
                                            {state === 'scheduled' && <span className="tariff-future-icon" role="img"
                                                aria-label={t('pages.tariffs.overview.upcoming')} title={t('pages.tariffs.overview.upcoming')}>
                                                <FontAwesomeIcon icon={faClock} fixedWidth aria-hidden="true" />
                                            </span>}
                                            <span id={`${versionListId}-${version.id}`} className="tariff-version-window">
                                                <span>{formatShortDate(version.valid_from, settings)}</span>{' – '}
                                                <span>{version.valid_to ? formatShortDate(version.valid_to, settings) : t('pages.tariffs.openEnded')}</span>
                                            </span>
                                        </span>
                                    </button>
                                    {version.notes?.trim() && <p className="tariff-version-note">{version.notes.trim()}</p>}
                                    {!readOnly && <button type="button" className="button button-ghost button-icon tariff-inline-edit"
                                        data-action-key={`edit-${version.id}`} aria-label={t('pages.tariffs.workspace.editValidity')}
                                        aria-describedby={`${versionListId}-${version.id}`} title={t('pages.tariffs.workspace.editValidity')}
                                        onClick={() => onEditTariff(version, `edit-${version.id}`)}>
                                        <FontAwesomeIcon icon={faPen} fixedWidth />
                                    </button>}
                                </div>
                                <div className="tariff-version-price-column">
                                    <div className="tariff-version-prices">
                                        {rateLines(series, version).map((line, index) => {
                                            const period = usesBands ? version.periods[index] : undefined
                                            const actionKey = period ? `edit-period-${period.id}` : `edit-price-${version.id}`
                                            const editable = !readOnly && (period || (!usesBands && !version.dynamic_source))
                                            const name = period
                                                ? bandName(period, t(`pages.tariffs.periodTypes.${period.period_type}` as Parameters<typeof t>[0], { defaultValue: period.period_type }))
                                                : t('pages.tariffs.pane.price')
                                            return <div key={period?.id ?? index} className="tariff-version-rate">
                                                <span className="tariff-version-applies">{line.applies}</span>
                                                {line.price && <>
                                                    <span className="tariff-version-amount">
                                                        <strong>{line.price}</strong>
                                                        {editable && <button type="button" className="button button-ghost button-icon tariff-inline-edit"
                                                            data-action-key={actionKey} aria-label={`${t('common.edit')}: ${name}`}
                                                            aria-describedby={`${versionListId}-${version.id}`} title={t('common.edit')}
                                                            onClick={() => period ? onEditPeriod(period, actionKey) : onEditTariff(version, actionKey)}>
                                                            <FontAwesomeIcon icon={faPen} fixedWidth />
                                                        </button>}
                                                    </span>
                                                    <span className="tariff-version-unit">{line.unit}</span>
                                                </>}
                                            </div>
                                        })}
                                    </div>
                                    {usesBands && version.periods.length === 0 && <div className="tariff-period-empty">
                                        <p>{t('pages.tariffs.workspace.incompleteBody')}</p>
                                        {!readOnly && <button type="button" className="button button-secondary button-compact"
                                            data-action-key={`add-period-${version.id}`}
                                            onClick={() => onOpenCreatePeriod(version.id, `add-period-${version.id}`)}>
                                            <FontAwesomeIcon icon={faPlus} fixedWidth />{t('pages.tariffs.ux.addPrices')}
                                        </button>}
                                    </div>}
                                </div>
                                {!readOnly && <div className="tariff-version-menu" onClick={event => event.stopPropagation()}>
                                    <ActionMenu label={`${t('common.actions')}: ${dates}`}
                                        icon={<FontAwesomeIcon icon={faEllipsisVertical} fixedWidth />} iconOnly
                                        actionKey={`version-actions-${version.id}`} items={versionActions(version)} />
                                </div>}
                            </div>
                        )
                    })}
                </div>
                {!readOnly && <div className="tariff-version-footer">
                    <button className="button button-secondary button-compact" type="button" data-action-key="new-version" onClick={() => onNewVersion(series, shown)}>
                        <FontAwesomeIcon icon={faPlus} fixedWidth />{t('pages.tariffs.versions.schedule')}
                    </button>
                </div>}
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
    )
}

/** The tariff-wide menu belongs to its identity, separate from version actions. */
export function TariffSeriesActions({ series, versionId, onRename, onDuplicate }: {
    series: TariffSeries
    versionId: string
    onRename: (version: TariffVersion) => void
    onDuplicate: (version: TariffVersion) => void
}) {
    const { t } = useTranslation()
    const shown = series.versions.find(version => version.id === versionId) ?? series.versions[0]
    return <span className="tariff-series-actions" onClick={event => event.stopPropagation()}>
        <ActionMenu label={`${t('common.actions')}: ${series.name}`} icon={<FontAwesomeIcon icon={faEllipsisVertical} fixedWidth />} iconOnly actionKey="series-actions"
            items={[
                { key: 'rename', label: t('pages.tariffs.pane.task.rename'), icon: <FontAwesomeIcon icon={faPen} fixedWidth />, onClick: () => onRename(shown) },
                { key: 'duplicate', label: t('pages.tariffs.versions.duplicate'), icon: <FontAwesomeIcon icon={faClone} fixedWidth />, onClick: () => onDuplicate(shown) },
            ]} />
    </span>
}
