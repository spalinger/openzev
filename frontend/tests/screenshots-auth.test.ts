// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'

// Helpers use Playwright assertions; keep these request-level regressions in
// the unit suite without invoking the screenshot runner or a demo server.
vi.mock('@playwright/test', async () => ({ expect: (await import('vitest')).expect }))

import { API_BASE, DEMO_ZEV_NAME, getAdminToken, pinDemoZev } from '../screenshots/helpers'

function mockPage(cookieValues: Array<string | undefined>, status = 200) {
  const cookies = vi.fn()
  for (const value of cookieValues) {
    cookies.mockResolvedValueOnce(value ? [{ name: 'openzev_access', value }] : [])
  }
  const post = vi.fn().mockResolvedValue({ ok: () => status === 200, status: () => status })
  const page = {
    context: () => ({ cookies }),
    request: { post },
  } as unknown as Page
  return { page, cookies, post }
}

describe('screenshot authentication', () => {
  it('reuses the saved API cookie without spending another login', async () => {
    const { page, cookies, post } = mockPage(['saved-access'])
    await expect(getAdminToken(page)).resolves.toBe('saved-access')
    expect(cookies).toHaveBeenCalledWith(API_BASE)
    expect(post).not.toHaveBeenCalled()
  })

  it('logs in exactly once when the context has no API access cookie', async () => {
    const { page, post } = mockPage([undefined, 'new-access'])
    await expect(getAdminToken(page)).resolves.toBe('new-access')
    expect(post).toHaveBeenCalledExactlyOnceWith(`${API_BASE}/auth/token/`, {
      data: { email: expect.any(String), password: expect.any(String) },
    })
  })

  it('reports a throttled login without retrying it', async () => {
    const { page, post } = mockPage([undefined], 429)
    await expect(getAdminToken(page)).rejects.toThrow('Admin login failed (429)')
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('fails if a successful login does not set the access cookie', async () => {
    const { page, post } = mockPage([undefined, undefined])
    await expect(getAdminToken(page)).rejects.toThrow('openzev_access cookie missing after login')
    expect(post).toHaveBeenCalledTimes(1)
  })
})

describe('screenshot demo ZEV pinning', () => {
  function mockPinPage(zevName: string | null) {
    const cookies = vi.fn().mockResolvedValue([{ name: 'openzev_access', value: 'saved-access' }])
    const get = vi.fn().mockResolvedValue({
      ok: () => true,
      status: () => 200,
      json: async () => (zevName === null ? { results: [] } : { results: [{ id: 'zev-1', name: zevName }] }),
    })
    const patch = vi.fn().mockResolvedValue({ ok: () => true, status: () => 200 })
    const addInitScript = vi.fn()
    const page = {
      context: () => ({ cookies }),
      request: { get, patch },
      addInitScript,
    } as unknown as Page
    return { page, get, patch, addInitScript }
  }

  it('persists the demo ZEV via the server-side preference, not browser storage', async () => {
    const { page, patch, addInitScript } = mockPinPage(DEMO_ZEV_NAME)
    await expect(pinDemoZev(page)).resolves.toBe(true)
    expect(patch).toHaveBeenCalledExactlyOnceWith(`${API_BASE}/auth/me/`, {
      headers: { Authorization: 'Bearer saved-access' },
      data: { preferred_zev: 'zev-1' },
    })
    expect(addInitScript).not.toHaveBeenCalled()
  })

  it('returns false without persisting when the demo ZEV is missing', async () => {
    const { page, patch } = mockPinPage(null)
    await expect(pinDemoZev(page)).resolves.toBe(false)
    expect(patch).not.toHaveBeenCalled()
  })
})
