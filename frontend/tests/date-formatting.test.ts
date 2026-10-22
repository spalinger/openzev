import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDateByPattern, formatDateTime } from '../src/lib/appSettings'

afterEach(() => vi.restoreAllMocks())

describe('date display formatting', () => {
    it('formats numeric dates and Swiss timestamps without constructing month-name formatters', () => {
        const NativeDateTimeFormat = Intl.DateTimeFormat
        const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales, options) {
            return new NativeDateTimeFormat(locales, options)
        })
        expect(formatDateTime('2026-07-15T22:15:00Z')).toBe('16.07.2026 00:15')
        expect(formatDateByPattern('2026-07-16', 'dd/MM/yyyy')).toBe('16/07/2026')
        expect(formatDateByPattern('2026-07-16', 'MM/dd/yyyy')).toBe('07/16/2026')
        expect(formatDateByPattern('2026-07-16', 'yyyy-MM-dd')).toBe('2026-07-16')
        expect(formatter.mock.calls.length).toBe(0)
    })

    it('still formats a localised month name when the pattern requests it', () => {
        const instant = '2026-07-15T22:15:00Z'
        const month = new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'Europe/Zurich' }).format(new Date(instant))
        expect(formatDateByPattern(instant, 'd MMMM yyyy')).toBe(`16 ${month} 2026`)
        expect(formatDateByPattern('2026-07-16', 'd. MMMM yyyy')).toBe(`16. ${month} 2026`)
        expect(formatDateByPattern(instant, 'MMMM d, yyyy')).toBe(`${month} 16, 2026`)
    })
})
