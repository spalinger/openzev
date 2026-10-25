import type { TariffSeries } from '../../types/api'

/** URL and expansion identity shared by every version of a series. */
export function seriesKeyOf(series: Pick<TariffSeries, 'zev' | 'name'>): string {
    return `${series.zev}:${series.name}`
}
