import { EmptyState } from '../components/EmptyState'

export function GuestHomePage() {
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
