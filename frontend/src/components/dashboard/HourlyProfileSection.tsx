import { useRef, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import { hourlyKwhTick, hourlyKwhTooltipValue } from '../../lib/dashboardFormatting'
import type { HourlyProfileResponse } from '../../types/api'
import { Notice } from '../Notice'
import { PageSkeleton } from '../PageSkeleton'
import { HourlyProfileCard } from './HourlyProfileCard'

interface HourlyProfileSectionProps {
    query: Pick<UseQueryResult<HourlyProfileResponse>, 'isLoading' | 'isError' | 'isFetching' | 'refetch'>
    data: ComponentProps<typeof HourlyProfileCard>['data']
    participantName?: string
}

/** Independent profile loading, retry feedback and cached data for either dashboard. */
export function HourlyProfileSection({ query, data, participantName }: HourlyProfileSectionProps) {
    const { t } = useTranslation()
    const sectionRef = useRef<HTMLDivElement>(null)

    if (!query.isLoading && !query.isError && data.length === 0) return null

    return (
        <div
            ref={sectionRef}
            className="page-stack"
            role="group"
            aria-label={t('pages.dashboard.hourlyProfile.title')}
            tabIndex={-1}
        >
            {query.isError && (
                <Notice
                    tone="error"
                    onRetry={() => {
                        const section = sectionRef.current
                        if (section?.contains(document.activeElement)) section.focus({ preventScroll: true })
                        void query.refetch()
                    }}
                    isRetrying={query.isFetching}
                >
                    {t(data.length > 0 ? 'pages.dashboard.hourlyProfile.refreshFailed' : 'pages.dashboard.hourlyProfile.failed')}
                </Notice>
            )}
            {query.isLoading && (
                <div role="status" aria-label={t('pages.dashboard.hourlyProfile.loading')}>
                    <span className="visually-hidden">{t('pages.dashboard.hourlyProfile.loading')}</span>
                    <PageSkeleton variant="card" />
                </div>
            )}
            {data.length > 0 && (
                <HourlyProfileCard
                    data={data}
                    hourlyKwhTick={hourlyKwhTick}
                    hourlyKwhTooltipValue={hourlyKwhTooltipValue}
                    participantName={participantName}
                />
            )}
        </div>
    )
}
