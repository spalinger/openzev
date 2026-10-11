import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, MeteringPoint, MeteringPointAssignment } from '../src/types/api'
import { waitForCondition } from './helpers/waitForCondition'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, options?: { count?: number; days?: number }) => {
        const count = options?.days ?? options?.count
        return count === undefined ? key : `${key}:${count}`
    } }),
}))
vi.mock('../src/lib/dates', async importOriginal => ({ ...await importOriginal(), todayBusinessIso: () => '2026-10-11' }))
vi.mock('../src/lib/supplementary', async importOriginal => ({
    ...await importOriginal(),
    useEnergyDataEligibility: () => ({ featureOn: false, eligible: [] }),
}))

import { MeteringPointsList } from '../src/features/meteringPoints/MeteringPointsList'

const point = (id: string, overrides: Partial<MeteringPoint> = {}): MeteringPoint => ({
    id, zev: 'z1', meter_id: `CH-${id}`, meter_type: 'consumption', is_active: true, location_description: '',
    building: 'b1', building_name: 'House', has_behind_meter_generation: false, reading_count: 10, assignment_count: 0,
    first_reading_at: null, last_reading_at: '2026-10-11T21:45:00Z', supplementary_source_status: null, ...overrides,
})
const assignment = (id: string, meter: string, valid_from: string, valid_to: string | null = null): MeteringPointAssignment => ({
    id, metering_point: meter, participant: `p-${id}`, valid_from, valid_to,
    created_at: valid_from, updated_at: valid_from, allocation_mode: 'personal',
})

// held: a current holder and an earlier one; free: never assigned.
const assignments = new Map([['held', [assignment('a1', 'held', '2026-07-01', '2026-08-31'), assignment('a2', 'held', '2026-09-01')]]])

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render(readOnly = false, dailySeriesByMeteringPoint?: Map<string, Array<number | null>>) {
    act(() => root.render(createElement(MemoryRouter, null, createElement(MantineProvider, null,
        createElement(MeteringPointsList, {
            meteringPoints: [point('held'), point('free')],
            assignmentsByMeteringPoint: assignments,
            participantNameById: new Map([['p-a1', 'Maria'], ['p-a2', 'Robin']]),
            healthByMeteringPoint: new Map([['held', 'green'], ['free', 'no_data']] as const),
            holderLessByMeteringPoint: new Map(),
            dailySeriesByMeteringPoint,
            settings: {} as AppSettings,
            isManagedScope: true,
            readOnly,
            canDeleteData: false,
            deleteMeteringPointPending: false,
            deleteAssignmentPending: false,
            dialogLoading: false,
            confirm: vi.fn(),
            onOpenCreateAssignModal: vi.fn(),
            onOpenEditMeteringPoint: vi.fn(),
            onOpenDeleteDataModal: vi.fn(),
            onOpenEditAssignment: vi.fn(),
            onDeleteMeteringPoint: vi.fn(),
            onDeleteAssignment: vi.fn(),
        })))))
}

const row = (meterId: string) => Array.from(container.querySelectorAll('tr.metering-row'))
    .find((candidate) => candidate.textContent?.includes(meterId))!

beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('MeteringPointsList rows', () => {
    it('shows Assign only on a meter without a current holder', () => {
        render()
        expect(row('CH-held').querySelector('.metering-assign-button')).toBeNull()
        expect(row('CH-held').textContent).toContain('Robin')
        expect(row('CH-free').querySelector('.metering-assign-button')).not.toBeNull()
    })

    it('opens the other assignments beneath the row', () => {
        render()
        expect(row('CH-free').querySelector('.metering-history-toggle')).toBeNull()
        const toggle = row('CH-held').querySelector<HTMLButtonElement>('.metering-history-toggle')!
        expect(toggle.textContent).toContain('pages.meteringPoints.assignmentsToggle:2')
        expect(container.querySelector('.metering-history-row')).toBeNull()

        act(() => toggle.click())
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
        const history = container.querySelector('.metering-history-row')!
        expect(history.id).toBe(toggle.getAttribute('aria-controls'))
        expect(history.textContent).toContain('Maria')
        expect(history.textContent).toContain('Robin')
    })

    it('groups a held meter\'s menu into holder and meter actions', async () => {
        render()
        act(() => row('CH-held').querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click())
        await waitForCondition(() => document.querySelectorAll('[role="menuitem"]').length > 0, 'row menu')
        const labels = Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent)
        expect(labels).toEqual([
            'pages.meteringPoints.assign',
            'pages.meteringPoints.editAssignTitle',
            'pages.meteringPoints.removeAssignTitle',
            'common.edit',
            'common.delete',
        ])
    })

    it('names the type behind its icon and lists it in the legend', () => {
        render()
        expect(row('CH-held').querySelector('.metering-type-icon')!.textContent).toBe('pages.meteringPoints.meterTypes.consumption')
        expect(container.querySelector('.metering-type-legend')!.textContent).toBe('pages.meteringPoints.meterTypes.consumption')
    })

    it('draws the daily series in the chart button, broken at a missing day', () => {
        render(false, new Map([['held', [1, 2, null, null, null, null, 3]]]))
        const button = row('CH-held').querySelector('.metering-chart-button')!
        expect(button.getAttribute('aria-label')).toBe('pages.meteringPoints.chartForTotal:7')
        expect(button.getAttribute('title')).toBe('pages.meteringPoints.chartForTotal:7')
        expect(button.querySelectorAll('polyline')).toHaveLength(1)
        expect(button.querySelector('.sparkline-dot')).toBeNull()
        expect(button.querySelector('.sparkline-end')!.getAttribute('cx')).toBe('54.0')
        // Without a series the button keeps the chart icon.
        expect(row('CH-free').querySelector('.metering-chart-button svg.sparkline')).toBeNull()
    })

    it('gives a viewer neither Assign nor the menu', () => {
        render(true)
        expect(container.querySelector('.metering-assign-button')).toBeNull()
        expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull()
        expect(row('CH-free').textContent).toContain('pages.meteringPoints.noHolder')
    })
})
