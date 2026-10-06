import type { InvoicePeriodParticipantRow } from '../../types/api'
import { invoiceRowIssues, type InvoiceRowWork } from './invoiceRowState'

/** Filters affect visible rows only. Batch actions use the whole period. */
export type InvoiceRowFilter = 'drafts' | 'approved' | 'sent' | 'issues' | null

export type InvoiceRowCounts = {
    all: number
    invoices: number
    drafts: number
    approved: number
    sent: number
    issues: number
    pdfs: number
}

type WorkResolver = (row: InvoicePeriodParticipantRow) => InvoiceRowWork
const noWork: WorkResolver = () => ({})

function matches(row: InvoicePeriodParticipantRow, filter: InvoiceRowFilter, work: InvoiceRowWork): boolean {
    switch (filter) {
        case 'drafts': return row.invoice?.status === 'draft'
        case 'approved': return row.invoice?.status === 'approved'
        case 'sent': return row.invoice?.status === 'sent'
        case 'issues': return invoiceRowIssues(row, work).length > 0
        default: return true
    }
}

export function invoiceRowCounts(rows: InvoicePeriodParticipantRow[], getWork: WorkResolver = noWork): InvoiceRowCounts {
    return {
        all: rows.length,
        invoices: rows.filter(row => !!row.invoice).length,
        drafts: filterInvoiceRows(rows, 'drafts', getWork).length,
        approved: filterInvoiceRows(rows, 'approved', getWork).length,
        sent: filterInvoiceRows(rows, 'sent', getWork).length,
        issues: filterInvoiceRows(rows, 'issues', getWork).length,
        pdfs: rows.filter(row => !!row.invoice?.pdf_url).length,
    }
}

export function filterInvoiceRows(
    rows: InvoicePeriodParticipantRow[],
    filter: InvoiceRowFilter,
    getWork: WorkResolver = noWork,
): InvoicePeriodParticipantRow[] {
    return filter ? rows.filter(row => matches(row, filter, getWork(row))) : rows
}
