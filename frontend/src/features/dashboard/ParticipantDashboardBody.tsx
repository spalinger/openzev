import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { fetchHourlyProfile, fetchMeteringDashboardSummary } from '../../lib/api/metering'
import { fetchInvoices } from '../../lib/api/invoices'
import { queryKeys } from '../../lib/api/queryKeys'
import { formatKwh, formatPercent } from '../../lib/numbers'
import { dashboardKwhStat, hourlyKwhTick, hourlyKwhTooltipValue, fromZevRate, kwhTick } from '../../lib/dashboardFormatting'
import { useAuth } from '../../lib/auth'
import { ownParticipantIds, selectedCommunityName } from '../../lib/membership'
import { useManagedZev } from '../../lib/managedZev'
import { PageSkeleton } from '../../components/PageSkeleton'
import { Notice } from '../../components/Notice'
import { StatCard } from '../../components/StatCard'
import { PeriodSelector } from '../../components/PeriodSelector'
import { ConsumptionSplitCard } from '../../components/dashboard/ConsumptionSplitCard'
import { EnergyFlowCard } from '../../components/dashboard/EnergyFlowCard'
import { HourlyProfileCard } from '../../components/dashboard/HourlyProfileCard'
import { ParticipantInvoicesCard } from '../../components/dashboard/ParticipantInvoicesCard'
import { type DashboardBodyProps, type DashboardBucket, useBucketLabelFormatters, useHourlyProfileRows } from './dashboardShared'
import { ResolutionSelect } from './ResolutionSelect'

export function ParticipantDashboardBody({ interval, period, onPeriodChange, periodReady }: DashboardBodyProps) {
    const { t } = useTranslation()
    const { user } = useAuth()
    const { entries, selectedZevId, selectedZev } = useManagedZev()

    const [bucket, setBucket] = useState<DashboardBucket>('day')
    const hasMultipleCommunities = (entries?.length ?? 0) > 1
    const participantZevId = hasMultipleCommunities ? selectedZevId : undefined
    const { formatBucketLabel, formatBucketTooltipLabel } = useBucketLabelFormatters(bucket)

    const summaryQuery = useQuery({
        queryKey: queryKeys.metering.dashboardSummary({
            role: user?.role,
            zevId: selectedZevId,
            participantId: '',
            from: period.from,
            to: period.to,
            bucket,
        }),
        queryFn: () =>
            fetchMeteringDashboardSummary({
                dateFrom: period.from,
                dateTo: period.to,
                bucket,
                zevId: participantZevId,
            }),
        enabled: periodReady,
    })
    const invoicesQuery = useQuery({
        queryKey: queryKeys.invoices.list(),
        queryFn: () => fetchInvoices(),
    })
    const hourlyProfileQuery = useQuery({
        queryKey: queryKeys.metering.hourlyProfile(period.from, period.to, selectedZevId || undefined),
        queryFn: () =>
            fetchHourlyProfile({
                dateFrom: period.from,
                dateTo: period.to,
                zevId: participantZevId,
            }),
        enabled: periodReady,
    })

    const summary = summaryQuery.data
    const scopeName = selectedCommunityName({ selectedZev, entries, selectedZevId })
    const participantTimeline = useMemo(
        () =>
            summary?.summary_kind === 'participant'
                ? summary.timeline.map((entry) => ({
                      ...entry,
                      from_zev_rate: summary.has_behind_meter_generation
                          ? null
                          : fromZevRate(entry.consumed_from_zev_kwh, entry.total_consumed_kwh),
                  }))
                : [],
        [summary],
    )
    const participantFromZev = useMemo(() => {
        if (summary?.summary_kind !== 'participant' || summary.has_behind_meter_generation) return null
        const { consumed_from_zev_kwh, total_consumed_kwh } = summary.totals
        const pct = fromZevRate(consumed_from_zev_kwh, total_consumed_kwh)
        return pct === null ? null : { pct, zevKwh: consumed_from_zev_kwh, totalKwh: total_consumed_kwh }
    }, [summary])
    const hourlyProfileData = useHourlyProfileRows(hourlyProfileQuery.data?.hourly_profile)
    // The list also holds invoices of communities the account manages; keep its own.
    const participantInvoicesWithPdf = useMemo(
        () => {
            const ownIds = ownParticipantIds(user)
            return (invoicesQuery.data ?? []).filter(
                (invoice) => ownIds.has(invoice.participant) && ['sent', 'paid'].includes(invoice.status) && !!invoice.pdf_url,
            )
        },
        [invoicesQuery.data, user],
    )

    return (
        <>
            <section className="card">
                <div className="grid">
                    <PeriodSelector interval={interval} from={period.from} to={period.to} onChange={onPeriodChange} />
                    <div className="inline-form inline-form--narrow">
                        <ResolutionSelect value={bucket} onChange={setBucket} />
                    </div>
                </div>
            </section>

            {summaryQuery.isLoading && <PageSkeleton variant="kpiRow" />}
            {summaryQuery.isError && (
                <Notice tone="error" onRetry={() => void summaryQuery.refetch()} isRetrying={summaryQuery.isFetching}>
                    {t('pages.dashboard.failedAnalytics')}
                </Notice>
            )}
            {summary && summary.summary_kind === 'participant' && (
                <>
                    <section className="stat-grid stat-grid--wide">
                        <StatCard label={t('pages.dashboard.participantStats.consumedFromZev')} value={dashboardKwhStat(summary.totals.consumed_from_zev_kwh)} />
                        <StatCard label={t('pages.dashboard.participantStats.importedFromGrid')} value={dashboardKwhStat(summary.totals.imported_from_grid_kwh)} />
                        <StatCard
                            label={t('pages.dashboard.participantStats.totalConsumption')}
                            value={dashboardKwhStat(summary.totals.total_consumed_kwh)}
                            hint={summary.has_behind_meter_generation ? t('behindMeter.ownHint') : undefined}
                        />
                        <StatCard
                            label={t('pages.dashboard.participantStats.fromZevShare')}
                            value={participantFromZev ? formatPercent(participantFromZev.pct) : '—'}
                            hint={
                                summary.has_behind_meter_generation
                                    ? t('behindMeter.ownHint')
                                    : participantFromZev
                                      ? t('pages.dashboard.hints.fromZevShare', {
                                            zev: formatKwh(participantFromZev.zevKwh, { maxDecimals: 0 }),
                                            total: formatKwh(participantFromZev.totalKwh, { maxDecimals: 0 }),
                                        })
                                      : undefined
                            }
                        />
                    </section>
                    {summary.zev_has_behind_meter_generation && <p className="muted">{t('behindMeter.zevNote')}</p>}
                    {summary.zev_participant_stats.length > 0 && summary.current_participant_id && (
                        <EnergyFlowCard
                            totals={summary.zev_totals}
                            participantStats={summary.zev_participant_stats}
                            highlightParticipantId={summary.current_participant_id}
                            zevName={scopeName}
                        />
                    )}
                    <ConsumptionSplitCard
                        data={participantTimeline}
                        formatBucketLabel={formatBucketLabel}
                        formatBucketTooltipLabel={formatBucketTooltipLabel}
                        kwhTick={kwhTick}
                    />
                    {hourlyProfileData.length > 0 && (
                        <HourlyProfileCard
                            data={hourlyProfileData}
                            hourlyKwhTick={hourlyKwhTick}
                            hourlyKwhTooltipValue={hourlyKwhTooltipValue}
                        />
                    )}
                    <ParticipantInvoicesCard
                        allCommunities={hasMultipleCommunities}
                        invoices={participantInvoicesWithPdf}
                        isLoading={invoicesQuery.isLoading}
                        isError={invoicesQuery.isError}
                    />
                </>
            )}
        </>
    )
}
