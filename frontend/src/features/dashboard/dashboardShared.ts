import { useMemo } from 'react'
import { formatMeteringBucketLabel } from '../../lib/meteringLabels'
import { useAppSettings } from '../../lib/appSettings'
import type { BillingInterval } from '../../lib/billingPeriod'
import type { BillingRange } from '../../lib/useBillingPeriodParams'
import type { HourlyProfileEntry } from '../../types/api'

export type DashboardBucket = 'hour' | 'day' | 'month'

/** The billing period the page owns and hands to either body. */
export type DashboardBodyProps = {
    interval: BillingInterval | undefined
    period: BillingRange
    onPeriodChange: (range: BillingRange) => void
    periodReady: boolean
}

export function useBucketLabelFormatters(bucket: DashboardBucket) {
    const { settings } = useAppSettings()
    const formatBucketLabel = (value: string) => formatMeteringBucketLabel(value, bucket, settings)
    const formatBucketTooltipLabel = (label: unknown) => formatBucketLabel(String(label ?? ''))
    return { formatBucketLabel, formatBucketTooltipLabel }
}

export function useHourlyProfileRows(hourlyProfile: HourlyProfileEntry[] | null | undefined) {
    return useMemo(
        () => hourlyProfile?.map((entry) => ({ ...entry, label: `${String(entry.hour).padStart(2, '0')}:00` })) ?? [],
        [hourlyProfile],
    )
}
