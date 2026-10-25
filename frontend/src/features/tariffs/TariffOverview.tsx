import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, TariffSeries } from '../../types/api'
import { TariffCategorySections } from './TariffCategorySections'
import type { TariffOverview as TariffOverviewGroups } from './validity'

type TariffOverviewProps = {
    groups: TariffOverviewGroups
    settings: AppSettings
    onOpenDetail: (series: TariffSeries, versionId: string) => void
    expandedVersion: (series: TariffSeries) => string | null
    renderActions?: (series: TariffSeries, versionId: string) => ReactNode
    renderDetail: (series: TariffSeries, versionId: string) => ReactNode
    onCloseDetail: (series: TariffSeries) => void
}

/**
 * What is in force, what is coming, and tariffs that have ended. The
 * group says what a row's dates mean, so rows carry no status of their own.
 */
export function TariffOverview({ groups, settings, expandedVersion, renderDetail, renderActions, onOpenDetail, onCloseDetail }: TariffOverviewProps) {
    const { t } = useTranslation()
    return (
        <div className="tariff-overview">
            <section id="tariff-overview-current" aria-label={t('pages.tariffs.overview.current')} tabIndex={-1}>
                {groups.current.length > 0 ? (
                    <TariffCategorySections rows={groups.current} kind="current" settings={settings} expandedVersion={expandedVersion} renderDetail={renderDetail} renderActions={renderActions} onOpenDetail={onOpenDetail} onCloseDetail={onCloseDetail} />
                ) : (
                    <p className="muted">{t('pages.tariffs.overview.nothingCurrent')}</p>
                )}
            </section>

            {groups.history.length > 0 && (
                <section aria-labelledby="tariff-overview-ended" className="tariff-overview-history">
                    <h2 id="tariff-overview-ended" className="tariff-overview-title">{t('pages.tariffs.overview.history')}</h2>
                    <TariffCategorySections rows={groups.history} kind="history" settings={settings} expandedVersion={expandedVersion} renderDetail={renderDetail} renderActions={renderActions} onOpenDetail={onOpenDetail} onCloseDetail={onCloseDetail} />
                </section>
            )}
        </div>
    )
}
