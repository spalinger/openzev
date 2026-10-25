import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleInfo } from '@fortawesome/free-solid-svg-icons'
import { ConfirmDialog, useConfirmDialog } from '../components/ConfirmDialog'
import { TariffOverview } from '../features/tariffs/TariffOverview'
import { TariffDetail, TariffPaneFrame, TariffSeriesActions } from '../features/tariffs/TariffDetailPane'
import { useTariffCrud } from '../features/tariffs/useTariffCrud'
import { TariffEmptyState } from '../features/tariffs/TariffEmptyState'
import { TariffForm } from '../features/tariffs/TariffForm'
import { VseTariffImportModal } from '../features/tariffs/VseTariffImportModal'
import { TariffPeriodForm } from '../features/tariffs/TariffPeriodForm'
import { TariffActions } from '../features/tariffs/TariffActions'
import { TariffVersionForm } from '../features/tariffs/TariffVersionForm'
import { useTariffVersions } from '../features/tariffs/useTariffVersions'
import { useTariffEditor } from '../features/tariffs/useTariffEditor'
import { useTariffPaneNavigation } from '../features/tariffs/useTariffPaneNavigation'
import { useDraftGuard } from '../features/tariffs/useDraftGuard'
import { tariffOverview } from '../features/tariffs/validity'
import { seriesKeyOf } from '../features/tariffs/selection'
import { tariffOverviewFilename, tariffOverviewParams, type TariffValidityFilter } from '../features/tariffs/tariffOverview'
import { fetchTariffSeries } from '../lib/api/tariffs'
import { downloadTariffOverview } from '../lib/api/invoices'
import { formatApiError } from '../lib/api/errors'
import { queryKeys } from '../lib/api/queryKeys'
import { todayBusinessIso } from '../lib/dates'
import { downloadBlob } from '../lib/downloadBlob'
import { formatShortDate, useAppSettings } from '../lib/appSettings'
import { useAuth } from '../lib/auth'
import { useManagedZev } from '../lib/managedZev'
import { useCommunityAccess, useScopeNote } from '../lib/communityAccess'
import { PageSkeleton } from '../components/PageSkeleton'
import { useTranslation } from 'react-i18next'
import { useToast } from '../lib/toast'
import type { TariffSeries, TariffVersion } from '../types/api'
import { PageHeader } from '../components/PageHeader'
import { Notice } from '../components/Notice'
import { ScopeGuard } from '../components/ScopeGuard'

export function TariffsPage() {
    const queryClient = useQueryClient()
    const { pushToast } = useToast()
    const { dialog, confirm, handleConfirm, handleCancel, isLoading: dialogLoading } = useConfirmDialog()
    const { user } = useAuth()
    const { settings } = useAppSettings()
    const { selectedZevId, selectedZev } = useManagedZev()
    const { t } = useTranslation()
    const scopeNote = useScopeNote()
    const { isZevScope, canWriteSelectedCommunity } = useCommunityAccess()
    const readOnly = !canWriteSelectedCommunity
    const scopeKey = `${selectedZevId ?? ''}|${readOnly}|${user?.id ?? ''}`
    const editing = useTariffEditor(scopeKey)
    const editor = editing.task?.kind ?? null
    const pendingTask = useRef<{ versionId: string; scopeKey: string; open: () => void } | null>(null)
    const [showImportModal, setShowImportModal] = useState(false)
    // Which group a tariff is in and what its row says both follow today's date.
    const today = todayBusinessIso()

    // Versions and bands derive from one scoped series query.
    const seriesQuery = useQuery({
        queryKey: queryKeys.tariffs.series(selectedZevId || undefined),
        queryFn: () => fetchTariffSeries(isZevScope ? selectedZevId || undefined : undefined),
        enabled: !!selectedZevId && selectedZev?.id === selectedZevId,
    })

    const allSeries = useMemo(
        () => (seriesQuery.data ?? []).filter(
            (series) => !isZevScope || series.zev === selectedZevId,
        ),
        [seriesQuery.data, isZevScope, selectedZevId],
    )

    const tariffs = useMemo<TariffVersion[]>(
        () => allSeries.flatMap((series) => series.versions),
        [allSeries],
    )

    const navigation = useTariffPaneNavigation({
        allSeries, today, scopeKey, editor,
        settled: seriesQuery.isSuccess && !seriesQuery.isFetching,
        onSelectionChange: (versionId) => {
            editing.close()
            const task = pendingTask.current
            pendingTask.current = null
            if (task?.versionId === versionId && task.scopeKey === scopeKey) task.open()
        },
        onScopeChange: () => {
            setShowImportModal(false)
            handleCancel()
            pendingTask.current = null
        },
    })
    const { pageRef, splitRef, paneTitleRef, openSeries, selected, paneOpen, listHidden, fitsTwoPanes, select, collapse } = navigation

    const periods = useMemo(
        () => allSeries.flatMap((series) => series.versions.flatMap((version) => version.periods)),
        [allSeries],
    )

    const tariffNameById = useMemo(() => {
        return new Map(tariffs.map((tariff) => [tariff.id, tariff.name]))
    }, [tariffs])

    // Energy and percentage-of-energy tariffs are the two modes that take
    // bands (§4.1); the band form's owner lookup needs the broader list.
    const bandableTariffs = useMemo(() => {
        return tariffs.filter((tariff) => tariff.billing_mode === 'energy' || tariff.billing_mode === 'percentage_of_energy')
    }, [tariffs])

    const overview = useMemo(() => tariffOverview(allSeries, today), [allSeries, today])

    const {
        tariffFormOpen,
        periodFormOpen,
        editingTariffId,
        editingPeriodId,
        periodTariffId,
        editingTariff,
        editingPeriod,
        saveError: crudSaveError,
        tariffPending,
        periodPending,
        deleteTariffPending,
        deletePeriodPending,
        submitTariff,
        submitPeriod,
        startTariffEdit,
        startPeriodEdit,
        openCreateTariff,
        openCreatePeriod,
        confirmDeleteTariff,
        confirmDeletePeriod,
    } = useTariffCrud({
        editing,
        settings,
        selectedZevId,
        canWrite: !readOnly,
        tariffs,
        periods,
        tariffNameById,
        queryClient,
        pushToast,
        confirm,
        t,
        // A new tariff is a new selection; a changed version stays in view.
        onTariffSaved: (saved) => select(saved, saved.id),
        onPeriodSaved: (tariffId) => {
            const version = tariffs.find((tariff) => tariff.id === tariffId)
            if (version) select(version, tariffId)
        },
    })

    const versions = useTariffVersions({
        editing,
        settings,
        selectedZevId,
        canWrite: !readOnly,
        queryClient,
        pushToast,
        t,
        // A new version, copy or name is selected in its expanded row.
        onSaved: (saved) => select(saved, saved.id),
    })

    const [formDirty, setFormDirty] = useState(false)
    const [sourcePending, setSourcePending] = useState(false)
    const saving = editor !== null && (tariffPending || periodPending || versions.isPending || sourcePending)
    const guard = useDraftGuard({
        dirty: editor !== null && formDirty,
        saving,
        confirm,
        bypass: navigation.bypassGuard,
    })

    const resetEditing = editing.close
    function beginEditing(actionKey: string, open: () => void) {
        navigation.editingFrom(actionKey)
        open()
    }

    // Creating from the header, over whatever is shown: the selection waits behind it.
    const createTariff = () => guard.run(() => {
        resetEditing()
        beginEditing('new-tariff', openCreateTariff)
    })

    // Expansion and task selection share the URL, but only tasks open the side panel.
    const showVersion = (series: Pick<TariffSeries, 'zev' | 'name'>, versionId: string) => {
        if (navigation.isSelecting(series, versionId)) return
        if (selected?.seriesKey === seriesKeyOf(series) && selected.versionId === versionId) return
        guard.run(() => {
            resetEditing()
            select(series, versionId)
        })
    }
    const closeDetail = (series: TariffSeries) => guard.run(() => {
        resetEditing()
        collapse(series)
    })
    const cancelEditing = () => guard.run(resetEditing)

    function editDetail(series: TariffSeries, versionId: string, actionKey: string, open: () => void) {
        guard.run(() => {
            resetEditing()
            if (selected?.seriesKey === seriesKeyOf(series) && selected.versionId === versionId) beginEditing(actionKey, open)
            else {
                pendingTask.current = { versionId, scopeKey, open: () => beginEditing(actionKey, open) }
                select(series, versionId)
            }
        })
    }

    // Tariff pilot exception to the proposed pane default: inspect inline, edit in a task pane.
    function renderDetail(series: TariffSeries, versionId: string) {
        return <TariffDetail
            series={series}
            allSeries={allSeries}
            settings={settings}
            shownVersionId={versionId}
            onShowVersion={(id) => showVersion(series, id)}
            deleteTariffDisabled={deleteTariffPending || dialogLoading}
            deletePeriodDisabled={deletePeriodPending || dialogLoading}
            onEditTariff={(version, key, field) => editDetail(series, version.id, key, () => startTariffEdit(version, field))}
            onDeleteTariff={tariff => guard.run(() => confirmDeleteTariff(tariff))}
            onOpenCreatePeriod={(id, key) => editDetail(series, id, key, () => openCreatePeriod(id))}
            onEditPeriod={(period, key, field) => editDetail(series, period.tariff, key, () => startPeriodEdit(period, field))}
            onDeletePeriod={period => guard.run(() => confirmDeletePeriod(period))}
            onNewVersion={(owner, source, validFrom) => editDetail(owner, source.id, 'new-version', () => versions.openNewVersion(owner, source, validFrom))}
            readOnly={readOnly}
        />
    }

    // The scope is chosen at the download, not by the list: the overview
    // groups series by validity, and "all" is what also adds every
    // superseded version to the PDF.
    const overviewMutation = useMutation({
        mutationFn: (scope: TariffValidityFilter) => downloadTariffOverview(tariffOverviewParams(selectedZevId ?? '', scope)),
        onSuccess: (blob) => downloadBlob(blob, tariffOverviewFilename(today)),
        onError: (error) => pushToast(formatApiError(error, t('pages.tariffs.overviewPdf.error')), 'error'),
    })

    const header = (
        <PageHeader
            eyebrow={selectedZev?.name}
            communitySwitch
            onCommunitySwitch={guard.run}
            scopeNote={scopeNote}
            title={t('pages.tariffs.title')}
            description={listHidden ? undefined : t('pages.tariffs.description')}
            actions={!listHidden && selectedZevId && seriesQuery.data !== undefined ? (
                <TariffActions
                    onOpenCreateTariff={createTariff}
                    onOpenImportModal={!readOnly ? () => guard.run(() => { resetEditing(); setShowImportModal(true) }) : undefined}
                    readOnly={readOnly}
                    onDownloadOverview={(scope) => overviewMutation.mutate(scope)}
                    overviewBusy={overviewMutation.isPending}
                />
            ) : undefined}
        />
    )

    // The form for the task in hand, and what to call it under the tariff's name.
    function renderEditor(): { label: string, content: ReactNode } | null {
        const task = versions.dialog
        if (task) {
            return {
                label: t(`pages.tariffs.pane.task.${task.kind}` as Parameters<typeof t>[0]),
                content: (
                    <TariffVersionForm
                        key={`${task.kind}:${task.source.id}:${editing.task?.sessionId}`}
                        dialog={task}
                        settings={settings}
                        isPending={versions.isPending}
                        error={versions.saveError}
                        onCancel={cancelEditing}
                        onDirtyChange={setFormDirty}
                        onSubmitNewVersion={versions.submitNewVersion}
                        onSubmitDuplicate={versions.submitDuplicate}
                        onSubmitRename={versions.submitRename}
                    />
                ),
            }
        }
        if (tariffFormOpen) {
            return {
                label: t(editingTariffId ? 'pages.tariffs.pane.task.edit' : 'pages.tariffs.createTitle'),
                content: (
                    <TariffForm
                        key={`${editingTariffId ?? 'new'}:${editing.task?.sessionId}`}
                        initialTariff={editingTariff}
                        initialFocus={editing.task?.kind === 'edit' ? editing.task.initialFocus : undefined}
                        selectedZevId={selectedZevId || ''}
                        isPending={tariffPending}
                        error={crudSaveError}
                        onSubmit={submitTariff}
                        onCancel={cancelEditing}
                        onDirtyChange={setFormDirty}
                        onSourcePendingChange={setSourcePending}
                    />
                ),
            }
        }
        if (periodFormOpen) {
            return {
                label: t(editingPeriodId ? 'pages.tariffs.editPeriodTitle' : 'pages.tariffs.createPeriodTitle'),
                content: (
                    <TariffPeriodForm
                        key={`${editingPeriodId ?? 'new'}:${editing.task?.sessionId}`}
                        initialPeriod={editingPeriod}
                        initialFocus={editing.task?.kind === 'period' ? editing.task.initialFocus : undefined}
                        defaultTariffId={periodTariffId}
                        tariffs={bandableTariffs}
                        isPending={periodPending}
                        error={crudSaveError}
                        onSubmit={submitPeriod}
                        onCancel={cancelEditing}
                        onDirtyChange={setFormDirty}
                    />
                ),
            }
        }
        return null
    }
    const editorPane = renderEditor()
    const editorVersion = versions.dialog?.source ?? editingTariff ?? tariffs.find(tariff => tariff.id === periodTariffId)
    const editorContext = editor !== 'create' && editorVersion ? <>
        <span>{openSeries?.name ?? editorVersion.name}</span>
        <span className="tariff-pane-dates">{formatShortDate(editorVersion.valid_from, settings)} – {editorVersion.valid_to ? formatShortDate(editorVersion.valid_to, settings) : t('pages.tariffs.openEnded')}</span>
    </> : undefined

    return (
        <div ref={pageRef} className="page-stack">
            {header}
            <ScopeGuard skeleton="table">
            {seriesQuery.isError && (
                <Notice tone="error" onRetry={() => void seriesQuery.refetch()} isRetrying={seriesQuery.isFetching}>{t('common.error')}</Notice>
            )}
            {seriesQuery.isLoading ? <PageSkeleton variant="table" /> : seriesQuery.data !== undefined && <>
            {selectedZev?.vat_mode === 'inclusive' && (
                <p className="tariff-vat-notice muted"><FontAwesomeIcon icon={faCircleInfo} fixedWidth aria-hidden="true" /><span>{t('pages.tariffs.vatInclusiveNotice')}</span></p>
            )}

            {selectedZevId && (
                <VseTariffImportModal
                    isOpen={showImportModal}
                    onClose={() => setShowImportModal(false)}
                    zevId={selectedZevId}
                    initialUrl={selectedZev?.tariff_source_url ?? ''}
                />
            )}

            <div
                ref={splitRef}
                className="tariff-split"
                data-layout={fitsTwoPanes ? 'wide' : 'narrow'}
                data-pane={paneOpen ? 'open' : 'closed'}
            >
                <div className="tariff-split-list" hidden={listHidden}>
                    {tariffs.length === 0 ? (
                        <TariffEmptyState onOpenCreateTariff={createTariff} readOnly={readOnly} />
                    ) : (
                        <TariffOverview
                            groups={overview}
                            settings={settings}
                            onOpenDetail={showVersion}
                            expandedVersion={navigation.expandedVersion}
                            renderDetail={renderDetail}
                            renderActions={!readOnly ? (series, versionId) => <TariffSeriesActions series={series} versionId={versionId}
                                onRename={source => editDetail(series, source.id, 'series-actions', () => versions.openRename(series, source))}
                                onNewVersion={source => editDetail(series, source.id, 'new-version', () => versions.openNewVersion(series, source))}
                                onDuplicate={source => editDetail(series, source.id, 'series-actions', () => versions.openDuplicate(series, source))} /> : undefined}
                            onCloseDetail={closeDetail}
                        />
                    )}
                </div>

                {editorPane && (
                    <TariffPaneFrame
                        title={editorPane.label}
                        subtitle={editorContext}
                        backLabel={t(openSeries ? 'pages.tariffs.workspace.backToTariff' : 'pages.tariffs.workspace.back')}
                        onClose={cancelEditing}
                        titleRef={paneTitleRef}
                    >
                        <div className="tariff-pane-body page-stack">{editorPane.content}</div>
                    </TariffPaneFrame>
                )}
            </div>

            </>}
            </ScopeGuard>
            {dialog && (
                <ConfirmDialog {...dialog} isLoading={dialogLoading} onConfirm={handleConfirm} onCancel={handleCancel} />
            )}
        </div>
    )
}
