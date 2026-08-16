import { useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchEmailTemplate } from '../lib/api/invoices'
import { queryKeys } from '../lib/api/queryKeys'
import { FieldReference, insertTemplateToken } from './FieldReference'

type ZevEmailTemplateFieldsProps = {
    subjectTemplate: string
    bodyTemplate: string
    onSubjectTemplateChange: (value: string) => void
    onBodyTemplateChange: (value: string) => void
    showHeader?: boolean
}

export function ZevEmailTemplateFields({
    subjectTemplate,
    bodyTemplate,
    onSubjectTemplateChange,
    onBodyTemplateChange,
    showHeader = true,
}: ZevEmailTemplateFieldsProps) {
    const { t } = useTranslation()
    const subjectRef = useRef<HTMLInputElement>(null)
    const bodyRef = useRef<HTMLTextAreaElement>(null)

    const globalTemplateQuery = useQuery({
        queryKey: queryKeys.admin.emailTemplate('invoice_email'),
        queryFn: () => fetchEmailTemplate('invoice_email'),
    })

    const globalSubject = globalTemplateQuery.data?.subject ?? ''
    const globalBody = globalTemplateQuery.data?.body ?? ''

    const handleInsert = (variable: string, keepFocus: boolean) => {
        const active = document.activeElement
        const target =
            active === subjectRef.current || active === bodyRef.current
                ? (active as HTMLInputElement | HTMLTextAreaElement)
                : bodyRef.current
        if (target) {
            insertTemplateToken(target, variable, keepFocus)
            if (target === subjectRef.current) {
                onSubjectTemplateChange(target.value)
            } else {
                onBodyTemplateChange(target.value)
            }
        }
    }

    return (
        <>
            {showHeader && (
                <header>
                    <h3>{t('pages.zevSettings.emailTemplateTitle')}</h3>
                    <p className="muted">
                        {t('pages.zevSettings.emailTemplateDescription')}
                    </p>
                </header>
            )}

            <div className="inline-form page-stack">
                <label>
                    <span>{t('admin.emailTemplates.subject')}</span>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                            ref={subjectRef}
                            style={{ flex: 1 }}
                            value={subjectTemplate}
                            placeholder={globalSubject}
                            onChange={(event) => onSubjectTemplateChange(event.target.value)}
                        />
                        {/* Empty field = already at the global default, so
                            the reset action is meaningless and stays hidden. */}
                        {subjectTemplate !== '' && (
                            <button
                                type="button"
                                className="button button-secondary"
                                onClick={() => onSubjectTemplateChange('')}
                                title={t('pages.zevSettings.resetToGlobalDefault')}
                            >
                                {t('admin.resetToDefault')}
                            </button>
                        )}
                    </div>
                </label>

                <label>
                    <span>{t('admin.emailTemplates.body')}</span>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                        <textarea
                            ref={bodyRef}
                            style={{ flex: 1 }}
                            rows={10}
                            value={bodyTemplate}
                            placeholder={globalBody}
                            onChange={(event) => onBodyTemplateChange(event.target.value)}
                        />
                        {bodyTemplate !== '' && (
                            <button
                                type="button"
                                className="button button-secondary"
                                onClick={() => onBodyTemplateChange('')}
                                title={t('pages.zevSettings.resetToGlobalDefault')}
                            >
                                {t('admin.resetToDefault')}
                            </button>
                        )}
                    </div>
                </label>

                <FieldReference
                    groups={globalTemplateQuery.data?.fields ?? []}
                    content={`${subjectTemplate}\n${bodyTemplate}`}
                    onInsert={handleInsert}
                />
            </div>
        </>
    )
}
