import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

export const ACCESS_KEY = 'openzev.access'
export const REFRESH_KEY = 'openzev.refresh'
export const IMPERSONATION_ACCESS_KEY = 'openzev.impersonation.original_access'
export const IMPERSONATION_REFRESH_KEY = 'openzev.impersonation.original_refresh'
export const IMPERSONATOR_KEY = 'openzev.impersonation.impersonator'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

export const api = axios.create({
  baseURL: API_BASE_URL,
})

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const accessToken = localStorage.getItem(ACCESS_KEY)
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_KEY)
  if (!refreshToken) {
    return null
  }

  try {
    const { data } = await axios.post<{ access: string }>(`${API_BASE_URL}/auth/token/refresh/`, {
      refresh: refreshToken,
    })

    localStorage.setItem(ACCESS_KEY, data.access)
    return data.access
  } catch {
    return null
  }
}

function clearAuthStorage() {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(IMPERSONATION_ACCESS_KEY)
  localStorage.removeItem(IMPERSONATION_REFRESH_KEY)
  localStorage.removeItem(IMPERSONATOR_KEY)
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status
    const originalRequest = error.config

    if (
      status !== 401 ||
      !originalRequest ||
      (originalRequest as InternalAxiosRequestConfig & { _retry?: boolean })._retry ||
      originalRequest.url?.includes('/auth/token/')
    ) {
      throw error
    }

    ;(originalRequest as InternalAxiosRequestConfig & { _retry?: boolean })._retry = true

    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null
      })
    }

    const newAccessToken = await refreshPromise
    if (!newAccessToken) {
      clearAuthStorage()
      throw error
    }

    originalRequest.headers = originalRequest.headers ?? {}
    originalRequest.headers.Authorization = `Bearer ${newAccessToken}`

    return api.request(originalRequest)
  },
)
