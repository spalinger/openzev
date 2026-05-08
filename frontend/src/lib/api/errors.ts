import axios from 'axios'

function flattenErrorMessages(data: unknown, prefix = ''): string[] {
  if (data == null) {
    return []
  }

  if (typeof data === 'string') {
    return [prefix ? `${prefix}: ${data}` : data]
  }

  if (Array.isArray(data)) {
    return data.flatMap((entry) => flattenErrorMessages(entry, prefix))
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    return entries.flatMap(([key, value]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key
      return flattenErrorMessages(value, nextPrefix)
    })
  }

  return [prefix ? `${prefix}: ${String(data)}` : String(data)]
}

export function formatApiError(error: unknown, fallbackMessage = 'Request failed.'): string {
  if (!axios.isAxiosError(error)) {
    return fallbackMessage
  }

  const responseData = error.response?.data
  if (!responseData) {
    return error.message || fallbackMessage
  }

  if (typeof responseData === 'string') {
    return responseData
  }

  if (typeof responseData === 'object' && responseData !== null) {
    const detail = (responseData as { detail?: unknown }).detail
    if (typeof detail === 'string' && detail.trim()) {
      return detail
    }
  }

  const flattened = flattenErrorMessages(responseData)
  if (!flattened.length) {
    return fallbackMessage
  }

  const cleaned = flattened
    .map((entry) => entry.replace(/^non_field_errors\.?/i, 'Validation'))
    .map((entry) => entry.replace(/\./g, ' → '))

  return cleaned.join(' | ')
}
