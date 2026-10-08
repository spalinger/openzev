import { act, createElement, StrictMode, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog, useConfirmDialog } from '../src/components/ConfirmDialog'

const toast = vi.hoisted(() => vi.fn())
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ pushToast: toast }) }))

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let current: ReturnType<typeof useConfirmDialog>

function Harness() {
    const api = useConfirmDialog()
    useLayoutEffect(() => { current = api }, [api])
    return api.dialog && createElement(ConfirmDialog, {
        ...api.dialog, isLoading: api.isLoading,
        onConfirm: api.handleConfirm, onCancel: api.handleCancel,
    })
}

function deferred() {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}

beforeEach(() => {
    toast.mockClear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(createElement(StrictMode, null, createElement(Harness))))
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('confirmation ownership', () => {
    it('keeps the opening callback stable across dialog updates', () => {
        const confirm = current.confirm
        act(() => confirm({ title: 'A', message: 'A', onConfirm: vi.fn() }))
        expect(current.confirm).toBe(confirm)
        act(() => current.handleCancel())
        expect(current.confirm).toBe(confirm)
    })

    it('updates the existing status region when processing starts', async () => {
        const pending = deferred()
        act(() => current.confirm({ title: 'A', message: 'A', onConfirm: () => pending.promise }))
        const status = container.querySelector('[role=status]')!
        expect(status.textContent).toBe('')
        let submitted!: Promise<void>
        act(() => { submitted = current.handleConfirm() })
        expect(container.querySelector('[role=status]')).toBe(status)
        expect(status.textContent).toBe('common.actionContinues')
        await act(async () => { pending.resolve(); await submitted })
    })

    it('closes a synchronous confirmation in the same update', () => {
        const onConfirm = vi.fn()
        act(() => current.confirm({ title: 'A', message: 'A', onConfirm }))
        act(() => { void current.handleConfirm() })
        expect(onConfirm).toHaveBeenCalledOnce()
        expect(current.dialog).toBeNull()
        expect(current.isLoading).toBe(false)
    })

    it('keeps a rejected submission open and allows a corrected retry', async () => {
        let valid = false
        const submit = vi.fn()
        act(() => current.confirm({ title: 'A', message: 'A', onConfirm: () => {
            if (!valid) return false
            submit()
        } }))
        const opening = current.dialog
        await act(async () => { await current.handleConfirm() })
        expect(current.dialog).toBe(opening)
        expect(current.isLoading).toBe(false)
        expect(submit).not.toHaveBeenCalled()
        expect(toast).not.toHaveBeenCalled()
        valid = true
        act(() => { void current.handleConfirm() })
        expect(submit).toHaveBeenCalledOnce()
        expect(current.dialog).toBeNull()
    })

    it('cannot restore a replaced dialog after asynchronous validation rejects submission', async () => {
        let rejectSubmission!: (value: false) => void
        const validation = new Promise<false>(resolve => { rejectSubmission = resolve })
        act(() => current.confirm({ title: 'A', message: 'A', onConfirm: () => validation }))
        let submitted!: Promise<void>
        act(() => { submitted = current.handleConfirm() })
        act(() => current.confirm({ title: 'B', message: 'B', onConfirm: vi.fn() }))
        await act(async () => { rejectSubmission(false); await submitted })
        expect(current.dialog?.title).toBe('B')
        expect(current.isLoading).toBe(false)
    })

    for (const dismissal of ['Escape', 'scrim', 'button']) {
        for (const outcome of ['success', 'failure']) {
            it(`preserves the newer pending dialog after ${dismissal} and a late ${outcome}`, async () => {
                const a = deferred(), b = deferred()
                const onCancel = vi.fn()
                act(() => current.confirm({ title: 'A', message: 'A', onConfirm: () => a.promise, onCancel }))
                let submitted!: Promise<void>
                act(() => { submitted = current.handleConfirm() })
                expect(current.isLoading).toBe(true)
                act(() => {
                    if (dismissal === 'Escape') {
                        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
                    } else if (dismissal === 'scrim') {
                        container.querySelector<HTMLElement>('.dialog-scrim')!.click()
                    } else {
                        container.querySelector<HTMLButtonElement>('button')!.click()
                    }
                })
                expect(onCancel).toHaveBeenCalledOnce()
                expect(current.dialog).toBeNull()
                act(() => current.confirm({ title: 'B', message: 'B', onConfirm: () => b.promise }))
                expect(current.isLoading).toBe(false)
                let submittedB!: Promise<void>
                act(() => { submittedB = current.handleConfirm() })
                await act(async () => {
                    if (outcome === 'success') a.resolve()
                    else a.reject(new Error('late failure'))
                    await submitted
                })
                expect(current.dialog?.title).toBe('B')
                expect(current.isLoading).toBe(true)
                expect(toast).not.toHaveBeenCalled()
                await act(async () => { b.resolve(); await submittedB })
                expect(current.dialog).toBeNull()
                expect(current.isLoading).toBe(false)
            })
        }
    }

    it('gives a reused options object a new lifetime when replaced without dismissal', async () => {
        const pending = deferred()
        const options = { title: 'Same', message: 'Same', onConfirm: () => pending.promise }
        act(() => current.confirm(options))
        let submitted!: Promise<void>
        act(() => { submitted = current.handleConfirm() })
        act(() => current.confirm(options))
        await act(async () => { pending.resolve(); await submitted })
        expect(current.dialog?.title).toBe('Same')
        expect(current.isLoading).toBe(false)
    })

    it('dispatches a rapid double confirmation only once', async () => {
        const pending = deferred()
        const onConfirm = vi.fn(() => pending.promise)
        act(() => current.confirm({ title: 'A', message: 'A', onConfirm }))
        let submitted!: Promise<void>
        act(() => { submitted = current.handleConfirm(); void current.handleConfirm() })
        expect(onConfirm).toHaveBeenCalledOnce()
        await act(async () => { pending.resolve(); await submitted })
        expect(current.dialog).toBeNull()
    })

    it('ignores confirm and cancel callbacks retained from a replaced dialog', async () => {
        const onConfirm = vi.fn(), onCancel = vi.fn()
        act(() => current.confirm({ title: 'A', message: 'A', onConfirm, onCancel }))
        const old = current
        act(() => current.confirm({ title: 'B', message: 'B', onConfirm: vi.fn() }))
        await act(async () => { await old.handleConfirm(); old.handleCancel() })
        expect(onConfirm).not.toHaveBeenCalled()
        expect(onCancel).not.toHaveBeenCalled()
        expect(current.dialog?.title).toBe('B')
    })

    it('shows an error for a current confirmation and clears its busy state', async () => {
        act(() => current.confirm({ title: 'A', message: 'A', onConfirm: () => { throw new Error('failure') } }))
        await act(async () => { await current.handleConfirm() })
        expect(toast).toHaveBeenCalledExactlyOnceWith('common.error', 'error')
        expect(current.dialog).toBeNull()
        expect(current.isLoading).toBe(false)
    })

    it('preserves a replacement opened immediately by onCancel', () => {
        act(() => current.confirm({
            title: 'A', message: 'A', onConfirm: vi.fn(),
            onCancel: () => current.confirm({ title: 'B', message: 'B', onConfirm: vi.fn() }),
        }))
        act(() => current.handleCancel())
        expect(current.dialog?.title).toBe('B')
        expect(current.isLoading).toBe(false)
    })

    it('reports an active asynchronous rejection and closes the dialog', async () => {
        const pending = deferred()
        act(() => current.confirm({ title: 'A', message: 'A', onConfirm: () => pending.promise }))
        let submitted!: Promise<void>
        act(() => { submitted = current.handleConfirm() })
        expect(container.querySelector('button')?.textContent).toBe('common.close')
        expect(container.querySelector('[role=status]')?.textContent).toBe('common.actionContinues')
        await act(async () => { pending.reject(new Error('failure')); await submitted })
        expect(toast).toHaveBeenCalledExactlyOnceWith('common.error', 'error')
        expect(current.dialog).toBeNull()
        expect(current.isLoading).toBe(false)
    })

    it('does not notify after its owner unmounts', async () => {
        const pending = deferred()
        act(() => current.confirm({ title: 'A', message: 'A', onConfirm: () => pending.promise }))
        let submitted!: Promise<void>
        act(() => { submitted = current.handleConfirm() })
        act(() => root.render(null))
        await act(async () => { pending.reject(new Error('late failure')); await submitted })
        expect(toast).not.toHaveBeenCalled()
    })
})
