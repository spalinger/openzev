import { useCallback, useState } from 'react'

import type { InvoicePeriodParticipantRow } from '../../types/api'

/** Track accepted generation until invoices exist, then follow PDF status.
 * Failed PDFs are terminal; the deadline bounds jobs that never settle. */

export const PDF_WATCH_MS = 90_000

export const PDF_POLL_MS = 2_500

export type PdfWatch = { startedAt: number; until: number; generationParticipantIds?: string[] } | null

/** Failed/missing PDFs are not pending renders. */
export function countPendingPdfs(rows: InvoicePeriodParticipantRow[]): number {
    return rows.filter((row) => row.invoice?.pdf_status === 'pending').length
}

/** Batch generation can be queued before any invoice exists to report PDF status. */
export function countPendingInvoiceWork(rows: InvoicePeriodParticipantRow[], watch: PdfWatch): number {
    const awaitingGeneration = new Set(watch?.generationParticipantIds ?? [])
    for (const row of rows) {
        if (row.invoice && row.invoice.status !== 'cancelled') awaitingGeneration.delete(row.participant_id)
    }
    return awaitingGeneration.size + countPendingPdfs(rows)
}

export function usePdfWatch() {
    const [pdfWatch, setPdfWatch] = useState<PdfWatch>(null)
    // Set when the deadline ended a watch with work still outstanding.
    const [pdfWatchExpired, setPdfWatchExpired] = useState(false)

    const startPdfWatch = useCallback((generationParticipantIds: string[] = []) => {
        const now = Date.now()
        setPdfWatchExpired(false)
        setPdfWatch(current => ({
            startedAt: now, until: now + PDF_WATCH_MS,
            generationParticipantIds: [...new Set([...(current?.generationParticipantIds ?? []), ...generationParticipantIds])],
        }))
    }, [])

    /** Completion or a scope change: nothing left to report. */
    const stopPdfWatch = useCallback(() => {
        setPdfWatch(null)
        setPdfWatchExpired(false)
    }, [])

    /** The deadline passed before the work was seen to finish. */
    const expirePdfWatch = useCallback(() => {
        setPdfWatch(null)
        setPdfWatchExpired(true)
    }, [])

    return { pdfWatch, pdfWatchExpired, startPdfWatch, stopPdfWatch, expirePdfWatch }
}

/** Allow an initial refresh before treating a zero pending count as settled. */
export function pdfWatchIsFinished(watch: NonNullable<PdfWatch>, pendingCount: number, now: number): boolean {
    if (now >= watch.until) return true
    return pendingCount === 0 && now - watch.startedAt > PDF_POLL_MS
}

/** Overview refetch interval for the watch, read from the query's latest rows. */
export function pdfWatchRefetchInterval(watch: PdfWatch, rows: InvoicePeriodParticipantRow[]): number | false {
    return watch && !pdfWatchIsFinished(watch, countPendingInvoiceWork(rows, watch), Date.now()) ? PDF_POLL_MS : false
}
