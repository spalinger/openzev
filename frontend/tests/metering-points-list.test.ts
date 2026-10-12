import { act, createElement, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, MeteringPoint, MeteringPointAssignment } from '../src/types/api'
import { waitForCondition } from './helpers/waitForCondition'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, options?: { count?: number; days?: number; meterId?: string; kwh?: string; quantity?: string }) => {
        if (key.endsWith('chartForTotal')) return `${options?.meterId} · ${options?.quantity}: ${options?.kwh} kWh · ${options?.days} days`
        const count = options?.days ?? options?.count
        return count === undefined ? key : `${key}:${count}`
    } }),
}))
vi.mock('../src/lib/dates', async importOriginal => ({ ...await importOriginal(), todayBusinessIso: () => '2026-10-11' }))
vi.mock('../src/lib/supplementary', async importOriginal => ({
    ...await importOriginal(),
    useEnergyDataEligibility: () => ({ featureOn: false, eligible: [] }),
}))

import { formatDateTime, DEFAULT_APP_SETTINGS } from '../src/lib/appSettings'

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
const onOpenEditMeteringPoint = vi.fn()
const onOpenEditAssignment = vi.fn()

function render(readOnly = false, hourlySeriesByMeteringPoint?: Map<string, Array<number | null>>, overrides: Partial<ComponentProps<typeof MeteringPointsList>> = {}) {
    act(() => root.render(createElement(MemoryRouter, null, createElement(MantineProvider, null,
        createElement(MeteringPointsList, {
            meteringPoints: [point('held'), point('free')],
            assignmentsByMeteringPoint: assignments,
            participantNameById: new Map([['p-a1', 'Maria'], ['p-a2', 'Robin']]),
            healthByMeteringPoint: new Map([['held', 'green'], ['free', 'no_data']] as const),
            holderLessByMeteringPoint: new Map(),
            hourlySeriesByMeteringPoint,
            settings: {} as AppSettings,
            isManagedScope: true,
            readOnly,
            canDeleteData: false,
            deleteMeteringPointPending: false,
            deleteAssignmentPending: false,
            dialogLoading: false,
            confirm: vi.fn(),
            onOpenCreateAssignModal: vi.fn(),
            onOpenEditMeteringPoint,
            onOpenDeleteDataModal: vi.fn(),
            onOpenEditAssignment,
            onDeleteMeteringPoint: vi.fn(),
            onDeleteAssignment: vi.fn(),
            ...overrides,
        })))))
}

const row = (meterId: string) => Array.from(container.querySelectorAll('tr.metering-row'))
    .find((candidate) => candidate.textContent?.includes(meterId))!

beforeEach(() => {
    onOpenEditMeteringPoint.mockClear()
    onOpenEditAssignment.mockClear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('MeteringPointsList rows', () => {
    it('opens the meter edit dialog when its name is clicked', () => {
        render()
        act(() => (row('CH-held').querySelector('.metering-name-button') as HTMLButtonElement).click())
        expect(onOpenEditMeteringPoint).toHaveBeenCalledWith(expect.objectContaining({ id: 'held' }))
    })
    it('opens the current assignment edit dialog when its holder is clicked', () => {
        render()
        act(() => (row('CH-held').querySelector('.metering-holder-button') as HTMLButtonElement).click())
        expect(onOpenEditAssignment).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' }))
    })
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
        expect(history.querySelector('.metering-assignment-state')?.classList.contains('badge')).toBe(false)
        act(() => (history.querySelector('.metering-name-button') as HTMLButtonElement).click())
        expect(onOpenEditAssignment).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' }))
        act(() => toggle.click())
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        expect(container.querySelector('.metering-history-row')).toBeNull()
    })

    it('groups a held meter\'s menu into holder and meter actions', async () => {
        render()
        act(() => row('CH-held').querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click())
        await waitForCondition(() => document.querySelectorAll('[role="menuitem"]').length > 0, 'row menu')
        const labels = Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent)
        expect(document.querySelector('[role="menu"]')!.textContent).toContain('pages.meteringPoints.columns.holder')
        expect(document.querySelector('[role="menu"]')!.textContent).toContain('pages.meteringPoints.columns.meteringPoint')
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

    it('draws the hourly series in the chart button, broken at a missing hour', () => {
        render(false, new Map([['held', [1, 2, null, null, null, null, 3]]]))
        const button = row('CH-held').querySelector('.metering-chart-button')!
        expect(button.getAttribute('aria-label')).toBe('CH-held · pages.meteringPoints.recordedEnergy.consumption: 6 kWh · 7 days')
        expect(button.getAttribute('title')).toBe('CH-held · pages.meteringPoints.recordedEnergy.consumption: 6 kWh · 7 days')
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
        expect(container.querySelector('.metering-name-button')).toBeNull()
        expect(row('CH-free').textContent).toContain('pages.meteringPoints.noHolder')
    })
    it('retains named table roles and the spanning history cell', () => {
        render(false, undefined, { header: createElement('h2', { id: 'metering-building-b1' }, 'House'), buildingId: 'b1' })
        const table = container.querySelector('table')!
        expect(table.getAttribute('role')).toBe('table')
        expect(table.getAttribute('aria-labelledby')).toBe('metering-building-b1')
        expect(table.querySelectorAll('[role="columnheader"]')).toHaveLength(4)
        expect(table.querySelectorAll('[role="rowgroup"]')).toHaveLength(2)
        act(() => row('CH-held').querySelector<HTMLButtonElement>('.metering-history-toggle')!.click())
        const history = table.querySelector('.metering-history-row')!
        expect(history.getAttribute('role')).toBe('row')
        expect(history.querySelector('td')!.getAttribute('aria-colspan')).toBe('4')
    })

    it('gives participants three columns without holder or management controls', () => {
        render(false, undefined, { isManagedScope: false })
        expect(container.querySelectorAll('[role="columnheader"]')).toHaveLength(3)
        expect(row('CH-held').querySelectorAll('[role="cell"]')).toHaveLength(3)
        expect(container.querySelector('.metering-row-holder')).toBeNull()
        expect(container.querySelector('.metering-history-toggle')).toBeNull()
        expect(container.querySelector('.metering-name-button')).toBeNull()
        expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull()
    })

    it.each(['upcoming', 'ended'] as const)('keeps Assign available for an %s-only assignment', state => {
        const history = state === 'upcoming' ? assignment('future', 'free', '2026-12-01') : assignment('past', 'free', '2026-01-01', '2026-02-01')
        render(false, undefined, { assignmentsByMeteringPoint: new Map([['free', [history]]]) })
        expect(row('CH-free').querySelector('.metering-assign-button')).not.toBeNull()
        expect(row('CH-free').querySelector('.metering-holder-button')).toBeNull()
        act(() => row('CH-free').querySelector<HTMLButtonElement>('.metering-history-toggle')!.click())
        expect(container.querySelector('.metering-history-row')!.textContent).toContain(`pages.meteringPoints.assignmentState.${state}`)
    })

    it('keeps meters in their building sheets and retains an empty building', () => {
        const building = (id: string, count: number) => ({ id, zev: 'z1', name: id, address_line1: '', address_line2: '', postal_code: '', city: '', egid: null, notes: '', metering_point_count: count, building_footprint: null, current_participants: [], created_at: '', updated_at: '' })
        render(false, undefined, {
            groups: [
                { building: building('b1', 1), points: [point('held')] },
                { building: building('b2', 1), points: [point('free', { building: 'b2' })] },
                { building: building('b3', 0), points: [] },
            ],
            renderGroupHeader: group => createElement('h2', { id: `metering-building-${group.building.id}` }, group.building.name),
        })
        const sheets = container.querySelectorAll('section.metering-sheet')
        expect(sheets).toHaveLength(3)
        expect(sheets[0].textContent).toContain('CH-held')
        expect(sheets[0].textContent).not.toContain('CH-free')
        expect(sheets[1].textContent).toContain('CH-free')
        expect(sheets[2].textContent).toContain('b3')
        expect(sheets[2].textContent).toContain('pages.meteringPoints.buildings.emptyGroup')
        expect(sheets[2].querySelector('table')).toBeNull()
    })

    it('includes Delete data for an administrator', async () => {
        render(false, undefined, { canDeleteData: true })
        act(() => row('CH-free').querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click())
        await waitForCondition(() => document.querySelectorAll('[role="menuitem"]').length > 0, 'admin menu')
        expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map(item => item.textContent)).toContain('pages.meteringPoints.deleteData.button')
    })

    it('retains a decimal for small recorded net energy', () => {
        render(false, new Map([['held', [0.1, 0.1]]]), { meteringPoints: [point('held', { meter_type: 'bidirectional' })] })
        expect(row('CH-held').querySelector('.metering-chart-button')!.getAttribute('title')).toBe('CH-held · pages.meteringPoints.recordedEnergy.bidirectional: 0.2 kWh · 7 days')
    })

    it('keeps the latest reading date in the health tooltip during a warning', () => {
        render(false, undefined, { settings: DEFAULT_APP_SETTINGS, healthByMeteringPoint: new Map([['held', 'red']]) })
        const status = row('CH-held').querySelector('.metering-health')!
        expect(status.textContent).toBe('pages.meteringPoints.health.red')
        expect(status.getAttribute('title')).toContain(formatDateTime(point('held').last_reading_at!, DEFAULT_APP_SETTINGS))
    })

})
