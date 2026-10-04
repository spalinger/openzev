import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InvoicePeriodRowsTable } from '../features/invoices/InvoicePeriodRowsTable'
import { InvoiceBatchToolbar } from '../features/invoices/InvoiceBatchToolbar'
import { InvoiceDeleteModal } from '../features/invoices/InvoiceDeleteModal'
import { InvoicesEmptyState } from '../features/invoices/InvoicesEmptyState'
import { useInvoiceActions } from '../features/invoices/useInvoiceActions'
import {
    PDF_POLL_MS,
    countPendingPdfs,
    pdfWatchIsFinished,
    usePdfWatch,
} from '../features/invoices/pdfWatch'
import { PeriodSelector } from '../components/PeriodSelector'
import {
    firstAlignedBillingPeriod,
    type BillingInterval,
} from '../lib/billingPeriod'
import { useBillingPeriodParams } from '../lib/useBillingPeriodParams'
import { fetchInvoicePeriodOverview } from '../lib/api/invoices'
import { queryKeys } from '../lib/api/queryKeys'
import { useAuth } from '../lib/auth'
import { useManagedZev } from '../lib/managedZev'
import { useCommunityAccess } from '../lib/communityAccess'
import { PageHeader } from '../components/PageHeader'
import { Notice } from '../components/Notice'
import { PageSkeleton } from '../components/PageSkeleton'
import { ScopeGuard } from '../components/ScopeGuard'

export function InvoicesPage() {
    const { t } = useTranslation()
    const { selectedZev } = useManagedZev()
    return (
        <div className="page-stack">
            <PageHeader
                eyebrow={selectedZev?.name}
                title={t('pages.invoices.title')}
                description={t('pages.invoices.description')}
            />
            <InvoicesContent />
        </div>
    )
}

/** Period-scoped billing body; its standalone page or hub owns the header. */
export function InvoicesContent() {
    const { t } = useTranslation()
    const { selectedZevId, selectedZev } = useManagedZev()
    const { user } = useAuth()

    const interval: BillingInterval = (selectedZev?.billing_interval as BillingInterval) ?? 'monthly'
    const communityStart = selectedZev?.start_date ?? null
    const minPeriod = useMemo(
        () => firstAlignedBillingPeriod(communityStart, interval),
        [communityStart, interval],
    )

    const { period: range, setPeriod, isReady: periodReady } = useBillingPeriodParams({
        interval,
        ready: !!selectedZev,
        scopeId: selectedZevId,
        fallback: 'previous-complete',
        minimumRangeStart: communityStart,
        minimumFallback: minPeriod,
        scopeChange: 'preserve-url',
    })
    const period = { period_start: range.from, period_end: range.to }

    // Declared above the query because it paces it; the query's own rows are
    // what tell it when to stop, so the interval reads them from the query.
    const { pdfWatch, startPdfWatch, stopPdfWatch } = usePdfWatch()

    const [deleteModalInvoiceId, setDeleteModalInvoiceId] = useState<string | null>(null)

    // A deletion dialog targets one community's invoice: never let it survive
    // an account, community, write-access, or period change.
    const { isZevScope: isManagedScope, canWriteSelectedCommunity } = useCommunityAccess()
    useEffect(() => {
        setDeleteModalInvoiceId(null)
    }, [user?.id, selectedZevId, canWriteSelectedCommunity, period.period_start, period.period_end])

    const periodOverviewQuery = useQuery({
        queryKey: queryKeys.invoices.periodOverview(selectedZevId, period.period_start, period.period_end),
        queryFn: () =>
            fetchInvoicePeriodOverview({
                zev_id: selectedZevId,
                period_start: period.period_start,
                period_end: period.period_end,
            }),
        enabled: periodReady && !!selectedZevId,
        // Poll only while an action's queued PDFs are still outstanding, and
        // read that from the query's own latest rows rather than from state
        // derived below — otherwise the interval would lag a render behind.
        refetchInterval: (query) =>
            pdfWatch && countPendingPdfs(query.state.data?.rows ?? []) > 0 ? PDF_POLL_MS : false,
        refetchIntervalInBackground: true,
    })

    const rows = periodOverviewQuery.data?.rows ?? []
    const pendingPdfCount = countPendingPdfs(rows)
    const isWaitingForPdfs = pdfWatch !== null && pendingPdfCount > 0

    // Generation eligibility rides on the rows themselves, so no second
    // request gates the actions: while the overview loads the table shows
    // its skeleton, and on failure the error banner — never a Generate
    // button that a missing readiness payload cannot qualify.

    // End the watch when every invoice has its document, or the deadline passes.
    useEffect(() => {
        if (!pdfWatch) return
        if (pdfWatchIsFinished(pdfWatch, pendingPdfCount, Date.now())) {
            stopPdfWatch()
            return
        }
        const timer = window.setTimeout(stopPdfWatch, pdfWatch.until - Date.now())
        return () => window.clearTimeout(timer)
    }, [pdfWatch, pendingPdfCount, stopPdfWatch])

    const {
        deleteMutation,
        downloadAllPdfsMutation,
        anyBatchPending,
        stats,
        recommendedBatchAction,
        batchMenuItems,
        getPrimaryRowAction,
        getRowMenuItems,
        pdfGeneratingInvoiceId,
    } = useInvoiceActions({
        selectedZevId,
        period,
        rows,
        userRole: user?.role,
        onDeleteClick: (invoiceId) => setDeleteModalInvoiceId(invoiceId),
        onPdfQueued: startPdfWatch,
    })

    /** Whether this row's document is being produced right now.
     *
     * The local mutation matters as well as the stored status: the per-invoice
     * regenerate renders inline, so the row is busy before any write lands. */
    const isPdfPending = (row: typeof rows[number]) => {
        if (!row.invoice) return false
        if (pdfGeneratingInvoiceId === row.invoice.id) return true
        return row.invoice.pdf_status === 'pending'
    }

    // A viewer sees the period and may download the PDFs, but generates,
    // approves, sends and deletes nothing (#761): only navigation stays.
    // Managers of a disabled ZEV keep read access only.
    const READ_ONLY_ROW_ITEMS = new Set(['review-conflict'])
    const primaryRowAction = canWriteSelectedCommunity ? getPrimaryRowAction : () => null
    const rowMenuItems = canWriteSelectedCommunity
        ? getRowMenuItems
        : (row: Parameters<typeof getRowMenuItems>[0]) => getRowMenuItems(row).filter((item) => READ_ONLY_ROW_ITEMS.has(item.key))

    const batchStats = [
        { key: 'invoices', label: t('pages.invoices.batch.summaryInvoices'), value: stats.invoiceCount },
        { key: 'drafts', label: t('pages.invoices.batch.summaryDrafts'), value: stats.draftCount },
        { key: 'approved', label: t('pages.invoices.batch.summaryApproved'), value: stats.approvedCount },
        { key: 'pdfs', label: t('pages.invoices.batch.summaryPdfs'), value: stats.pdfCount },
    ]

    const content = (
        <>
            <section className="card">
                <PeriodSelector
                    interval={interval}
                    from={period.period_start}
                    to={period.period_end}
                    title={selectedZev?.name}
                    allowCustomRange={false}
                    minFrom={minPeriod?.from}
                    onChange={setPeriod}
                />
            </section>

            {periodOverviewQuery.isError && periodOverviewQuery.data && (
                <Notice tone="warning" onRetry={() => void periodOverviewQuery.refetch()} isRetrying={periodOverviewQuery.isFetching}>{t('pages.invoices.failed')}</Notice>
            )}
            {!period.period_start || !period.period_end || periodOverviewQuery.isLoading ? (
                <PageSkeleton variant="table" />
            ) : periodOverviewQuery.isError && !periodOverviewQuery.data ? (
                <Notice tone="error" onRetry={() => void periodOverviewQuery.refetch()} isRetrying={periodOverviewQuery.isFetching}>{t('pages.invoices.failed')}</Notice>
            ) : rows.length === 0 ? (
                <InvoicesEmptyState />
            ) : (
                <>
                    {/* Batch actions stay hidden from read-only roles even if routing changes. */}
                    {isManagedScope && (
                        <InvoiceBatchToolbar
                            stats={batchStats}
                            recommendedAction={canWriteSelectedCommunity ? recommendedBatchAction : null}
                            menuItems={canWriteSelectedCommunity ? batchMenuItems : []}
                            anyBatchPending={anyBatchPending}
                            pdfCount={stats.pdfCount}
                            onDownloadAll={() => downloadAllPdfsMutation.mutate()}
                        />
                    )}

                    {isWaitingForPdfs && (
                        <p className="muted" role="status" aria-live="polite">
                            {t('pages.invoices.pdfsGenerating', { n: pendingPdfCount })}
                        </p>
                    )}

                    <InvoicePeriodRowsTable
                        rows={rows}
                        period={period}
                        getPrimaryRowAction={primaryRowAction}
                        getRowMenuItems={rowMenuItems}
                        isPdfPending={isPdfPending}
                    />
                </>
            )}

            <InvoiceDeleteModal
                isOpen={deleteModalInvoiceId !== null}
                isPending={deleteMutation.isPending}
                onCancel={() => setDeleteModalInvoiceId(null)}
                onConfirm={() => {
                    if (!deleteModalInvoiceId) return
                    deleteMutation.mutate(deleteModalInvoiceId, {
                        onSuccess: () => setDeleteModalInvoiceId(null),
                    })
                }}
            />

        </>
    )

    return <ScopeGuard skeleton="tableRows">{content}</ScopeGuard>
}
