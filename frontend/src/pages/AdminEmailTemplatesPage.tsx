import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Tabs } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { PageSkeleton } from '../components/PageSkeleton'
import { useTranslation } from 'react-i18next'
import {
    fetchEmailTemplate,
    resetEmailTemplate,
    updateEmailTemplate,
} from '../lib/api/invoices'
import { queryKeys } from '../lib/api/queryKeys'
import { useToast } from '../lib/toast'
import { FieldReference, insertTemplateToken } from '../components/FieldReference'

type TemplateKey = 'invoice_email' | 'participant_invitation' | 'email_verification'

function EmailTemplateEditor({
    templateKey,
    title,
}: {
    templateKey: TemplateKey
    title: string
}) {
    const { t } = useTranslation()
    const { pushToast } = useToast()
    const queryClient = useQueryClient()
    const subjectRef = useRef<HTMLInputElement>(null)
    const bodyRef = useRef<HTMLTextAreaElement>(null)

    const query = useQuery({
        queryKey: queryKeys.admin.emailTemplate(templateKey),
        queryFn: () => fetchEmailTemplate(templateKey),
    })

    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')

    useEffect(() => {
        if (query.data) {
            setSubject(query.data.subject)
            setBody(query.data.body)
        }
    }, [query.data])

    const saveMutation = useMutation({
        mutationFn: () => updateEmailTemplate(templateKey, subject, body),
        onSuccess: (result) => {
            pushToast(result.detail ?? t('common.save'), 'success')
            void queryClient.invalidateQueries({ queryKey: queryKeys.admin.emailTemplate(templateKey) })
        },
        onError: () => pushToast(t('common.error'), 'error'),
    })

    const resetMutation = useMutation({
        mutationFn: () => resetEmailTemplate(templateKey),
        onSuccess: (result) => {
            pushToast(result.detail ?? t('admin.resetToDefault'), 'success')
            void queryClient.invalidateQueries({ queryKey: queryKeys.admin.emailTemplate(templateKey) })
        },
        onError: () => pushToast(t('common.error'), 'error'),
    })

    const handleInsert = (variable: string, keepFocus: boolean) => {
        const active = document.activeElement
        const target =
            active === subjectRef.current || active === bodyRef.current
                ? (active as HTMLInputElement | HTMLTextAreaElement)
                : bodyRef.current
        if (target) {
            insertTemplateToken(target, variable, keepFocus)
            if (target === subjectRef.current) {
                setSubject(target.value)
            } else {
                setBody(target.value)
            }
        }
    }

    return (
        <div className="content-with-aside">
            <section className="card page-stack">
                <div className="actions-row">
                    <h3 style={{ margin: 0 }}>{title}</h3>
                    {query.data?.is_customized && (
                        <span className="badge badge-info">{t('admin.customized')}</span>
                    )}
                </div>
                {query.isLoading && <PageSkeleton variant="card" />}
                {query.isError && <p className="error-banner">{t('common.error')}</p>}
                {query.data && (
                    <>
                        <label>
                            <span>{t('admin.emailTemplates.subject')}</span>
                            <input
                                ref={subjectRef}
                                type="text"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                            />
                        </label>
                        <label>
                            <span>{t('admin.emailTemplates.body')}</span>
                            <textarea
                                className="mono-editor"
                                rows={24}
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                            />
                        </label>
                        <div className="actions-row">
                            <button
                                className="button"
                                type="button"
                                disabled={saveMutation.isPending || resetMutation.isPending}
                                onClick={() => saveMutation.mutate()}
                            >
                                {saveMutation.isPending ? t('common.saving') : t('common.save')}
                            </button>
                            {query.data.is_customized && (
                                <button
                                    className="button button-secondary"
                                    type="button"
                                    disabled={saveMutation.isPending || resetMutation.isPending}
                                    onClick={() => resetMutation.mutate()}
                                >
                                    {resetMutation.isPending ? t('common.loading') : t('admin.resetToDefault')}
                                </button>
                            )}
                        </div>
                    </>
                )}
            </section>
<FieldReference
                groups={query.data?.fields ?? []}
                content={`${subject}\n${body}`}
                onInsert={handleInsert}
            />
        </div>
    )
}

export function AdminEmailTemplatesPage() {
    const { t } = useTranslation()
    const [activeTab, setActiveTab] = useState<TemplateKey>('invoice_email')

    const tabs: { key: TemplateKey; label: string }[] = [
        { key: 'invoice_email', label: t('admin.emailTemplates.invoiceEmail') },
        { key: 'participant_invitation', label: t('admin.emailTemplates.invitationEmail') },
        { key: 'email_verification', label: t('admin.emailTemplates.verificationEmail') },
    ]

    return (
        <div className="page-stack">
            <header>
                <p className="eyebrow">{t('nav.adminConsole')}</p>
                <h2>{t('admin.emailTemplates.title')}</h2>
                <p className="muted">
                    {t('admin.emailTemplates.description')}
                </p>
            </header>

            <Tabs
                classNames={{ root: 'app-tabs', list: 'app-tabs-list', tab: 'app-tabs-tab' }}
                value={activeTab}
                keepMounted={false}
                onChange={(value) => {
                    if (value) setActiveTab(value as TemplateKey)
                }}
            >
                <Tabs.List aria-label={t('admin.emailTemplates.title')}>
                    {tabs.map((tab) => (
                        <Tabs.Tab key={tab.key} value={tab.key}>
                            {tab.label}
                        </Tabs.Tab>
                    ))}
                </Tabs.List>

{tabs.map((tab) => (
                    <Tabs.Panel key={tab.key} value={tab.key}>
                        <EmailTemplateEditor
                            templateKey={tab.key}
                            title={tab.label}
                        />
                    </Tabs.Panel>
                ))}
            </Tabs>
        </div>
    )
}
