// Compatibility barrel: keep legacy import path while delegating to domain modules.
export { API_BASE_URL, api } from './api/client'
export { formatApiError } from './api/errors'

export * from './api/auth'
export * from './api/invoices'
export * from './api/metering'
export * from './api/tariffs'
export * from './api/zev'
