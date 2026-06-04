import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
})

let refreshPromise: Promise<void> | null = null

async function refreshAccessToken(): Promise<void> {
  await axios.post(`${API_BASE_URL}/auth/token/refresh/`, null, { withCredentials: true })
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

    try {
      await refreshPromise
    } catch {
      throw error
    }

    return api.request(originalRequest)
  },
)
