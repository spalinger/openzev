import { useId, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Z_MODAL } from '../lib/zLayers'
import { useDialogBehavior } from './useDialogBehavior'

interface FormModalProps {
    isOpen: boolean
    title: string
    children: ReactNode
    onClose: () => void
    maxWidth?: string
    returnFocusRef?: RefObject<HTMLElement | null>
}

export function FormModal({ isOpen, title, children, onClose, maxWidth = '600px', returnFocusRef }: FormModalProps) {
    const { t } = useTranslation()
    const titleId = useId()
    const { dialogRef, depth, isTop } = useDialogBehavior({ isOpen, onClose, returnFocusRef })

    if (!isOpen) return null

    return (
        <div
            className="dialog-scrim"
            style={{ zIndex: Z_MODAL + depth }}
            onClick={() => { if (isTop()) onClose() }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal={isTop() || undefined}
                aria-labelledby={titleId}
                tabIndex={-1}
                className="form-modal"
                style={{ maxWidth }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="form-modal-header">
                    <h2 id={titleId}>{title}</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('common.close')}
                        className="form-modal-close"
                    >
                        <span aria-hidden="true">✕</span>
                    </button>
                </div>
                {children}
            </div>
        </div>
    )
}
