import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { FormModal } from '../../components/FormModal'

type TariffImportModalProps = {
  isOpen: boolean
  onClose: () => void
  onImportFile: (event: React.ChangeEvent<HTMLInputElement>) => void
}

export function TariffImportModal({ isOpen, onClose, onImportFile }: TariffImportModalProps) {
  const { t } = useTranslation()

  return (
    <FormModal
      isOpen={isOpen}
      title={t('pages.tariffs.importModalTitle')}
      onClose={onClose}
      maxWidth="520px"
    >
      <div style={{ display: 'grid', gap: '1rem' }}>
        <label>
          <span>{t('pages.tariffs.form.jsonFile')}</span>
          <input type="file" accept="application/json,.json" onChange={onImportFile} />
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="button button-secondary" type="button" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} fixedWidth />
            {t('pages.tariffs.close')}
          </button>
        </div>
      </div>
    </FormModal>
  )
}
