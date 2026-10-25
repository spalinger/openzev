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
import { sharedTariffNotes } from './notes'
import { bandNeedingReview, missingBandTimes } from './bandDrafts'
import { TariffBandCoverage } from './TariffBandCoverage'
import { useTariffDisplay } from './useTariffDisplay'
import { listedVersion, validityState } from './validity'
import { TariffPriceHistoryChart } from './TariffPriceHistoryChart'
import { DynamicPriceHistoryPanel } from './DynamicPriceHistoryModal'
import { DynamicSourceSummary } from './DynamicSourceSummary'
import { useAuth } from '../../lib/auth'
import type { TariffEditField, TariffPeriodEditField } from './useTariffEditor'

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
    onEditTariff: (tariff: TariffVersion, actionKey: string, field?: TariffEditField) => void
    onDeleteTariff: (tariff: TariffVersion) => void
    onOpenCreatePeriod: (tariffId: string, actionKey: string) => void
    onEditPeriod: (period: TariffPeriod, actionKey: string, field?: TariffPeriodEditField) => void
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
    const { sourceById, sourcesQuery, rateLines } = useTariffDisplay(settings)

    const versions = series.versions
    const sharedNotes = sharedTariffNotes(series)
    const shown = versions.find((version) => version.id === shownVersionId)
        ?? listedVersion(versions, today)

    // A series can switch between static and dynamic pricing at a version boundary.
    const dynamicSource = shown.dynamic_source ? sourceById.get(shown.dynamic_source) : undefined
    const isDynamic = Boolean(shown.dynamic_source)
    const versionListId = useId()

    function versionActions(version: TariffVersion): ActionMenuItem[] {
        const actionKey = `version-actions-${version.id}`
        const usesBands = (series.billing_mode === 'energy' && !version.dynamic_source)
            || series.billing_mode === 'percentage_of_energy'
        const bands = usesBands ? version.periods : []
        const deletionSection = t('common.delete')
        return [
            { key: 'edit-dates', label: t('pages.tariffs.workspace.editValidity'),
                icon: <FontAwesomeIcon icon={faPen} fixedWidth />,
                onClick: () => onEditTariff(version, actionKey, 'valid_from') },
            ...(!usesBands && !version.dynamic_source ? [{ key: 'edit-price', label: t('pages.tariffs.workspace.editPrice'),
                icon: <FontAwesomeIcon icon={faPen} fixedWidth />,
                onClick: () => onEditTariff(version, actionKey, 'fixed_price_chf') }] : []),
            ...(['shared_monthly_fee', 'shared_yearly_fee'].includes(series.billing_mode) ? [{ key: 'edit-basis', label: t('pages.tariffs.workspace.editNamed', { name: t('pages.tariffs.form.splitKey') }),
                icon: <FontAwesomeIcon icon={faPen} fixedWidth />,
                onClick: () => onEditTariff(version, actionKey, 'split_key') }] : []),
            { key: 'edit-notes', label: t('pages.tariffs.workspace.editNamed', { name: t('pages.tariffs.form.notes') }),
                icon: <FontAwesomeIcon icon={faPen} fixedWidth />,
                onClick: () => onEditTariff(version, actionKey, 'notes') },
            ...(usesBands ? [{ key: 'add-period', label: t(version.periods.length ? 'pages.tariffs.addPeriod' : 'pages.tariffs.ux.addPrices'),
                icon: <FontAwesomeIcon icon={faPlus} fixedWidth />,
                onClick: () => onOpenCreatePeriod(version.id, actionKey) }] : []),
            ...bands.map(period => {
                const name = bandName(period, t(`pages.tariffs.periodTypes.${period.period_type}`))
                return { key: `edit-${period.id}`, label: t('pages.tariffs.workspace.editBand', { band: name }),
                    icon: <FontAwesomeIcon icon={faPen} fixedWidth />,
                    onClick: () => onEditPeriod(period, actionKey, series.billing_mode === 'percentage_of_energy' ? 'percentage' : 'price_chf_per_kwh') }
            }),
            ...bands.map(period => ({
                key: `delete-${period.id}`, label: t('pages.tariffs.workspace.deleteNamed', { name: bandName(period, t(`pages.tariffs.periodTypes.${period.period_type}`)) }),
                section: deletionSection, danger: true, disabled: deletePeriodDisabled,
                icon: <FontAwesomeIcon icon={faTrash} fixedWidth />, onClick: () => onDeletePeriod(period),
            })),
            { key: 'delete', label: t('pages.tariffs.versions.deleteVersion'), section: deletionSection,
                danger: true, disabled: deleteTariffDisabled, icon: <FontAwesomeIcon icon={faTrash} fixedWidth />,
                onClick: () => onDeleteTariff(version) },
        ]
    }

    function dynamicHistory() {
        if (!isDynamic) return null
        if (dynamicSource) return <section className="tariff-chart-section" aria-label={t('pages.tariffs.priceHistory.title')}>
            <h3>{t('pages.tariffs.priceHistory.title')}</h3>
            <DynamicPriceHistoryPanel key={shown.id} source={dynamicSource} tariff={shown} compact />
        </section>
        if (sourcesQuery.isLoading) return <p className="muted">{t('common.loading')}</p>
        if (sourcesQuery.isError) return <Notice tone="error" onRetry={() => void sourcesQuery.refetch()}>{t('pages.dynamicSources.loadError')}</Notice>
        return <Notice tone="warning">{t('pages.tariffs.workspace.sourceUnavailable')}</Notice>
    }

    return (
        <div className="tariff-detail page-stack">
            <section className="tariff-version-section">
                <div className="tariff-version-list tariff-version-table" role="region"
                    aria-label={t('pages.tariffs.versions.history')}>
                    <div className="tariff-version-columns" aria-hidden="true">
                        <span>{t('pages.tariffs.rateCard.period')}</span>
                        <span className="tariff-version-price-heading">
                            <span>{t('pages.tariffs.rateCard.applies')}</span>
                            <span>{t('pages.tariffs.rateCard.price')}</span>
                            <span>{t('pages.tariffs.rateCard.unit')}</span>
                        </span>
                        <span />
                    </div>
                    {versions.map((version) => {
                        const usesBands = (series.billing_mode === 'energy' && !version.dynamic_source)
                            || series.billing_mode === 'percentage_of_energy'
                        const bandToReview = usesBands ? bandNeedingReview(version.periods, version) : undefined
                        const state = validityState(version, today)
                        const dates = `${formatShortDate(version.valid_from, settings)} – ${version.valid_to ? formatShortDate(version.valid_to, settings) : t('pages.tariffs.openEnded')}`
                        const dateLabel = <span className="tariff-version-context">
                            <span id={`${versionListId}-${version.id}`} className="tariff-version-window">
                                <span>{formatShortDate(version.valid_from, settings)}</span>{' – '}
                                <span>{version.valid_to ? formatShortDate(version.valid_to, settings) : t('pages.tariffs.openEnded')}</span>
                            </span>
                            {state === 'scheduled' && <span className="tariff-future-icon" role="img"
                                aria-label={t('pages.tariffs.overview.upcoming')} title={t('pages.tariffs.overview.upcoming')}>
                                <FontAwesomeIcon icon={faClock} fixedWidth aria-hidden="true" />
                            </span>}
                        </span>
                        return (
                            <div key={version.id} role="group" aria-labelledby={`${versionListId}-${version.id}`}
                                className={`tariff-version-row${version.id === shown.id ? ' is-shown' : ''}${state === 'expired' ? ' is-ended' : ''}`}
                            >
                                <div className="tariff-version-validity">
                                    {readOnly ? dateLabel : <button type="button" className="tariff-version-select tariff-text-edit"
                                        data-action-key={`edit-${version.id}`}
                                        aria-label={`${t('pages.tariffs.workspace.editValidity')}: ${dates}`} title={t('pages.tariffs.workspace.editValidity')}
                                        onClick={() => onEditTariff(version, `edit-${version.id}`, 'valid_from')}>
                                        {dateLabel}
                                        <FontAwesomeIcon icon={faPen} fixedWidth className="tariff-text-edit-icon" aria-hidden="true" />
                                    </button>}
                                </div>
                                <div className="tariff-version-price-column">
                                    <div className="tariff-version-prices">
                                        {(!usesBands || version.periods.length > 0) && rateLines(series, version).map((line, index) => {
                                            const period = usesBands ? version.periods[index] : undefined
                                            const actionKey = period ? `edit-period-${period.id}` : `edit-price-${version.id}`
                                            const editable = !readOnly && (period || (!usesBands && !version.dynamic_source))
                                            const name = period
                                                ? bandName(period, t(`pages.tariffs.periodTypes.${period.period_type}` as Parameters<typeof t>[0], { defaultValue: period.period_type }))
                                                : t('pages.tariffs.pane.price')
                                            const editPrice = (key: string) => period
                                                ? onEditPeriod(period, key, series.billing_mode === 'percentage_of_energy' ? 'percentage' : 'price_chf_per_kwh')
                                                : onEditTariff(version, key, 'fixed_price_chf')
                                            const sharedFee = series.billing_mode === 'shared_monthly_fee' || series.billing_mode === 'shared_yearly_fee'
                                            return <div key={period?.id ?? index} className="tariff-version-rate" data-band-label={!!line.label || undefined} role="group" aria-label={name}>
                                                <span className="tariff-version-applies">
                                                    <span className="visually-hidden">{t('pages.tariffs.rateCard.applies')}: </span>
                                                    {!readOnly && (period || sharedFee) ? <button type="button" className="tariff-value-edit tariff-text-edit"
                                                        data-action-key={`edit-applies-${period?.id ?? version.id}`} title={t('common.edit')} aria-label={t('pages.tariffs.workspace.editNamed', { name: line.applies })}
                                                        onClick={() => period ? onEditPeriod(period, `edit-applies-${period.id}`, 'period_type') : onEditTariff(version, `edit-applies-${version.id}`, 'split_key')}>
                                                        <span className="tariff-rate-full">{line.applies}</span>
                                                        {line.label && <span className="tariff-rate-name">{line.label}</span>}
                                                        <FontAwesomeIcon icon={faPen} fixedWidth className="tariff-text-edit-icon" aria-hidden="true" />
                                                    </button> : <><span className="tariff-rate-full">{line.applies}</span>{line.label && <span className="tariff-rate-name">{line.label}</span>}</>}
                                                </span>
                                                {line.schedule && <span className="tariff-rate-schedule">{line.schedule}</span>}
                                                {line.price && <>
                                                    <span className="tariff-version-amount">
                                                        <span className="visually-hidden">{t('pages.tariffs.rateCard.price')}: </span>
                                                        {editable ? <button type="button" className="tariff-value-edit tariff-text-edit"
                                                            data-action-key={actionKey} title={t('common.edit')} aria-label={t('pages.tariffs.workspace.editNamed', { name: `${name}, ${line.price}` })}
                                                            aria-describedby={`${versionListId}-${version.id}`}
                                                            onClick={() => editPrice(actionKey)}>
                                                            <FontAwesomeIcon icon={faPen} fixedWidth className="tariff-text-edit-icon" aria-hidden="true" />
                                                            <strong>{line.price}</strong>
                                                        </button>
                                                            : <strong>{line.price}</strong>}
                                                    </span>
                                                    <span className="tariff-version-unit"><span className="visually-hidden">{t('pages.tariffs.rateCard.unit')}: </span>{line.unit}</span>
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
                                {usesBands && version.periods.length > 0 && <div className="tariff-version-coverage">
                                    <TariffBandCoverage bands={version.periods} validity={version} warningsOnly />
                                    {bandToReview && !readOnly && <button type="button" className="button button-secondary button-compact"
                                        data-action-key={`repair-version-${version.id}`}
                                        onClick={() => onEditPeriod(bandToReview, `repair-version-${version.id}`, bandToReview.period_type === 'flat' ? 'period_type' : missingBandTimes(bandToReview)[0] ?? 'time_from')}>
                                        <FontAwesomeIcon icon={faPen} fixedWidth />{t('pages.tariffs.ux.reviewWindow')}
                                    </button>}
                                </div>}
                                {!sharedNotes && version.notes?.trim() && <p className="tariff-version-note">
                                    <span className="visually-hidden">{t('pages.tariffs.form.notes')}: </span>
                                    {readOnly ? version.notes.trim() : <button type="button" className="tariff-value-edit tariff-text-edit"
                                        data-action-key={`edit-notes-${version.id}`} title={t('pages.tariffs.workspace.editNamed', { name: t('pages.tariffs.form.notes') })}
                                        onClick={() => onEditTariff(version, `edit-notes-${version.id}`, 'notes')}>
                                        {version.notes.trim()}<FontAwesomeIcon icon={faPen} fixedWidth className="tariff-text-edit-icon" aria-hidden="true" />
                                    </button>}
                                </p>}
                            </div>
                        )
                    })}
                </div>
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

            {versions.length > 1 && versions.some(version => version.dynamic_source) && <label className="tariff-history-version">
                <span>{t('pages.tariffs.priceHistory.title')} · {t('pages.tariffs.rateCard.period')}</span>
                <select value={shown.id} onChange={event => onShowVersion(event.target.value)}>
                    {versions.map(version => <option key={version.id} value={version.id}>{formatShortDate(version.valid_from, settings)} – {version.valid_to ? formatShortDate(version.valid_to, settings) : t('pages.tariffs.openEnded')}</option>)}
                </select>
            </label>}
            {dynamicSource && (
                <section className="tariff-source-section">
                    <h3>{t('pages.tariffs.pane.dynamicSource')}</h3>
                    <DynamicSourceSummary source={dynamicSource} settings={settings} canOperate={user?.role === 'admin'} />
                </section>
            )}
            {dynamicHistory()}

            {!isDynamic && <TariffPriceHistoryChart series={series} allSeries={allSeries} settings={settings} />}
        </div>
    )
}

/**
 * Tariff-wide actions stay beside its identity, separate from version actions.
 * The strip stretches to the row's right edge, so it must not swallow clicks:
 * the row's own handler ignores buttons and toggles everywhere else.
 */
export function TariffSeriesActions({ series, versionId, onRename, onDuplicate, onNewVersion }: {
    series: TariffSeries
    versionId: string
    onRename: (version: TariffVersion) => void
    onDuplicate: (version: TariffVersion) => void
    onNewVersion: (version: TariffVersion) => void
}) {
    const { t } = useTranslation()
    const shown = series.versions.find(version => version.id === versionId) ?? series.versions[0]
    const scheduleSource = listedVersion(series.versions, todayBusinessIso())
    return <span className="tariff-series-actions">
        <button className="button button-secondary button-compact tariff-schedule-action" type="button" data-action-key="new-version" onClick={() => onNewVersion(scheduleSource)}>
            <FontAwesomeIcon icon={faPlus} fixedWidth />{t('pages.tariffs.versions.schedule')}
        </button>
        <ActionMenu label={`${t('common.actions')}: ${series.name}`} icon={<FontAwesomeIcon icon={faEllipsisVertical} fixedWidth />} iconOnly
            actionKey="series-actions" items={[
                { key: 'rename', label: t('pages.tariffs.pane.task.rename'), icon: <FontAwesomeIcon icon={faPen} fixedWidth />, onClick: () => onRename(shown) },
                { key: 'duplicate', label: t('pages.tariffs.versions.duplicate'), icon: <FontAwesomeIcon icon={faClone} fixedWidth />, onClick: () => onDuplicate(shown) },
            ]} />
    </span>
}
