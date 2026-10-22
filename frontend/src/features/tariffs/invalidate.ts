import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../lib/api/queryKeys'

/** Refresh series/shared sources; await before selecting a saved tariff. */
export function invalidateTariffQueries(queryClient: QueryClient, selectedZevId?: string): Promise<void> {
    const zevId = selectedZevId || undefined
    return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tariffs.series(zevId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tariffs.dynamicSources() }),
    ]).then(() => undefined)
}
