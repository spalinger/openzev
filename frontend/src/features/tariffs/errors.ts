import { apiErrorPayload, formatApiError } from '../../lib/api/errors'

export function formatTariffError(error: unknown, fallback: string, t: (key: string) => string): string {
  const periodTypeErrors = apiErrorPayload(error)?.period_type
  const messages = Array.isArray(periodTypeErrors) ? periodTypeErrors : [periodTypeErrors]
  // shortcut: matches the API's existing text; switch to an error code when the API exposes one.
  if (messages.some(message => typeof message === 'string'
    && message.startsWith('A flat band and a timed band cannot both apply in months '))) {
    return t('pages.tariffs.form.errorFlatTimed')
  }
  return formatApiError(error, fallback)
}
