import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/EmptyState'
import { useDocumentTitle } from '../lib/useDocumentTitle'

export function GuestHomePage() {
    const { t } = useTranslation()
    // No page header: the empty state's title names the page.
    useDocumentTitle(t('pages.guest.title'))
    return (
        <div className="page-stack">
            <EmptyState
                titleKey="pages.guest.title"
                descriptionKey="pages.guest.description"
                actions={[{ labelKey: 'pages.guest.accountLink', to: '/account', variant: 'secondary' }]}
            />
        </div>
    )
}
