import { useTranslation } from 'react-i18next'
import { formatShortDate, useAppSettings } from '../../lib/appSettings'
import type { Invoice, InvoiceReadingImpact } from '../../types/api'

function impactSummary(impact: InvoiceReadingImpact): { key: string; params: Record<string, unknown> } {
    const evidence = impact.evidence ?? {}
    if (evidence.source === 'import-deletion') {
        const readings = typeof evidence.deleted_readings === 'number' ? evidence.deleted_readings : 0
        return {
            key: 'pages.invoices.dataReview.evidenceDeletion',
            params: {
                count: readings,
                readings,
                from: evidence.day_from ?? '?',
                to: evidence.day_to ?? '?',
            },
        }
    }
    const changes = typeof evidence.change_count === 'number' ? evidence.change_count : 0
    return {
        key: 'pages.invoices.dataReview.evidenceImport',
        params: {
            count: changes,
            delivery: evidence.delivery_id ?? '?',
            changes,
            from: evidence.day_from ?? '?',
            to: evidence.day_to ?? '?',
        },
    }
}

/**
 * Notice that committed metering corrections taint an invoice (backend
 * `InvoiceReadingImpact`, invoice-lifecycle spec §4.6). The invoice itself
 * never changes on import — the notice routes to the existing resolution:
 * regeneration for drafts (`POST /invoices/generate/`), cancel-then-regenerate
 * for issued invoices, while paid flags persist. Lifecycle permissions are
 * untouched: `canAct` only switches imperative wording to plain facts.
 */
export function InvoiceDataReviewNotice({
    invoice,
    variant,
    canAct,
}: {
    invoice: Pick<Invoice, 'status' | 'needs_data_review' | 'open_data_impact_count' | 'data_impacts'>
    variant: 'row' | 'detail'
    canAct: boolean
}) {
    const { t } = useTranslation()
    const { settings } = useAppSettings()
    if (!invoice.needs_data_review) return null

    const count = invoice.open_data_impact_count ?? invoice.data_impacts?.length ?? 0
    const status = invoice.status
    const messageKey = status === 'draft'
        ? canAct ? 'pages.invoices.dataReview.draftAction' : 'pages.invoices.dataReview.draftNotice'
        : status === 'approved' || status === 'sent'
            ? canAct ? 'pages.invoices.dataReview.issuedAction' : 'pages.invoices.dataReview.issuedNotice'
            : status === 'paid'
                ? 'pages.invoices.dataReview.paidNotice'
                : 'pages.invoices.dataReview.genericNotice'

    return (
        <div className="warning-banner" style={{ margin: 0 }}>
            <div className="actions-row actions-row-wrap">
                <span className="badge badge-warning">{t('pages.invoices.dataReview.badge')}</span>
                <span>{t(messageKey, { count })}</span>
            </div>
            {variant === 'detail' && (invoice.data_impacts ?? []).length > 0 && (
                <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem' }}>
                    {(invoice.data_impacts ?? []).map((impact) => {
                        const summary = impactSummary(impact)
                        return (
                            <li key={impact.id}>
                                {t(summary.key, summary.params)}
                                {' · '}
                                {t('pages.invoices.dataReview.flaggedAt', { date: formatShortDate(impact.created_at.slice(0, 10), settings) })}
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
