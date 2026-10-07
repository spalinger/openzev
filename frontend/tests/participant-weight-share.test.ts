import { act, createElement, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParticipantCardsSection } from '../src/features/participants/ParticipantCardsSection'
import i18n from '../src/i18n'

type Props = ComponentProps<typeof ParticipantCardsSection>
type Card = Props['participantCards'][number]

function card(id: string, allocationWeight: string, validityState: Card['validityState'] = 'current'): Card {
    return {
        participant: {
            id, zev: 'zev-1', user: null, first_name: id, last_name: 'Example', email: '',
            valid_from: '2026-01-01', allocation_weight: allocationWeight,
        },
        validityState, displayName: id, address: '', warnings: [], roles: [],
    }
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(async () => {
    await i18n.changeLanguage('en')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

function render(participantCards: Card[], filteredParticipants = participantCards) {
    const props: Props = {
        participantCards, filteredParticipants,
        settings: { date_format_short: 'yyyy-MM-dd', date_format_long: 'yyyy-MM-dd', date_time_format: 'yyyy-MM-dd HH:mm', updated_at: '' },
        onOpenCreateModal: vi.fn(), onClearFilters: vi.fn(), onStartEdit: vi.fn(),
        onDownloadContract: vi.fn(), onSendOnboardingLink: vi.fn(), onCopyOnboardingLink: vi.fn(),
        onRevokeOnboardingLink: vi.fn(), onConfirmDelete: vi.fn(), onLinkAccount: vi.fn(), onUnlinkAccount: vi.fn(),
        canLinkAccount: false, canUnlinkAccount: false, accountActionPending: false,
        onboardingLinkPending: false, deletePendingOrDialogLoading: false, readOnly: true,
    }
    act(() => root.render(createElement(MemoryRouter, null, createElement(ParticipantCardsSection, props))))
}

function weightDisplay(id: string) {
    const element = container.querySelector(`#participant-card-${id} [data-testid="participant-weight"]`)
    if (!element) throw new Error(`Missing weight display for ${id}`)
    return element
}

describe('Participant allocation shares', () => {
    it('excludes ended and upcoming participations from the current total', () => {
        render([
            card('anna', '1.0000'), card('ben', '2.0000'), card('garage', '0.2500'),
            card('maria', '2.0000', 'ended'), card('joiner', '4.0000', 'upcoming'),
        ])
        expect(weightDisplay('anna').textContent).toBe('30.77 % — 1 of 3.25 weights')
        expect(weightDisplay('ben').textContent).toBe('61.54 % — 2 of 3.25 weights')
        expect(weightDisplay('garage').textContent).toBe('7.69 % — 0.25 of 3.25 weights')
        expect(weightDisplay('maria').textContent).toBe('2')
        expect(weightDisplay('joiner').textContent).toBe('4')
        expect(weightDisplay('anna').getAttribute('title')).toBe(i18n.t('pages.participants.weightShareHint'))
        expect(weightDisplay('maria').getAttribute('title')).toBe(i18n.t('pages.participants.weightShareUnavailableHint'))
        expect(weightDisplay('joiner').getAttribute('title')).toBe(i18n.t('pages.participants.weightShareUnavailableHint'))
    })

    it('uses the full current total when only a subset of cards is visible', () => {
        const cards = [card('anna', '1'), card('ben', '2'), card('maria', '2', 'ended')]
        render(cards)
        const before = weightDisplay('anna').textContent
        render(cards, [cards[0]])
        expect(container.querySelectorAll('article')).toHaveLength(1)
        expect(weightDisplay('anna').textContent).toBe(before)
        expect(before).toBe('33.33 % — 1 of 3 weights')
    })

    it('shows configured weights without percentages when nobody is current', () => {
        render([card('maria', '2', 'ended'), card('joiner', '1', 'upcoming')])
        expect(weightDisplay('maria').textContent).toBe('2')
        expect(weightDisplay('joiner').textContent).toBe('1')
        expect(container.textContent).not.toContain('%')
    })

    it('preserves four-decimal weight precision while trimming trailing zeros', () => {
        render([card('tiny', '0.0001'), card('other', '0.2499')])
        expect(weightDisplay('tiny').textContent).toBe('0.04 % — 0.0001 of 0.25 weights')
        expect(weightDisplay('other').textContent).toBe('99.96 % — 0.2499 of 0.25 weights')
    })

    it('does not require a personal meter to count a current participation', () => {
        const withoutMeter = card('without-meter', '1')
        withoutMeter.participant.has_metering_point_assignment = false
        render([withoutMeter])
        expect(weightDisplay('without-meter').textContent).toBe('100 % — 1 of 1 weights')
    })
})
