import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faDownload,
  faPlus,
  faUpload,
} from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'

type TariffToolbarProps = {
  tariffCount: number
  energyTariffCount: number
  tariffsWithPeriodsCount: number
  periodCount: number
  onOpenCreateTariffModal: () => void
  onOpenExportModal: () => void
  onOpenImportModal: () => void
}

export function TariffToolbar({
  tariffCount,
  energyTariffCount,
  tariffsWithPeriodsCount,
  periodCount,
  onOpenCreateTariffModal,
  onOpenExportModal,
  onOpenImportModal,
}: TariffToolbarProps) {
  const { t } = useTranslation()

  return (
    <section className="card tariff-toolbar">
      <div className="tariff-toolbar-header">
        <div className="tariff-summary" aria-label={t('pages.tariffs.summaryLabel')}>
          <span className="tariff-summary-stat">
            <span className="tariff-summary-label">{t('pages.tariffs.summary.total')}</span>
            <span className="tariff-summary-value">{tariffCount}</span>
          </span>
          <span className="tariff-summary-stat">
            <span className="tariff-summary-label">{t('pages.tariffs.summary.energyBased')}</span>
            <span className="tariff-summary-value">{energyTariffCount}</span>
          </span>
          <span className="tariff-summary-stat">
            <span className="tariff-summary-label">{t('pages.tariffs.summary.withPeriods')}</span>
            <span className="tariff-summary-value">{tariffsWithPeriodsCount}</span>
          </span>
          <span className="tariff-summary-stat">
            <span className="tariff-summary-label">{t('pages.tariffs.summary.totalPeriods')}</span>
            <span className="tariff-summary-value">{periodCount}</span>
          </span>
        </div>

        <div className="actions-row actions-row-wrap">
          <button className="button button-primary" onClick={onOpenCreateTariffModal}>
            <FontAwesomeIcon icon={faPlus} fixedWidth />
            {t('pages.tariffs.newTariff')}
          </button>
          <button className="button button-secondary" onClick={onOpenExportModal}>
            <FontAwesomeIcon icon={faDownload} fixedWidth />
            {t('pages.tariffs.exportJson')}
          </button>
          <button className="button button-secondary" onClick={onOpenImportModal}>
            <FontAwesomeIcon icon={faUpload} fixedWidth />
            {t('pages.tariffs.importJson')}
          </button>
        </div>
      </div>
    </section>
  )
}
