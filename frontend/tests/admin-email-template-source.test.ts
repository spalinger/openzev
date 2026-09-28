import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => {
    const current = { subject: 'Default subject', body: 'Default body', is_customized: false }
    return {
        current,
        fetch: vi.fn(async () => ({ template_key: 'invoice_email', ...current, fields: [] })),
        save: vi.fn(async (_key: string, subject: string, body: string) => {
            Object.assign(current, { subject, body, is_customized: true })
            return { template_key: 'invoice_email', ...current, detail: 'saved' }
        }),
        reset: vi.fn(async () => {
            Object.assign(current, { subject: 'Default subject', body: 'Default body', is_customized: false })
            return { template_key: 'invoice_email', ...current, detail: 'reset' }
        }),
    }
})

const toastSpy = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ pushToast: toastSpy }) }))
vi.mock('../src/lib/api/invoices', () => ({
    fetchEmailTemplate: api.fetch,
    updateEmailTemplate: api.save,
    resetEmailTemplate: api.reset,
}))

import { AdminEmailTemplatesPage } from '../src/pages/AdminEmailTemplatesPage'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    Object.assign(api.current, { subject: 'Default subject', body: 'Default body', is_customized: false })
    api.fetch.mockClear()
    api.save.mockClear()
    api.reset.mockClear()
    toastSpy.mockClear()
})

async function renderEditor() {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await act(async () => root.render(createElement(MantineProvider, null,
        createElement(QueryClientProvider, { client },
            createElement(AdminEmailTemplatesPage, { embedded: true, template: 'invoice_email' }),
        ),
    )))
    await vi.waitFor(() => expect(container.querySelector('.template-source')).not.toBeNull())
    cleanups.push(() => { act(() => root.unmount()); container.remove(); client.clear() })
    return { container, client }
}

describe('platform email template source', () => {
    it('keeps a dirty editor through refetch, then confirms reset of the saved override', async () => {
        const { container, client } = await renderEditor()
        const subject = container.querySelector<HTMLInputElement>('.card input')!
        expect(container.textContent).toContain('templates.source.builtIn')
        expect(container.querySelector('button[title="admin.resetBuiltIn"]')).toBeNull()

        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(subject, 'Draft subject')
            subject.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await act(async () => client.invalidateQueries())
        expect(subject.value).toBe('Draft subject')
        expect(container.textContent).toContain('templates.source.builtIn')

        await act(async () => {
            Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'common.save')!.click()
        })
        await vi.waitFor(() => expect(container.textContent).toContain('templates.source.customized'))

        await act(async () => {
            Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'admin.resetBuiltIn')!.click()
        })
        expect(api.reset).not.toHaveBeenCalled()
        await act(async () => {
            container.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click()
        })
        expect(api.reset).not.toHaveBeenCalled()
        expect(subject.value).toBe('Draft subject')

        await act(async () => {
            Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'admin.resetBuiltIn')!.click()
        })
        await act(async () => {
            Array.from(container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
                .find((button) => button.textContent === 'admin.resetBuiltIn')!.click()
        })
        await vi.waitFor(() => expect(container.textContent).toContain('templates.source.builtIn'))
        expect(api.reset).toHaveBeenCalledTimes(1)
        expect(subject.value).toBe('Default subject')
    })

    it('keeps a successful save and reset after a failed refresh', async () => {
        const { container, client } = await renderEditor()
        const subject = container.querySelector<HTMLInputElement>('.card input')!
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(subject, 'Saved subject')
            subject.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'common.save')!.click()
        })
        await vi.waitFor(() => expect(container.textContent).toContain('templates.source.customized'))
        api.fetch.mockRejectedValueOnce(new Error('refresh failed'))
        await act(async () => { await client.invalidateQueries() })
        expect(subject.value).toBe('Saved subject')
        expect(container.textContent).toContain('templates.source.customized')

        await act(async () => {
            Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'admin.resetBuiltIn')!.click()
        })
        await act(async () => {
            Array.from(container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
                .find((button) => button.textContent === 'admin.resetBuiltIn')!.click()
        })
        await vi.waitFor(() => expect(container.textContent).toContain('templates.source.builtIn'))
        api.fetch.mockRejectedValueOnce(new Error('refresh failed'))
        await act(async () => { await client.invalidateQueries() })
        expect(subject.value).toBe('Default subject')
        expect(container.textContent).toContain('templates.source.builtIn')
    })

    it('reports a failed save once and retains the draft', async () => {
        const { container } = await renderEditor()
        const subject = container.querySelector<HTMLInputElement>('.card input')!
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(subject, 'Draft subject')
            subject.dispatchEvent(new Event('input', { bubbles: true }))
        })
        api.save.mockRejectedValueOnce(new Error('save failed'))
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'common.save')!.click()
        })
        expect(container.querySelectorAll('.error-banner[role="alert"]')).toHaveLength(1)
        expect(toastSpy).not.toHaveBeenCalledWith('common.error', 'error')
        expect(subject.value).toBe('Draft subject')
    })

    it('shows the server validation message without altering template variable names', async () => {
        const { container } = await renderEditor()
        const editor = container.querySelector<HTMLInputElement>('.card input')!
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(editor, 'Draft subject')
            editor.dispatchEvent(new Event('input', { bubbles: true }))
        })
        const draft = editor.value
        const message = 'Template rendering error: Unknown variable participant.emali.'
        api.save.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: message } } })
        await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'common.save')!.click() })
        expect(container.querySelector('[role="alert"]')?.textContent).toBe(message)
        expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
        expect(editor.value).toBe(draft)
        expect(toastSpy).not.toHaveBeenCalled()
    })

})
