import { act, createElement, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { waitForCondition } from './helpers/waitForCondition'
import type { Participant, ParticipantInput } from '../src/types/api'
import type { ParticipantFormModal } from '../src/features/participants/ParticipantFormModal'
import type { ParticipantCardsSection } from '../src/features/participants/ParticipantCardsSection'
import type { ParticipantToolbar } from '../src/features/participants/ParticipantToolbar'
import type { ComponentProps } from 'react'

const state = vi.hoisted(() => ({
    zevId: 'A', write: vi.fn(), toast: vi.fn(),
    form: null as ComponentProps<typeof ParticipantFormModal> | null,
    cards: null as ComponentProps<typeof ParticipantCardsSection> | null,
    toolbar: null as ComponentProps<typeof ParticipantToolbar> | null,
}))
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'user' } }) }))
vi.mock('../src/lib/managedZev', () => {
    const useManagedZev = () => ({ selectedZevId: state.zevId, selectedZev: { id: state.zevId, name: state.zevId }, relation: 'manager', isLoading: false })
    return { useManagedZev, useOptionalManagedZev: useManagedZev }
})
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ pushToast: state.toast }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/lib/appSettings', () => ({ useAppSettings: () => ({ settings: {} }) }))
vi.mock('../src/lib/api/zev', async importOriginal => ({
    ...await importOriginal(), createParticipant: state.write, updateParticipant: state.write,
    fetchParticipants: async () => participants, fetchParticipantGeocodingEnabled: async () => false,
}))
vi.mock('../src/features/participants/useParticipantAccountLinking', () => ({ useParticipantAccountLinking: () => ({}) }))
vi.mock('../src/features/participants/ParticipantFormModal', () => ({
    ParticipantFormModal: (props: ComponentProps<typeof ParticipantFormModal>) => {
        useLayoutEffect(() => { state.form = props }, [props])
        return props.isOpen ? createElement('input', { 'data-draft': props.selectedZevId, defaultValue: props.initialParticipant?.id ?? 'new' }) : null
    },
}))
vi.mock('../src/features/participants/ParticipantToolbar', () => ({
    ParticipantToolbar: (props: ComponentProps<typeof ParticipantToolbar>) => {
        useLayoutEffect(() => { state.toolbar = props }, [props])
        return null
    },
}))
vi.mock('../src/features/participants/ParticipantCardsSection', () => ({
    ParticipantCardsSection: (props: ComponentProps<typeof ParticipantCardsSection>) => {
        useLayoutEffect(() => { state.cards = props }, [props])
        return null
    },
}))
import { ParticipantsPage } from '../src/pages/ParticipantsPage'
import { queryKeys } from '../src/lib/api/queryKeys'

const participants = ['A', 'B'].map(zev => ({ id: `p${zev}`, zev, first_name: 'Name', last_name: zev, valid_from: '2026-01-01' } as Participant))
let root: ReturnType<typeof createRoot>
let client: QueryClient
let container: HTMLDivElement
async function render() {
    await act(async () => root.render(createElement(MemoryRouter, null,
        createElement(QueryClientProvider, { client }, createElement(ParticipantsPage)),
    )))
}
beforeEach(async () => {
    vi.clearAllMocks()
    state.zevId = 'A'
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
    for (const zev of ['A', 'B']) client.setQueryData(queryKeys.zev.participants(zev), participants)
    await render()
})
afterEach(() => { act(() => root.unmount()); client.clear(); container.remove() })

it.each([
    ['create', 'success'], ['update', 'success'], ['create', 'error'], ['update', 'error'],
])('keeps B’s replacement draft after A’s delayed %s %s', async (mode, outcome) => {
    let resolve!: (value: Participant) => void
    let reject!: (error: Error) => void
    state.write.mockReturnValue(new Promise<Participant>((done, fail) => { resolve = done; reject = fail }))
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    act(() => {
        if (mode === 'create') state.toolbar!.onOpenCreateModal()
        else state.cards!.onStartEdit(participants[0])
    })
    act(() => state.form!.onSubmit({ first_name: 'Saved A' } as ParticipantInput))
    await waitForCondition(() => state.write.mock.calls.length > 0, 'participant write submitted')
    state.zevId = 'B'
    await render()
    act(() => {
        if (mode === 'create') state.toolbar!.onOpenCreateModal()
        else state.cards!.onStartEdit(participants[1])
    })
    const draft = container.querySelector('input')!
    draft.value = 'B’s unsaved work'
    await act(async () => {
        if (outcome === 'success') resolve(participants[0])
        else reject(new Error('Old failure'))
    })
    await waitForCondition(() => client.getMutationCache().getAll()[0].state.status === (outcome === 'success' ? 'success' : 'error'), 'participant write completion')
    expect(container.querySelector('input')).toBe(draft)
    expect(draft.value).toBe('B’s unsaved work')
    expect(state.form!.initialParticipant?.id).toBe(mode === 'update' ? 'pB' : undefined)
    expect(state.toast).not.toHaveBeenCalled()
    if (outcome === 'success') expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.zev.participants('A') })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.zev.participants('B') })
})

it('closes a successful participant save in the submitting scope', async () => {
    state.write.mockResolvedValue(participants[0])
    act(() => state.toolbar!.onOpenCreateModal())
    act(() => state.form!.onSubmit({ first_name: 'Saved A' } as ParticipantInput))
    await waitForCondition(() => !container.querySelector('input'), 'submitted dialog closes')
    expect(state.toast).toHaveBeenCalledWith('pages.participants.messages.created', 'success')
})
