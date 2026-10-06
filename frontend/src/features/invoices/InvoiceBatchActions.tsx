import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDownload, faEllipsis } from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { ActionMenu, type ActionMenuItem } from '../../components/ActionMenu'

type InvoiceBatchActionsProps = {
  /** The promoted next batch step, or null when the period holds no work. */
  recommendedAction: ActionMenuItem | null
  menuItems: ActionMenuItem[]
  /** Stored documents in the period; drives the download button. */
  pdfCount: number
  anyBatchPending: boolean
  onDownloadAll: () => void
}

/** Period-wide actions: next step, PDF download and overflow. */
export function InvoiceBatchActions({
  recommendedAction,
  menuItems,
  pdfCount,
  anyBatchPending,
  onDownloadAll,
}: InvoiceBatchActionsProps) {
  const { t } = useTranslation()

  const menuActions = menuItems.filter((item) => item.key !== recommendedAction?.key)
  const hasMenu = menuActions.length > 0 && (anyBatchPending || menuActions.some((item) => !item.disabled))
  if (!recommendedAction && pdfCount === 0 && !hasMenu) return null

  return (
    <div className="invoice-batch-actions" role="group" aria-label={t('pages.invoices.batch.title')}>
      {recommendedAction && (
        <button
          className="button button-primary"
          type="button"
          disabled={recommendedAction.disabled}
          onClick={recommendedAction.onClick}
        >
          {recommendedAction.icon}
          {recommendedAction.label}
        </button>
      )}
      {/* Omitted with nothing to act on; disabled only while a batch runs. */}
      {pdfCount > 0 && (
        <button
          className="button button-secondary"
          type="button"
          disabled={anyBatchPending}
          onClick={onDownloadAll}
        >
          <FontAwesomeIcon icon={faDownload} fixedWidth />
          {t('pages.invoices.batch.downloadAll')} ({pdfCount})
        </button>
      )}
      {hasMenu && (
        <ActionMenu
          label={t('pages.invoices.moreBatchActions')}
          iconOnly
          icon={<FontAwesomeIcon icon={faEllipsis} fixedWidth />}
          items={menuActions}
        />
      )}
    </div>
  )
}
