import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Sparkline } from '../src/components/Sparkline'

function render(values: Array<number | null>) {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(createElement(Sparkline, { values }))
    return container
}

describe('Sparkline', () => {
    it.each([
        ['negative-only', [-5, -3]],
        ['constant negative', [-2, -2]],
        ['mixed', [-2, 0, 3]],
        ['zero', [0, 0]],
    ] as const)('keeps the %s line and zero baseline inside the SVG', (_, values) => {
        const chart = render([...values])
        const points = chart.querySelector('polyline')!.getAttribute('points')!.split(' ')
        const path = chart.querySelector('path')!.getAttribute('d')!
        const baseline = Number(path.match(/^M[^,]+,([^ ]+)/)![1])
        for (const y of [baseline, ...points.map(point => Number(point.split(',')[1]))]) {
            expect(y).toBeGreaterThanOrEqual(2)
            expect(y).toBeLessThanOrEqual(16)
        }
    })

    it('breaks the line into two runs at a missing hour', () => {
        const chart = render([1, 2, null, 3, 4])
        expect(chart.querySelectorAll('polyline')).toHaveLength(2)
        expect(chart.querySelectorAll('path')).toHaveLength(2)
        expect(chart.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    })

    it('marks isolated hours without duplicating the final marker', () => {
        const chart = render([1, null, 2])
        expect(chart.querySelectorAll('.sparkline-dot')).toHaveLength(1)
        expect(chart.querySelectorAll('.sparkline-end')).toHaveLength(1)
        expect(chart.querySelectorAll('polyline')).toHaveLength(0)
    })

    it.each([[[]], [[null, null]], [[null, 1, null]]])('renders nothing with fewer than two recorded values (%j)', values => {
        expect(render(values).querySelector('svg')).toBeNull()
    })
})
