import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchInvoices } from '../lib/api/invoices'
import { queryKeys } from '../lib/api/queryKeys'
import { formatShortDate, useAppSettings } from '../lib/appSettings'
import { InvoiceAmount, InvoiceLink, InvoicePdfCell, InvoiceRowActions, InvoiceStatusBadge } from '../components/InvoicePresentation'
import { PageSkeleton } from '../components/PageSkeleton'
import { useAuth } from '../lib/auth'
import { soleCommunityName, ownParticipantIds } from '../lib/membership'
import { PageHeader } from '../components/PageHeader'
import type { Invoice } from '../types/api'
import { Notice } from '../components/Notice'

/**
 * Participant's own invoices (`/me/invoices`, nav-regroup phase 2): a
 * read-only list over the existing role-scoped backend list (no new grant).
 * PDFs never decide list membership — rows always show, the PDF action is
 * conditional on a stored document.
 */
export function MyInvoicesPage() {
    const { t } = useTranslation()
    const { settings } = useAppSettings()
    const { user } = useAuth()

    const ownIds = ownParticipantIds(user)
    const isPersonalInvoice = (invoice: Invoice) => ownIds.has(invoice.participant)
        && (!!invoice.sent_at || invoice.status === 'sent' || invoice.status === 'paid')
    const invoicesQuery = useQuery({
        // No zev_id: personal invoices span all participant memberships.
        queryKey: queryKeys.invoices.mine(),
        queryFn: () => fetchInvoices(undefined),
        refetchInterval: (query) =>
            query.state.data?.some((invoice) => isPersonalInvoice(invoice) && invoice.pdf_status === 'pending') ? 15000 : false,
    })
    // The unscoped list is the union of management/viewer access and the
    // caller's participant invoices: keep only the caller's own, previously sent rows here.
    const invoices = (invoicesQuery.data ?? []).filter(isPersonalInvoice)
    // Several memberships: a community column, and the header names all of them.
    const showCommunity = (user?.memberships?.length ?? 0) > 1

    return (
        <div className="page-stack">
            <PageHeader
                eyebrow={showCommunity ? t('pages.myInvoices.allCommunities') : soleCommunityName(user)}
                title={t('pages.myInvoices.title')}
                description={t('pages.myInvoices.description')}
            />

            {invoicesQuery.isError && invoicesQuery.data && (
                <Notice tone="warning" onRetry={() => void invoicesQuery.refetch()} isRetrying={invoicesQuery.isFetching}>{t('pages.myInvoices.failed')}</Notice>
            )}
            {invoicesQuery.isLoading ? (
                <PageSkeleton variant="tableRows" />
            ) : invoicesQuery.isError && !invoicesQuery.data ? (
                <Notice tone="error" onRetry={() => void invoicesQuery.refetch()} isRetrying={invoicesQuery.isFetching}>{t('pages.myInvoices.failed')}</Notice>
            ) : invoices.length === 0 ? (
                <div className="card">
                    <h3 style={{ marginTop: 0 }}>{t('pages.myInvoices.empty.title')}</h3>
                    <p className="muted">{t('pages.myInvoices.empty.description')}</p>
                </div>
            ) : (
                <section className="table-card">
                    <div className="table-scroll">
                        <table className="billing-workflow-table">
                            <thead>
                                <tr>
                                    <th scope="col">{t('pages.myInvoices.col.invoice')}</th>
                                    {showCommunity && <th scope="col">{t('pages.myInvoices.col.community')}</th>}
                                    <th scope="col">{t('pages.myInvoices.col.period')}</th>
                                    <th scope="col">{t('pages.myInvoices.col.total')}</th>
                                    <th scope="col">{t('pages.myInvoices.col.status')}</th>
                                    <th scope="col">{t('pages.myInvoices.col.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {invoices.map((invoice) => (
                                    <tr key={invoice.id}>
                                        <td><InvoiceLink invoice={invoice} from="/me/invoices" /></td>
                                        {showCommunity && <td>{invoice.zev_name}</td>}
                                        <td className="billing-period-cell">
                                            {formatShortDate(invoice.period_start, settings)} →{' '}
                                            {formatShortDate(invoice.period_end, settings)}
                                        </td>
                                        <td className="numeric"><InvoiceAmount value={invoice.total_chf} /></td>
                                        <td>
                                            <InvoiceStatusBadge status={invoice.status} />
                                        </td>
                                        <td>
                                            <InvoiceRowActions>
                                                <InvoiceLink
                                                    className="button button-secondary"
                                                    invoice={invoice}
                                                    from="/me/invoices"
                                                >
                                                    {t('pages.myInvoices.viewDetails')}
                                                </InvoiceLink>
                                                <InvoicePdfCell
                                                    invoice={invoice}
                                                    showReadyStatus={false}
                                                    keepExistingDuringPending
                                                    buttonClassName="button button-secondary"
                                                    ariaLabel={t('pages.myInvoices.openPdf', { number: invoice.invoice_number })}
                                                />
                                            </InvoiceRowActions>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}
        </div>
    )
}
