import { useLayoutEffect, useState } from 'react'

/**
 * Measure available element width, including elements mounted late via the callback ref.
 * Assume wide until measured, or when ResizeObserver is unavailable.
 */
export function useMinWidth<T extends HTMLElement>(minRem: number): [(element: T | null) => void, boolean] {
    const [element, setElement] = useState<T | null>(null)
    const [fits, setFits] = useState(true)

    useLayoutEffect(() => {
        if (!element || typeof ResizeObserver === 'undefined') return
        const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
        const measure = () => setFits(element.getBoundingClientRect().width >= minRem * rootFontSize)
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => observer.disconnect()
    }, [element, minRem])

    return [setElement, fits]
}
