import { describe, it, expect } from 'vitest'

import {
    PDF_POLL_MS,
    PDF_WATCH_MS,
    countPendingPdfs,
    countPendingInvoiceWork,
    pdfWatchIsFinished,
} from '../src/features/invoices/pdfWatch'
import type { InvoicePdfStatus, InvoicePeriodParticipantRow } from '../src/types/api'

/**
 * The stopping rules for the PDF watch.
 *
 * Both are easy to get subtly wrong in ways that are invisible in a browser:
 * end too eagerly and the poll never runs (the overview has not refetched yet,
 * so "nothing pending" means "nothing loaded"); never end and a failed render
 * spins a request every 2.5s forever.
 */

const row = (pdfStatus: InvoicePdfStatus | null, pdfUrl: string | null = null) =>
    ({
        participant_id: Math.random().toString(),
        participant_name: 'Anna Muster',
        invoice:
            pdfStatus === null
                ? null
                : ({ id: 'i1', pdf_url: pdfUrl, pdf_status: pdfStatus } as never),
        metering_data_complete: true,
        metering_points_total: 1,
        metering_points_with_data: 1,
        missing_meter_ids: [],
    }) as InvoicePeriodParticipantRow

describe('countPendingPdfs', () => {
    it('counts invoices whose document is being rendered', () => {
        expect(countPendingPdfs([row('pending'), row('ready', '/x.pdf')])).toBe(1)
    })

    it('ignores participants with no invoice at all', () => {
        // Nothing was queued for them, so they must not hold the watch open.
        expect(countPendingPdfs([row(null), row(null)])).toBe(0)
    })

    it('does not count a failed render as still pending', () => {
        // A failed render also leaves pdf_url null. Counting it would hold the
        // watch open to its deadline on every poll, forever after.
        expect(countPendingPdfs([row('failed'), row('ready', '/x.pdf')])).toBe(0)
    })

    it('does not count an invoice nobody asked a document for', () => {
        expect(countPendingPdfs([row('none')])).toBe(0)
    })

    it('is zero when every document is ready', () => {
        expect(countPendingPdfs([row('ready', '/a.pdf'), row('ready', '/b.pdf')])).toBe(0)
    })
})

describe('pdfWatchIsFinished', () => {
    const started = 1_000_000
    const watch = { startedAt: started, until: started + PDF_WATCH_MS }

    it('does not end on the zero count that precedes the first refetch', () => {
        // The regression this guard exists for: ending here means never polling.
        expect(pdfWatchIsFinished(watch, 0, started + 100)).toBe(false)
    })

    it('ends once a settled refetch shows nothing pending', () => {
        expect(pdfWatchIsFinished(watch, 0, started + PDF_POLL_MS + 1)).toBe(true)
    })

    it('keeps waiting while documents are still missing', () => {
        expect(pdfWatchIsFinished(watch, 3, started + 30_000)).toBe(false)
    })

    it('gives up at the deadline even with documents still missing', () => {
        // A failed render leaves pdf_url null forever; without this the page
        // would poll for the rest of the session.
        expect(pdfWatchIsFinished(watch, 3, started + PDF_WATCH_MS)).toBe(true)
    })
})

describe('queued invoice work', () => {
    const watch = { startedAt: 0, until: PDF_WATCH_MS, generationParticipantIds: ['p1'] }

    it('waits for queued generation before there is an invoice or PDF status', () => {
        expect(countPendingInvoiceWork([{ ...row(null), participant_id: 'p1' }], watch)).toBe(1)
        expect(countPendingInvoiceWork([], watch)).toBe(1)
    })

    it('does not mistake a cancelled invoice for the queued replacement', () => {
        const cancelled = { ...row('ready', '/old.pdf'), participant_id: 'p1' }
        cancelled.invoice!.status = 'cancelled'
        expect(countPendingInvoiceWork([cancelled], watch)).toBe(1)
    })

    it('moves from awaited generation to pending PDF, then stops on ready or failed', () => {
        const generated = { ...row('pending'), participant_id: 'p1' }
        generated.invoice!.status = 'draft'
        expect(countPendingInvoiceWork([generated], watch)).toBe(1)
        generated.invoice!.pdf_status = 'ready'
        expect(countPendingInvoiceWork([generated], watch)).toBe(0)
        generated.invoice!.pdf_status = 'failed'
        expect(countPendingInvoiceWork([generated], watch)).toBe(0)
    })

    it('watches only the generation targets, with the existing timeout for failed jobs', () => {
        const unrelated = { ...row(null), participant_id: 'p2' }
        expect(countPendingInvoiceWork([unrelated], watch)).toBe(1)
        expect(pdfWatchIsFinished(watch, 1, PDF_WATCH_MS)).toBe(true)
        expect(countPendingInvoiceWork([unrelated], null)).toBe(0)
    })
})
