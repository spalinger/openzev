import type { Tariff, TariffSeries, TariffVersion } from '../../types/api'

type ValidityState = 'active' | 'scheduled' | 'expired'

/**
 * Where a tariff sits relative to `today`.
 *
 * Compared as ISO strings rather than `Date` objects: `new Date('2026-01-01')`
 * parses as UTC midnight, which reintroduces the offset that
 * `lib/dates.todayBusinessIso` exists to avoid. Lexicographic comparison of two
 * `YYYY-MM-DD` strings is exact.
 *
 * Both bounds are inclusive, so a tariff whose window opens or closes today is
 * active.
 */
export function validityState(tariff: Tariff, today: string): ValidityState {
    if (tariff.valid_from > today) return 'scheduled'
    if (tariff.valid_to && tariff.valid_to < today) return 'expired'
    return 'active'
}

/**
 * The version a list row stands for: the one in force, else the next to start,
 * else the newest one — a series with nothing in force shows what comes or
 * what was, not its oldest version. `versions` are newest first, as the series
 * endpoint sends them.
 */
export function listedVersion<T extends Tariff>(versions: T[], today: string): T {
    const next = versions.findLast((version) => validityState(version, today) === 'scheduled')
    return versions.find((version) => validityState(version, today) === 'active')
        ?? next
        ?? versions[0]
}

/** A list row: the series, and the one version the row stands for. */
export type TariffOverviewRow = { series: TariffSeries, version: TariffVersion, upcomingVersion?: TariffVersion }

export type TariffOverview = {
    current: TariffOverviewRow[]
    history: TariffOverviewRow[]
}

/**
 * One row per current/upcoming tariff, plus tariffs that have ended entirely.
 * Earlier versions of a current or upcoming tariff live only in its detail.
 * Versions arrive newest first, so the last scheduled one is the next to start.
 */
export function tariffOverview(series: TariffSeries[], today: string): TariffOverview {
    const overview: TariffOverview = { current: [], history: [] }
    for (const entry of series) {
        const active = entry.versions.find((version) => validityState(version, today) === 'active')
        const next = entry.versions.findLast((version) => validityState(version, today) === 'scheduled')
        const ended = entry.versions.find((version) => validityState(version, today) === 'expired')
        const shown = active ?? next
        if (shown) overview.current.push({ series: entry, version: shown, upcomingVersion: active ? next : undefined })
        if (ended && !active && !next) overview.history.push({ series: entry, version: ended })
    }
    return overview
}
