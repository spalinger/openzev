import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
    type IconDefinition,
    faCircleCheck,
    faCircleExclamation,
    faChartColumn,
    faClipboardCheck,
    faEnvelope,
    faLink,
    faLock,
    faMoneyBillWave,
    faReceipt,
    faSpinner,
} from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { invoiceStepReasonText } from './invoiceRowText'
import { InvoiceLink } from '../../components/InvoicePresentation'
import type { InvoicePeriodParticipantRow } from '../../types/api'
import {
    INVOICE_PROGRESS_STEPS,
    invoiceRowProgress,
    type InvoiceProgressStep,
    type InvoiceRowWork,
    type InvoiceStepReason,
    type InvoiceStepState,
} from './invoiceRowState'

/** Match metering and invoice icons to the sidebar. */
const STEP_ICONS: Record<InvoiceProgressStep, IconDefinition> = {
    metering: faChartColumn,
    invoice: faReceipt,
    approved: faClipboardCheck,
    sent: faEnvelope,
    paid: faMoneyBillWave,
}

/** The small mark on a step's corner; an open step carries none. */
const STATE_MARKS: Partial<Record<InvoiceStepState, IconDefinition>> = {
    done: faCircleCheck,
    active: faSpinner,
    issue: faCircleExclamation,
}

const LEGEND_STATES: InvoiceStepState[] = ['done', 'active', 'issue']

function StepIcon({ step, state, reason }: { step: InvoiceProgressStep; state: InvoiceStepState; reason?: InvoiceStepReason }) {
    const mark = STATE_MARKS[state]
    // A blocked invoice step is locked by another invoice, not merely late.
    const icon = reason === 'conflict' ? faLock : STEP_ICONS[step]
    return (
        <span className={`invoice-progress-icon invoice-progress-icon--${state}`} aria-hidden="true">
            <FontAwesomeIcon icon={icon} fixedWidth />
            {mark && (
                <span className="invoice-progress-mark">
                    <FontAwesomeIcon icon={mark} spin={state === 'active'} />
                </span>
            )}
        </span>
    )
}

type InvoiceRowProgressProps = {
    row: InvoicePeriodParticipantRow
    /** The period the page shows; links keep it for the way back. */
    period: { period_start: string; period_end: string }
    work?: InvoiceRowWork
}

/** Five workflow steps, or a representative link for an already billed period. */
export function InvoiceRowProgress({ row, period, work }: InvoiceRowProgressProps) {
    const { t } = useTranslation()
    const steps = invoiceRowProgress(row, work)

    if (!steps) {
        const covering = row.generation_eligibility
        return (
            <span className="invoice-progress-covered" title={t('pages.invoices.covered.hint')}>
                <FontAwesomeIcon icon={faLink} fixedWidth aria-hidden="true" />
                {t('pages.invoices.covered.label')}{' '}
                {covering?.invoice_id && covering.invoice_number ? (
                    <InvoiceLink
                        invoice={{ id: covering.invoice_id, invoice_number: covering.invoice_number }}
                        from="/billing/invoices"
                        period={period}
                    />
                ) : null}
            </span>
        )
    }

    return (
        <ol className="invoice-progress" aria-label={t('pages.invoices.progress.label')}>
            {steps.map(({ step, state, reason }) => {
                // Say what the step means for this row: "Invoice created",
                // "Not approved yet" — or what is under way or wrong.
                const label = reason
                    ? invoiceStepReasonText(t, reason, row)
                    : t(`pages.invoices.progress.${state === 'done' ? 'done' : 'open'}.${step}`)
                return (
                    <li key={step} className="invoice-progress-step" title={label} data-step={step} data-state={state}>
                        <StepIcon step={step} state={state} reason={reason} />
                        <span className="visually-hidden">{label}</span>
                    </li>
                )
            })}
        </ol>
    )
}

/** Names the steps and completion marks. */
export function InvoiceProgressLegend() {
    const { t } = useTranslation()
    return (
        <div className="invoice-progress-legend">
            <ul>
                {INVOICE_PROGRESS_STEPS.map((step) => (
                    <li key={step}>
                        <StepIcon step={step} state="open" />
                        {t(`pages.invoices.progress.steps.${step}`)}
                    </li>
                ))}
            </ul>
            <ul>
                {LEGEND_STATES.map((state) => {
                    const mark = STATE_MARKS[state]
                    return (
                        <li key={state}>
                            <span className={`invoice-progress-legend-mark invoice-progress-legend-mark--${state}`} aria-hidden="true">
                                {mark && <FontAwesomeIcon icon={mark} fixedWidth />}
                            </span>
                            {t(`pages.invoices.progress.states.${state}`)}
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}
