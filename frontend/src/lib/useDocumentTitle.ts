import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/** Set the tab title, "Page · Scope – OpenZEV"; left unchanged on unmount (the next page sets its own). */
export function useDocumentTitle(page?: string, scope?: string) {
    const { t } = useTranslation()
    const app = t('app.title')

    useEffect(() => {
        if (!page) return
        document.title = scope
            ? t('app.documentTitleScoped', { page, scope, app })
            : t('app.documentTitle', { page, app })
    }, [page, scope, app, t])
}
