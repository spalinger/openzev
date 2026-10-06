import type { TFunction } from 'i18next'
import type { InvoicePeriodParticipantRow } from '../../types/api'
import type { InvoiceStepReason } from './invoiceRowState'

export function invoiceStepReasonText(t: TFunction, reason: InvoiceStepReason, row: InvoicePeriodParticipantRow): string {
    switch (reason) {
        case 'metering':
            return row.metering_points_total === 0
                ? t('pages.invoices.issues.meteringNoPoints')
                : t('pages.invoices.issues.metering', {
                    missing: row.metering_points_total - row.metering_points_with_data,
                    total: row.metering_points_total,
                })
        case 'conflict':
            return t('pages.invoices.issues.conflict', { number: row.generation_eligibility?.invoice_number ?? '' })
        case 'pdf':
        case 'delivery':
        case 'noEmail':
            return t(`pages.invoices.issues.${reason}`)
        default:
            return t(`pages.invoices.progress.reasons.${reason}`)
    }
}
