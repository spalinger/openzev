/** Native PDF-viewer regressions; no dev stack or authentication required. */
import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { PDF_VIEWER_URL, assertPdfLoaded, closePdfSidebar } from './helpers'

test.use({ storageState: { cookies: [], origins: [] } })

async function openPdf(page: Page) {
  await page.route('http://pdf-helper.test/**', route => {
    if (route.request().url().endsWith('.pdf')) {
      return route.fulfill({
        contentType: 'application/pdf',
        path: fileURLToPath(new URL('./fixtures/pdf-helper.pdf', import.meta.url)),
      })
    }
    return route.fulfill({
      contentType: 'text/html',
      body: '<iframe title="PDF" src="/document.pdf" style="width:100%;height:800px"></iframe>',
    })
  })
  await page.goto('http://pdf-helper.test/')
  await assertPdfLoaded(page)
  const viewer = page.frames().find(frame => frame.url().startsWith(PDF_VIEWER_URL))
  if (!viewer) throw new Error('PDF viewer disappeared after loading')
  return viewer
}

test('loads a PDF and closes its sidebar idempotently', async ({ page }) => {
  const viewer = await openPdf(page)
  const toggle = viewer.locator('#sidenavToggle')
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await closePdfSidebar(page)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await closePdfSidebar(page)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

test('rejects a missing native PDF viewer', async ({ page }) => {
  await page.setContent('<iframe title="PDF" src="about:blank"></iframe>')
  await expect(closePdfSidebar(page)).rejects.toThrow('PDF viewer missing')
  await expect(assertPdfLoaded(page, 500)).rejects.toThrow('PDF viewer did not load a nonempty document')
})

test('closes an expanded sidebar with a hidden toolbar', async ({ page }) => {
  const viewer = await openPdf(page)
  const toggle = viewer.locator('#sidenavToggle')
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await viewer.locator('viewer-toolbar').evaluate(toolbar => { (toolbar as HTMLElement).hidden = true })
  await closePdfSidebar(page)
  await expect(viewer.locator('#sidenavToggle')).toHaveAttribute('aria-expanded', 'false')
})

test('rejects a renamed sidebar toggle', async ({ page }) => {
  const viewer = await openPdf(page)
  await viewer.locator('#sidenavToggle').evaluate(toggle => { toggle.id = 'renamedToggle' })
  await expect(closePdfSidebar(page, 500)).rejects.toThrow('PDF viewer sidebar toggle missing or invalid')
})

test('rejects an invalid PDF response', async ({ page }) => {
  await page.route('http://pdf-helper.test/document.pdf', route => route.fulfill({
    contentType: 'application/pdf', body: 'Not a PDF document',
  }))
  await page.setContent('<iframe title="PDF" src="http://pdf-helper.test/document.pdf"></iframe>')
  await expect.poll(async () => {
    const viewer = page.frames().find(frame => frame.url().startsWith(PDF_VIEWER_URL))
    return viewer?.locator('viewer-toolbar').evaluate(toolbar =>
      (toolbar as HTMLElement & { loadProgress: number }).loadProgress,
    )
  }).toBe(-1)
  await expect(assertPdfLoaded(page, 500)).rejects.toThrow('PDF viewer did not load a nonempty document')
})
