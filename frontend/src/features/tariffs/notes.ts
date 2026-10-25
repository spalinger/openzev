import type { TariffSeries } from '../../types/api'

export function sharedTariffNotes(series: TariffSeries): string | undefined {
    const notes = series.versions[0]?.notes?.trim()
    return notes && series.versions.every(version => version.notes?.trim() === notes) ? notes : undefined
}
