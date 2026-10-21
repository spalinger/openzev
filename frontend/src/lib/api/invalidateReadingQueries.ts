import type { QueryClient } from '@tanstack/react-query'

/** Reading mutations also change invoice review and billing readiness. */
export function invalidateReadingQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['metering'] })
  void queryClient.invalidateQueries({ queryKey: ['invoices'] })
}
