import { useTranslation } from 'react-i18next'
import { useCommunityAccess, useScopeNote } from '../lib/communityAccess'
import { selectedCommunityName } from '../lib/membership'
import { useManagedZev } from '../lib/managedZev'
import { ScopeGuard } from '../components/ScopeGuard'
import { PageHeader } from '../components/PageHeader'
import { ManagementDashboardBody } from '../features/dashboard/ManagementDashboardBody'
import { ParticipantDashboardBody } from '../features/dashboard/ParticipantDashboardBody'
import { type BillingInterval } from '../lib/billingPeriod'
import { useBillingPeriodParams } from '../lib/useBillingPeriodParams'

export function DashboardPage() {
    const { t } = useTranslation()
    const scopeNote = useScopeNote()
    const { entries, selectedZevId, selectedZev } = useManagedZev()
    const { isZevScope: isZevScopedRole, isParticipantScope } = useCommunityAccess()

    const interval: BillingInterval = (selectedZev?.billing_interval as BillingInterval) ?? 'monthly'
    const { period, setPeriod, isReady: periodReady } = useBillingPeriodParams({
        interval,
        ready: isZevScopedRole ? !!selectedZev : isParticipantScope,
        scopeId: selectedZevId,
        fallback: 'current',
        scopeChange: 'reset',
    })
    const periodProps = { interval, period, onPeriodChange: setPeriod, periodReady }

    const scopeName = selectedCommunityName({ selectedZev, entries, selectedZevId })

    return (
        <div className="page-stack">
            <PageHeader
                eyebrow={scopeName}
                scopeNote={scopeNote}
                title={t(isZevScopedRole ? 'pages.energyBalancePage.title' : 'dashboard.title')}
                description={t(isZevScopedRole ? 'pages.energyBalancePage.description' : 'dashboard.description')}
            />

            <ScopeGuard skeleton="kpiRow">
                {isZevScopedRole ? (
                    <ManagementDashboardBody {...periodProps} />
                ) : isParticipantScope ? (
                    <ParticipantDashboardBody {...periodProps} />
                ) : null}
            </ScopeGuard>
        </div>
    )
}
