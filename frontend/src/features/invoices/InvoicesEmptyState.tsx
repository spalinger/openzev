import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export function InvoicesEmptyState() {
  const { t } = useTranslation()

  return (
    <section className="card" style={{ display: 'grid', gap: '0.75rem' }}>
      <h3 style={{ margin: 0 }}>{t('pages.invoices.emptyState.title')}</h3>
      <p className="muted" style={{ margin: 0 }}>{t('pages.invoices.emptyState.description')}</p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <Link className="button button-primary" to="/participants" style={{ textDecoration: 'none' }}>
          {t('pages.invoices.emptyState.participantsAction')}
        </Link>
        <Link className="button button-secondary" to="/metering-points" style={{ textDecoration: 'none' }}>
          {t('pages.invoices.emptyState.meteringPointsAction')}
        </Link>
        <Link className="button button-secondary" to="/tariffs" style={{ textDecoration: 'none' }}>
          {t('pages.invoices.emptyState.tariffsAction')}
        </Link>
      </div>
    </section>
  )
}
