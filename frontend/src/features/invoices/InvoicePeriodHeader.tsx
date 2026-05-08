import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft, faArrowRight } from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { formatShortDate } from '../../lib/appSettings'
import type { AppSettings } from '../../types/api'

type BillingInterval = 'monthly' | 'quarterly' | 'semi_annual' | 'annual'

type InvoicePeriodHeaderProps = {
  zevName?: string
  periodStart: string
  periodEnd: string
  interval: BillingInterval
  settings: AppSettings
  onPrevious: () => void
  onNext: () => void
}

export function InvoicePeriodHeader({
  zevName,
  periodStart,
  periodEnd,
  interval,
  settings,
  onPrevious,
  onNext,
}: InvoicePeriodHeaderProps) {
  const { t } = useTranslation()
  const canNavigate = !!periodStart

  return (
    <section className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
      <button className="button button-secondary" type="button" onClick={onPrevious} disabled={!canNavigate}>
        <FontAwesomeIcon icon={faArrowLeft} fixedWidth />
        {t('pages.invoices.prevPeriod')}
      </button>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700 }}>{zevName}</div>
        <div className="muted" style={{ fontSize: '0.95rem' }}>
          {periodStart && periodEnd
            ? `${formatShortDate(periodStart, settings)} -> ${formatShortDate(periodEnd, settings)}`
            : '-'}
        </div>
        <div className="muted" style={{ fontSize: '0.85rem' }}>
          {t('pages.invoices.billingInterval')} {interval.replace('_', ' ')}
        </div>
      </div>
      <button className="button button-secondary" type="button" onClick={onNext} disabled={!canNavigate}>
        {t('pages.invoices.nextPeriod')}
        <FontAwesomeIcon icon={faArrowRight} fixedWidth />
      </button>
    </section>
  )
}
