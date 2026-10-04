import { useCallback, useEffect, useState } from 'react'
import {
    billingRangeFromParams,
    getCurrentBillingPeriod,
    getPreviousBillingPeriod,
    invoiceRangeFromParams,
    type BillingInterval,
} from './billingPeriod'
import { usePageNavigation } from './usePageNavigation'

export type BillingRange = { from: string; to: string }

type BillingPeriodParamsPolicy = {
    interval: BillingInterval
    /** False until the consumer has the scope/interval data it needs. */
    ready: boolean
    scopeId: string
    fallback: 'current' | 'previous-complete'
    /** URL ranges are bounded by community start, never today's aligned floor. */
    minimumRangeStart?: string | null
    /** Only the default period is bounded by this aligned range. */
    minimumFallback?: BillingRange | null
    legacyParams?: boolean
    /** Dashboard resets on community/interval changes; billing and chart re-read the URL.
     * With reset, the fallback must pass minimumRangeStart or URL reconciliation cannot settle. */
    scopeChange: 'preserve-url' | 'reset'
}

export function readBillingPeriodParams(params: URLSearchParams, legacyParams = false): BillingRange | null {
    if (params.has('period_start') || params.has('period_end')) {
        return billingRangeFromParams(params.get('period_start'), params.get('period_end'))
    }
    return legacyParams ? billingRangeFromParams(params.get('from'), params.get('to')) : null
}

const UNRESOLVED_RANGE: BillingRange = { from: '', to: '' }

/** The URL is authoritative; no effect copies an old period into a new scope's query. */
export function useBillingPeriodParams({
    interval, ready, scopeId, fallback, minimumRangeStart, minimumFallback,
    legacyParams = false, scopeChange,
}: BillingPeriodParamsPolicy) {
    const { searchParams, updateParams } = usePageNavigation()
    const context = `${scopeId}|${interval}`
    const [resolvedContext, setResolvedContext] = useState<string | null>(() => ready ? context : null)
    const reset = ready && resolvedContext !== null && resolvedContext !== context && scopeChange === 'reset'

    const defaultRange = fallback === 'previous-complete'
        ? getPreviousBillingPeriod(interval)
        : getCurrentBillingPeriod(interval)
    const fallbackRange = minimumFallback && defaultRange.from < minimumFallback.from ? minimumFallback : defaultRange
    const requested = readBillingPeriodParams(searchParams, legacyParams)
    const validRange = invoiceRangeFromParams(requested?.from, requested?.to, minimumRangeStart)
    const period = !ready ? UNRESOLVED_RANGE : reset ? fallbackRange : validRange ?? fallbackRange

    const setPeriod = useCallback((next: BillingRange) => {
        if (!ready || !invoiceRangeFromParams(next.from, next.to, minimumRangeStart)) return
        updateParams(params => {
            params.set('period_start', next.from)
            params.set('period_end', next.to)
            if (legacyParams) {
                params.delete('from')
                params.delete('to')
            }
        })
    }, [ready, minimumRangeStart, legacyParams, updateParams])

    useEffect(() => {
        if (!ready || resolvedContext === context) return
        // Navigation can commit after a scope render. Keep returning the reset
        // period until its URL arrives, so queries never see the old URL range
        // paired with the new community between those two updates.
        if (reset && (requested?.from !== fallbackRange.from || requested?.to !== fallbackRange.to)) {
            setPeriod({ from: fallbackRange.from, to: fallbackRange.to })
            return
        }
        setResolvedContext(context)
    }, [ready, resolvedContext, context, reset, setPeriod, fallbackRange.from, fallbackRange.to, requested?.from, requested?.to])

    return { period, setPeriod, isReady: ready }
}
