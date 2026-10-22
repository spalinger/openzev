import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog, useConfirmDialog } from '../components/ConfirmDialog'
import { TariffOverview } from '../features/tariffs/TariffOverview'
import { TariffDetailPane, TariffPaneFrame } from '../features/tariffs/TariffDetailPane'
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
import { seriesKeyOf } from '../features/tariffs/useTariffDisplay'
import { tariffOverviewFilename, tariffOverviewParams, type TariffValidityFilter } from '../features/tariffs/tariffOverview'
import { fetchTariffSeries } from '../lib/api/tariffs'
import { downloadTariffOverview } from '../lib/api/invoices'
import { formatApiError } from '../lib/api/errors'
import { queryKeys } from '../lib/api/queryKeys'
import { todayBusinessIso } from '../lib/dates'
import { downloadBlob } from '../lib/downloadBlob'
import { useAppSettings } from '../lib/appSettings'
import { useAuth } from '../lib/auth'
import { useManagedZev } from '../lib/managedZev'
import { useCommunityAccess, useScopeNote } from '../lib/communityAccess'
import { PageSkeleton } from '../components/PageSkeleton'
import { useTranslation } from 'react-i18next'
import { useToast } from '../lib/toast'
import type { Tariff, TariffPeriod, TariffSeries } from '../types/api'
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
    const pendingBand = useRef<{ versionId: string; period?: TariffPeriod } | null>(null)
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

    const tariffs = useMemo<Tariff[]>(
        () => allSeries.flatMap((series) => series.versions),
        [allSeries],
    )

    const navigation = useTariffPaneNavigation({
        allSeries, today, scopeKey, editor,
        settled: seriesQuery.isSuccess && !seriesQuery.isFetching,
        onSelectionChange: (series) => {
            editing.close()
            if (pendingBand.current && series?.versions.some(version => version.id === pendingBand.current?.versionId)) {
                const { versionId, period } = pendingBand.current
                pendingBand.current = null
                beginEditing(`repair-${versionId}`, () => period ? startPeriodEdit(period) : openCreatePeriod(versionId))
            }
        },
        onScopeChange: () => {
            setShowImportModal(false)
            handleCancel()
            pendingBand.current = null
        },
    })
    const { pageRef, splitRef, paneTitleRef, openSeries, shownVersionId, selected, paneOpen, listHidden, fitsTwoPanes, select, deselect } = navigation

    const periods = useMemo(
        () => allSeries.flatMap((series) => series.versions.flatMap((version) => version.periods)),
        [allSeries],
    )

    const tariffNameById = useMemo(() => {
        return new Map((tariffs || []).map((tariff) => [tariff.id, tariff.name]))
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
        selectedZevId,
        canWrite: !readOnly,
        tariffs,
        periods,
        bandableTariffs,
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
            navigation.focusTitle()
        },
    })

    const versions = useTariffVersions({
        editing,
        selectedZevId,
        canWrite: !readOnly,
        queryClient,
        pushToast,
        t,
        // A new version, a copy or a new name: the pane shows what was saved.
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

    // Switching tariff or version, or leaving the pane, asks first when a form has unsaved input.
    const showVersion = (series: Pick<TariffSeries, 'zev' | 'name'>, versionId: string) => {
        if (navigation.isSelecting(series, versionId)) return
        if (selected?.seriesKey === seriesKeyOf(series) && selected.versionId === versionId) return
        guard.run(() => {
            resetEditing()
            select(series, versionId)
        })
    }
    const closePane = () => guard.run(() => {
        resetEditing()
        if (openSeries) deselect()
    })
    // Cancel, and Escape while a form is open: back to viewing.
    const cancelEditing = () => guard.run(resetEditing)
    const escapePane = () => (editor ? cancelEditing() : closePane())

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
            description={t('pages.tariffs.description')}
            actions={selectedZevId && seriesQuery.isSuccess ? (
                <TariffActions
                    onOpenCreateTariff={createTariff}
                    onOpenImportModal={!readOnly ? () => setShowImportModal(true) : undefined}
                    readOnly={readOnly}
                    onDownloadOverview={(scope) => overviewMutation.mutate(scope)}
                    overviewBusy={overviewMutation.isPending}
                />
            ) : undefined}
        />
    )

    // The form for the task in hand, and what to call it under the tariff's name.
    function renderEditor(): { label: string, content: ReactNode, versionId?: string } | null {
        const task = versions.dialog
        if (task) {
            return {
                label: t(`pages.tariffs.pane.task.${task.kind}` as Parameters<typeof t>[0]),
                versionId: task.source.id,
                content: (
                    <TariffVersionForm
                        key={`${task.kind}:${task.source.id}`}
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
                label: editingTariffId ? t('pages.tariffs.pane.task.edit') : '',
                versionId: editingTariffId ?? undefined,
                content: (
                    <TariffForm
                        key={editingTariffId ?? 'new'}
                        initialTariff={editingTariff}
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
                versionId: periodTariffId,
                content: (
                    <TariffPeriodForm
                        key={editingPeriodId ?? 'new'}
                        initialPeriod={editingPeriod}
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

    return (
        <div ref={pageRef} className="page-stack">
            {header}
            <ScopeGuard skeleton="table">
            {seriesQuery.isLoading ? <PageSkeleton variant="table" /> : seriesQuery.isError ? (
                <Notice tone="error" onRetry={() => void seriesQuery.refetch()} isRetrying={seriesQuery.isFetching}>{t('common.error')}</Notice>
            ) : <>
            {selectedZev?.vat_mode === 'inclusive' && (
                <p className="tariff-vat-notice muted">{t('pages.tariffs.vatInclusiveNotice')}</p>
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
                            selected={selected}
                            onOpenDetail={showVersion}
                            onCloseDetail={closePane}
                            onRepairBand={!readOnly ? (series, versionId, period) => guard.run(() => {
                                resetEditing()
                                if (selected?.versionId === versionId) beginEditing(`repair-${versionId}`, () => period ? startPeriodEdit(period) : openCreatePeriod(versionId))
                                else {
                                    pendingBand.current = { versionId, period }
                                    select(series, versionId)
                                }
                            }) : undefined}
                        />
                    )}
                </div>

                {editor === 'create' && editorPane ? (
                    <TariffPaneFrame
                        title={t('pages.tariffs.createTitle')}
                        backLabel={t(openSeries ? 'pages.tariffs.workspace.backToTariff' : 'pages.tariffs.workspace.back')}
                        onClose={closePane}
                        onBack={escapePane}
                        onEscape={escapePane}
                        titleRef={paneTitleRef}
                    >
                        <div className="tariff-pane-body page-stack">{editorPane.content}</div>
                    </TariffPaneFrame>
                ) : openSeries && (
                    <TariffDetailPane
                        series={openSeries}
                        allSeries={allSeries}
                        settings={settings}
                        shownVersionId={shownVersionId}
                        onShowVersion={(versionId) => showVersion(openSeries, versionId)}
                        deleteTariffDisabled={deleteTariffPending || dialogLoading}
                        deletePeriodDisabled={deletePeriodPending || dialogLoading}
                        onClose={closePane}
                        onBack={escapePane}
                        onEscape={escapePane}
                        onEditTariff={(version, actionKey) => beginEditing(actionKey, () => startTariffEdit(version))}
                        onDeleteTariff={confirmDeleteTariff}
                        onOpenCreatePeriod={(versionId, actionKey) => beginEditing(actionKey, () => openCreatePeriod(versionId))}
                        onEditPeriod={(period, actionKey) => beginEditing(actionKey, () => startPeriodEdit(period))}
                        onDeletePeriod={confirmDeletePeriod}
                        onNewVersion={(series, source, validFrom) => beginEditing('new-version', () => versions.openNewVersion(series, source, validFrom))}
                        onRenameSeries={(series, source) => beginEditing('rename-series', () => versions.openRename(series, source))}
                        onDuplicate={(series, source) => beginEditing('series-actions', () => versions.openDuplicate(series, source))}
                        readOnly={readOnly}
                        titleRef={paneTitleRef}
                        editor={editorPane ?? undefined}
                    />
                )}
            </div>

            {dialog && (
                <ConfirmDialog {...dialog} isLoading={dialogLoading} onConfirm={handleConfirm} onCancel={handleCancel} />
            )}
            </>}
            </ScopeGuard>
        </div>
    )
}
