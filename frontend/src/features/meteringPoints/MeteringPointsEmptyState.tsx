import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

type MeteringPointsEmptyStateProps = {
  canManageMeteringPoints: boolean
  hasFilters: boolean
  onOpenCreateModal: () => void
  onClearFilters: () => void
}

export function MeteringPointsEmptyState({
  canManageMeteringPoints,
  hasFilters,
  onOpenCreateModal,
  onClearFilters,
}: MeteringPointsEmptyStateProps) {
  const { t } = useTranslation()

  if (hasFilters) {
    return (
      <section className="card" style={{ margin: '1rem', display: 'grid', gap: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>{t('pages.meteringPoints.noResults.title')}</h3>
        <p className="muted" style={{ margin: 0 }}>{t('pages.meteringPoints.noResults.description')}</p>
        <div>
          <button className="button button-secondary" type="button" onClick={onClearFilters}>
            {t('pages.meteringPoints.filters.clear')}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="card" style={{ margin: '1rem', display: 'grid', gap: '0.75rem' }}>
      <h3 style={{ margin: 0 }}>{t('pages.meteringPoints.emptyState.title')}</h3>
      <p className="muted" style={{ margin: 0 }}>{t('pages.meteringPoints.emptyState.description')}</p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {canManageMeteringPoints && (
          <button className="button button-primary" type="button" onClick={onOpenCreateModal}>
            <FontAwesomeIcon icon={faPlus} fixedWidth />
            {t('pages.meteringPoints.emptyState.createAction')}
          </button>
        )}
        {canManageMeteringPoints && (
          <Link className="button button-secondary" to="/participants" style={{ textDecoration: 'none' }}>
            {t('pages.meteringPoints.emptyState.participantsAction')}
          </Link>
        )}
      </div>
    </section>
  )
}
