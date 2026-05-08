import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ACCESS_KEY,
  REFRESH_KEY,
  IMPERSONATION_ACCESS_KEY,
  IMPERSONATION_REFRESH_KEY,
  IMPERSONATOR_KEY,
  api,
} from '../src/lib/api/client'

describe('api refresh interceptor', () => {
  let apiMock: MockAdapter
  let axiosMock: MockAdapter

  beforeEach(() => {
    localStorage.clear()
    apiMock = new MockAdapter(api)
    axiosMock = new MockAdapter(axios)
  })

  afterEach(() => {
    apiMock.restore()
    axiosMock.restore()
    localStorage.clear()
  })

  it('refreshes token on 401 and retries original request', async () => {
    localStorage.setItem(ACCESS_KEY, 'expired-token')
    localStorage.setItem(REFRESH_KEY, 'refresh-token')

    apiMock
      .onGet('/protected')
      .replyOnce(401)
      .onGet('/protected')
      .reply((config) => [200, { ok: true, authorization: config.headers?.Authorization }])

    axiosMock.onPost('/api/v1/auth/token/refresh/').reply(200, { access: 'new-token' })

    const response = await api.get('/protected')

    expect(response.data.ok).toBe(true)
    expect(response.data.authorization).toBe('Bearer new-token')
    expect(localStorage.getItem(ACCESS_KEY)).toBe('new-token')
  })

  it('clears auth storage when refresh fails', async () => {
    localStorage.setItem(ACCESS_KEY, 'expired-token')
    localStorage.setItem(REFRESH_KEY, 'invalid-refresh-token')
    localStorage.setItem(IMPERSONATION_ACCESS_KEY, 'old-admin-access')
    localStorage.setItem(IMPERSONATION_REFRESH_KEY, 'old-admin-refresh')
    localStorage.setItem(IMPERSONATOR_KEY, JSON.stringify({ id: 1 }))

    apiMock.onGet('/protected').replyOnce(401)
    axiosMock.onPost('/api/v1/auth/token/refresh/').reply(401)

    await expect(api.get('/protected')).rejects.toBeDefined()

    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
    expect(localStorage.getItem(IMPERSONATION_ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(IMPERSONATION_REFRESH_KEY)).toBeNull()
    expect(localStorage.getItem(IMPERSONATOR_KEY)).toBeNull()
  })

  it('reuses one refresh request for concurrent 401 responses', async () => {
    localStorage.setItem(ACCESS_KEY, 'expired-token')
    localStorage.setItem(REFRESH_KEY, 'refresh-token')

    apiMock.onGet('/protected-a').replyOnce(401).onGet('/protected-a').reply(200, { ok: 'a' })
    apiMock.onGet('/protected-b').replyOnce(401).onGet('/protected-b').reply(200, { ok: 'b' })
    axiosMock.onPost('/api/v1/auth/token/refresh/').reply(200, { access: 'new-token' })

    const [responseA, responseB] = await Promise.all([api.get('/protected-a'), api.get('/protected-b')])

    expect(responseA.data.ok).toBe('a')
    expect(responseB.data.ok).toBe('b')
    expect(localStorage.getItem(ACCESS_KEY)).toBe('new-token')
    expect(axiosMock.history.post).toHaveLength(1)
  })
})
