import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { openInvoicePdf } from '../../lib/api/invoices'
import { formatShortDate, useAppSettings } from '../../lib/appSettings'
import type { Invoice } from '../../types/api'
import { PageSkeleton } from '../PageSkeleton'

interface ParticipantInvoicesCardProps {
    invoices: Invoice[]
    isLoading: boolean
    isError: boolean
    allCommunities: boolean
}

export function ParticipantInvoicesCard({ invoices, isLoading, isError, allCommunities }: ParticipantInvoicesCardProps) {
    const { t } = useTranslation()
    const { settings } = useAppSettings()

    return (
        <section className="card">
            <h3>{t(allCommunities ? 'pages.dashboard.invoicesAllCommunitiesSection' : 'pages.dashboard.invoicesSection')}</h3>
            {isLoading ? (
                <PageSkeleton variant="tableRows" />
            ) : isError ? (
                <p className="muted">{t('pages.dashboard.failedInvoices')}</p>
            ) : invoices.length === 0 ? (
                <p className="muted">{t('pages.dashboard.noInvoices')}</p>
            ) : (
                <table className="participant-invoices-table">
                    <thead>
                        <tr>
                            <th>{t('pages.dashboard.invoiceCol.invoice')}</th>
                            <th>{t('pages.dashboard.invoiceCol.period')}</th>
                            <th className="participant-invoices-total">{t('pages.dashboard.invoiceCol.total')}</th>
                            <th>{t('pages.dashboard.invoiceCol.actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoices.map((invoice) => (
                            <tr key={invoice.id}>
                                <td>{invoice.invoice_number}</td>
                                <td>{formatShortDate(invoice.period_start, settings)} → {formatShortDate(invoice.period_end, settings)}</td>
                                <td className="participant-invoices-total">CHF {invoice.total_chf}</td>
                                <td>
                                    <div className="participant-invoice-actions">
                                        <Link className="button button-primary" to={`/billing/invoices/${invoice.id}`} state={{ from: '/' }}>
                                            {t('pages.dashboard.viewDetails')}
                                        </Link>
                                        <button
                                            type="button"
                                            onClick={() => openInvoicePdf(invoice.id)}
                                            className="button button-primary participant-invoice-pdf"
                                            aria-label={t('pages.dashboard.openInvoicePdf', { number: invoice.invoice_number })}
                                            title={t('common.openPdf')}
                                        >
                                            📄
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    )
}
