import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEllipsis, faFilePdf, faSpinner } from '@fortawesome/free-solid-svg-icons'
import { ActionMenu, type ActionMenuItem } from './ActionMenu'
import { openInvoicePdf } from '../lib/api/invoices'
import { formatChf } from '../lib/numbers'
import type { Invoice } from '../types/api'
import { getLatestEmailLog } from '../features/invoices/emailLogs'
import { invoiceStatusBadgeClass } from '../features/invoices/invoiceStatus'

export function InvoiceLink({ invoice, from, period, children, className }: {
    invoice: Pick<Invoice, 'id' | 'invoice_number'>
    from: string
    period?: { period_start: string; period_end: string }
    children?: ReactNode
    className?: string
}) {
    return (
        <Link
            to={`/billing/invoices/${invoice.id}`}
            state={{ from, ...period }}
            className={className}
        >
            {children ?? invoice.invoice_number}
        </Link>
    )
}

export function InvoiceStatusBadge({ status }: { status: Invoice['status'] }) {
    const { t } = useTranslation()
    return <span className={invoiceStatusBadgeClass(status)}>{status ? t(`invoice.status.${status}`) : ''}</span>
}

export function InvoiceDeliveryStatus({ invoice }: { invoice: Invoice | null }) {
    const { t } = useTranslation()
    const status = invoice?.last_email_status ?? getLatestEmailLog(invoice)?.status
    if (!status) return <span className="muted">-</span>
    const tone = status === 'sent' ? 'success' : status === 'failed' ? 'danger' : 'neutral'
    return <span className={`badge badge-${tone}`}>{t(`email.${status}`)}</span>
}

export function InvoiceAmount({ value }: { value: Invoice['total_chf'] | null }) {
    return value === null ? <span className="muted">-</span> : <>{formatChf(Number(value))}</>
}

/** Presentation only: callers decide whether PDF access is allowed and pass local pending state. */
export function InvoicePdfCell({ invoice, pending = false, showReadyStatus = true, keepExistingDuringPending = false, buttonClassName = 'table-inline-link', ariaLabel }: {
    invoice: Invoice | null
    pending?: boolean
    showReadyStatus?: boolean
    keepExistingDuringPending?: boolean
    buttonClassName?: string
    ariaLabel?: string
}) {
    const { t } = useTranslation()
    if (!invoice) return <span className="muted">-</span>
    const regenerating = pending || invoice.pdf_status === 'pending'
    if (regenerating && (!keepExistingDuringPending || !invoice.pdf_url)) {
        return (
            <span className="badge badge-info" role="status">
                <FontAwesomeIcon icon={faSpinner} spin fixedWidth aria-hidden="true" />
                {t('pages.invoices.pdfGenerating')}
            </span>
        )
    }
    if (invoice.pdf_status === 'failed' && !invoice.pdf_url) {
        return (
            <span className="badge badge-danger" title={t('pages.invoices.pdfFailedHint')}>
                {t('pages.invoices.pdfFailed')}
            </span>
        )
    }
    if (!invoice.pdf_url) return <span className="badge badge-neutral">{t('pages.invoices.pdfMissing')}</span>
    return (
        <div className="invoice-cell-stack">
            <button type="button" onClick={() => void openInvoicePdf(invoice.id)} className={buttonClassName} aria-label={ariaLabel}>
                <FontAwesomeIcon icon={faFilePdf} fixedWidth aria-hidden="true" />
                {t('common.openPdf')}
            </button>
            {showReadyStatus && <span className="badge badge-success">{t('pages.invoices.pdfReady')}</span>}
        </div>
    )
}

/** Minimal action a standalone button renders: no menu key or section. */
export type InvoiceButtonAction = Pick<ActionMenuItem, 'label' | 'icon' | 'onClick' | 'disabled' | 'danger'>

export function InvoiceActionButton({ action, compact = true }: { action: InvoiceButtonAction; compact?: boolean }) {
    return (
        <button
            className={`button button-${action.danger ? 'danger' : 'primary'}${compact ? ' button-compact' : ''}`}
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
        >
            {action.icon}
            {action.label}
        </button>
    )
}

/** Eligibility and read-only restrictions remain with the caller. */
export function InvoiceRowActions({ primary, menuItems = [], children }: {
    primary?: InvoiceButtonAction | null
    menuItems?: ActionMenuItem[]
    children?: ReactNode
}) {
    const { t } = useTranslation()
    return (
        <div className="invoice-row-actions">
            {primary && <InvoiceActionButton action={primary} />}
            {children}
            {menuItems.length > 0 && (
                <ActionMenu
                    label={t('pages.invoices.moreActions')}
                    icon={<FontAwesomeIcon icon={faEllipsis} fixedWidth />}
                    items={menuItems}
                />
            )}
        </div>
    )
}
