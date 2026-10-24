import { apiErrorPayload, formatApiError } from '../../lib/api/errors'

export function formatTariffError(error: unknown, fallback: string, t: (key: string) => string): string {
  const payload = apiErrorPayload(error)
  const periodTypeErrors = payload?.period_type
  const messages = Array.isArray(periodTypeErrors) ? periodTypeErrors : [periodTypeErrors]
  // shortcut: matches the API's existing text; switch to an error code when the API exposes one.
  if (messages.some(message => typeof message === 'string'
    && message.startsWith('A flat band and a timed band cannot both apply in months '))) {
    return t('pages.tariffs.form.errorFlatTimed')
  }
  if (['time_from', 'time_to'].some(field => {
    const errors = payload?.[field]
    return (Array.isArray(errors) ? errors : [errors]).includes('A timed band needs both a start and an end time.')
  })) {
    return t('pages.tariffs.form.errorTimedBand')
  }
  return formatApiError(error, fallback)
}
