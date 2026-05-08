import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDownload, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { FormModal } from '../../components/FormModal'

type TariffExportModalProps = {
  isOpen: boolean
  isPending: boolean
  onClose: () => void
  onConfirmExport: () => void
}

export function TariffExportModal({ isOpen, isPending, onClose, onConfirmExport }: TariffExportModalProps) {
  const { t } = useTranslation()

  return (
    <FormModal
      isOpen={isOpen}
      title={t('pages.tariffs.exportModalTitle')}
      onClose={onClose}
      maxWidth="520px"
    >
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="button button-secondary" type="button" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} fixedWidth />
            {t('pages.tariffs.cancel')}
          </button>
          <button className="button button-primary" type="button" onClick={onConfirmExport} disabled={isPending}>
            <FontAwesomeIcon icon={faDownload} fixedWidth />
            {t('pages.tariffs.export')}
          </button>
        </div>
      </div>
    </FormModal>
  )
}
