import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type FormModalFooterProps = {
  onCancel: () => void
  isPending: boolean
  submitIcon?: ReactNode
  submitLabel?: ReactNode
  cancelIcon?: ReactNode
  /** Tighter top margin for the assignment modal variant. */
  compact?: boolean
}

export function FormModalFooter({ onCancel, isPending, submitIcon, submitLabel, cancelIcon, compact }: FormModalFooterProps) {
  const { t } = useTranslation()
  return (
    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: compact ? '0.5rem' : '1rem' }}>
      <button className="button button-secondary" type="button" onClick={onCancel}>
        {cancelIcon}
        {t('common.cancel')}
      </button>
      <button className="button button-primary" type="submit" disabled={isPending}>
        {submitIcon}
        {submitLabel ?? t('common.save')}
      </button>
    </div>
  )
}
