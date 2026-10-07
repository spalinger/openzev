import { useTranslation } from 'react-i18next'
import type { DashboardBucket } from './dashboardShared'

type ResolutionSelectProps = {
    value: DashboardBucket
    onChange: (bucket: DashboardBucket) => void
}

export function ResolutionSelect({ value, onChange }: ResolutionSelectProps) {
    const { t } = useTranslation()
    return (
        <label>
            <span>{t('pages.dashboard.resolution')}</span>
            <select value={value} onChange={(e) => onChange(e.target.value as DashboardBucket)}>
                <option value="hour">{t('pages.dashboard.hourly')}</option>
                <option value="day">{t('pages.dashboard.daily')}</option>
                <option value="month">{t('pages.dashboard.monthly')}</option>
            </select>
        </label>
    )
}
