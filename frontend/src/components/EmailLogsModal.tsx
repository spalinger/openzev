import { type EmailLog } from '../types/api'
import { formatDateTime, useAppSettings } from '../lib/appSettings'
import { Z_MODAL } from '../lib/zLayers'
import { useTranslation } from 'react-i18next'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRotate, faXmark } from '@fortawesome/free-solid-svg-icons'

interface EmailLogsModalProps {
    invoiceNumber: string
    emailLogs: EmailLog[]
    isOpen: boolean
    onClose: () => void
    onRetry?: (emailLogId: string) => void
    isRetrying?: boolean
}

export function EmailLogsModal({
    invoiceNumber,
    emailLogs,
    isOpen,
    onClose,
    onRetry,
    isRetrying = false,
}: EmailLogsModalProps) {
    const { t } = useTranslation()
    const { settings } = useAppSettings()

    const statusLabels: Record<string, string> = {
        pending: t('pages.invoices.emailLogs.status.pending'),
        sent: t('pages.invoices.emailLogs.status.sent'),
        failed: t('pages.invoices.emailLogs.status.failed'),
        unknown: t('pages.invoices.emailLogs.status.unknown'),
    }

    if (!isOpen) return null

    return (
        <div className="dialog-scrim" style={{ zIndex: Z_MODAL }} onClick={onClose}>
            <div className="card email-logs-dialog" onClick={(e) => e.stopPropagation()}>
                <h3 className="mb-15">{t('pages.invoices.emailLogs.title', { number: invoiceNumber })}</h3>

                {emailLogs.length === 0 ? (
                    <p className="email-logs-empty">{t('pages.invoices.emailLogs.empty')}</p>
                ) : (
                    <div className="email-logs-list">
                        {emailLogs.map((log) => (
                            <div key={log.id} className="email-log">
                                <div className="email-log-header">
                                    <div>
                                        <strong>{log.recipient}</strong>
                                        <div className="email-log-subject">
                                            {t('pages.invoices.emailLogs.subject', { subject: log.subject })}
                                        </div>
                                    </div>
                                    <div className={`email-log-status email-log-status--${log.status}`}>
                                        {statusLabels[log.status] ?? t('pages.invoices.emailLogs.status.unknown')}
                                    </div>
                                </div>

                                <div className="email-log-meta">
                                    <div>{t('pages.invoices.emailLogs.queued')} {formatDateTime(log.created_at, settings)}</div>
                                    {log.sent_at && <div>{t('pages.invoices.emailLogs.sent')} {formatDateTime(log.sent_at, settings)}</div>}
                                </div>

                                {log.error_message && (
                                    <div className="email-log-error">
                                        {log.error_message}
                                    </div>
                                )}

                                {log.status === 'failed' && onRetry && (
                                    <button
                                        className="button button-primary button-compact"
                                        onClick={() => onRetry(log.id)}
                                        disabled={isRetrying}
                                        type="button"
                                    >
                                        <FontAwesomeIcon icon={faRotate} fixedWidth />
                                        {isRetrying ? t('pages.invoices.emailLogs.retrying') : t('pages.invoices.emailLogs.retry')}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <div className="dialog-actions email-logs-footer">
                    <button className="button button-secondary" onClick={onClose} type="button">
                        <FontAwesomeIcon icon={faXmark} fixedWidth />
                        {t('common.close')}
                    </button>
                </div>
            </div>
        </div>
    )
}
