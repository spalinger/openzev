// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import { PDF_VIEWER_URL, assertPdfLoaded } from '../screenshots/helpers'

describe('PDF loading poll lifecycle', () => {
  it.each([
    'Execution context was destroyed, most likely because of a navigation',
    'Frame was detached',
  ])('retries after %s', async message => {
    const evaluate = vi.fn()
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValue({ loaded: true, loadProgress: 100, docLength: 1 })
    const page = { frames: () => [{ url: () => PDF_VIEWER_URL, evaluate }] } as unknown as Page

    await assertPdfLoaded(page, 1_000)
    expect(evaluate).toHaveBeenCalledTimes(2)
  })

  it('propagates unrelated evaluation failures without retrying', async () => {
    const error = new Error('Unexpected viewer evaluation failure')
    const evaluate = vi.fn().mockRejectedValue(error)
    const page = { frames: () => [{ url: () => PDF_VIEWER_URL, evaluate }] } as unknown as Page

    await expect(assertPdfLoaded(page, 1_000)).rejects.toBe(error)
    expect(evaluate).toHaveBeenCalledTimes(1)
  })
})
