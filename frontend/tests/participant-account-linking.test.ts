import { act, createElement, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog, useConfirmDialog } from '../src/components/ConfirmDialog'
import { useParticipantAccountLinking } from '../src/features/participants/useParticipantAccountLinking'
import { queryKeys } from '../src/lib/api/queryKeys'
import type { Participant } from '../src/types/api'

const mocks = vi.hoisted(() => ({ toast: vi.fn(), unlink: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ pushToast: mocks.toast }) }))
vi.mock('../src/lib/api/zev', async importOriginal => ({
    ...await importOriginal<typeof import('../src/lib/api/zev')>(),
    unlinkParticipantAccount: mocks.unlink,
}))

let container: HTMLDivElement, root: ReturnType<typeof createRoot>, client: QueryClient
let current: ReturnType<typeof useConfirmDialog>
let linking: ReturnType<typeof useParticipantAccountLinking>
const participant = { id: 'p42' } as Participant

function Harness() {
    const dialog = useConfirmDialog()
    const accounts = useParticipantAccountLinking({ isAdmin: true, confirm: dialog.confirm })
    useLayoutEffect(() => { current = dialog; linking = accounts }, [dialog, accounts])
    return dialog.dialog && createElement(ConfirmDialog, {
        ...dialog.dialog, isLoading: dialog.isLoading,
        onConfirm: dialog.handleConfirm, onCancel: dialog.handleCancel,
    })
}

beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(queryKeys.auth.users(), [])
    act(() => root.render(createElement(QueryClientProvider, { client }, createElement(Harness))))
})

afterEach(() => { act(() => root.unmount()); client.clear(); container.remove() })

describe('participant account unlink feedback', () => {
    for (const dismiss of [false, true]) {
        it(`reports an unlink failure once, dismissed=${dismiss}`, async () => {
            let reject!: (reason: unknown) => void
            mocks.unlink.mockReturnValue(new Promise((_, no) => { reject = no }))
            act(() => linking.confirmUnlink(participant, 'Participant A', 'account@example.test'))
            let submitted!: Promise<void>
            await act(async () => { submitted = current.handleConfirm() })
            expect(mocks.unlink).toHaveBeenCalledExactlyOnceWith('p42')
            expect(current.isLoading).toBe(true)
            if (dismiss) act(() => current.handleCancel())
            await act(async () => {
                reject({ isAxiosError: true, response: { data: { detail: 'Unlink failed' } } })
                await submitted
            })
            expect(mocks.toast).toHaveBeenCalledExactlyOnceWith('Unlink failed', 'error')
            expect(current.dialog).toBeNull()
            expect(current.isLoading).toBe(false)
        })
    }
})
