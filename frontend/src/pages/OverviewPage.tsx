import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { SetupGuidance } from '../features/overview/SetupGuidance'
import { PageSkeleton } from '../components/PageSkeleton'
import { fetchAttention, fetchReadiness } from '../lib/api/readiness'
import { queryKeys } from '../lib/api/queryKeys'
import { useManagedZev } from '../lib/managedZev'
import { BillingPeriodsPage } from './BillingPeriodsPage'

/** Manager start page: everything that asks for operational attention. */
export function OverviewPage() {
    const { t } = useTranslation()
    const {
        managedZevs,
        selectedZevId,
        selectedZev,
        isLoading: managedZevLoading,
    } = useManagedZev()

    const readinessQuery = useQuery({
        queryKey: queryKeys.invoices.readiness(selectedZevId || undefined),
        queryFn: () => fetchReadiness(selectedZevId!),
        enabled: !!selectedZevId,
    })
    const attentionQuery = useQuery({
        queryKey: queryKeys.invoices.attention(selectedZevId || undefined),
        queryFn: () => fetchAttention(selectedZevId!),
        enabled: !!selectedZevId,
    })

    return (
        <div className="page-stack">
            <header>
                {selectedZev?.name ? <p className="eyebrow">{selectedZev.name}</p> : null}
                <h2>{t('pages.overview.title')}</h2>
                <p className="muted">{t('pages.overview.description')}</p>
            </header>

            {managedZevLoading ? (
                <PageSkeleton variant="card" />
            ) : !selectedZevId && managedZevs.length === 0 ? (
                <div className="card">{t('pages.dashboard.noZev')}</div>
            ) : !selectedZevId || !selectedZev ? (
                <div className="card">{t('pages.dashboard.selectZev')}</div>
            ) : (
                <>
                    <SetupGuidance readinessQuery={readinessQuery} />
                    <BillingPeriodsPage attentionQuery={attentionQuery} />
                </>
            )}
        </div>
    )
}
