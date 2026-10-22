import { useTranslation } from 'react-i18next'
import type { AppSettings, TariffPeriod, TariffSeries } from '../../types/api'
import { TariffCategorySections } from './TariffCategorySections'
import type { TariffOverview as TariffOverviewGroups } from './validity'

type TariffOverviewProps = {
    groups: TariffOverviewGroups
    settings: AppSettings
    /** The series and version shown in the detail pane, so its row can be highlighted. */
    selected: { seriesKey: string, versionId: string } | null
    onOpenDetail: (series: TariffSeries, versionId: string) => void
    onCloseDetail: () => void
    onRepairBand?: (series: TariffSeries, versionId: string, period?: TariffPeriod) => void
}

/**
 * What is in force, what is coming, and tariffs that have ended. The
 * group says what a row's dates mean, so rows carry no status of their own.
 */
export function TariffOverview({ groups, settings, selected, onOpenDetail, onCloseDetail, onRepairBand }: TariffOverviewProps) {
    const { t } = useTranslation()
    return (
        <div className="tariff-overview">
            <section id="tariff-overview-current" aria-label={t('pages.tariffs.overview.current')} tabIndex={-1}>
                {groups.current.length > 0 ? (
                    <TariffCategorySections rows={groups.current} kind="current" settings={settings} selected={selected} onOpenDetail={onOpenDetail} onCloseDetail={onCloseDetail} onRepairBand={onRepairBand} />
                ) : (
                    <p className="muted">{t('pages.tariffs.overview.nothingCurrent')}</p>
                )}
            </section>

            {groups.history.length > 0 && (
                <section aria-labelledby="tariff-overview-ended" className="tariff-overview-history">
                    <h2 id="tariff-overview-ended" className="tariff-overview-title">{t('pages.tariffs.overview.history')}</h2>
                    <TariffCategorySections rows={groups.history} kind="history" settings={settings} selected={selected} onOpenDetail={onOpenDetail} onCloseDetail={onCloseDetail} onRepairBand={onRepairBand} />
                </section>
            )}
        </div>
    )
}
