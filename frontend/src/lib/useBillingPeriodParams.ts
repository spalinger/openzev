import { useCallback, useEffect, useState } from 'react'
import {
    billingRangeFromParams,
    getCurrentBillingPeriod,
    getPreviousBillingPeriod,
    invoiceRangeFromParams,
    isBillingAlignedPeriod,
    alignedPeriodEndingWith,
    type BillingInterval,
} from './billingPeriod'
import { usePageNavigation } from './usePageNavigation'

export type BillingRange = { from: string; to: string }

type BillingPeriodParamsPolicy = {
    interval: BillingInterval | undefined
    /** False until the consumer has the scope/interval data it needs. */
    ready: boolean
    scopeId: string
    fallback: 'current' | 'previous-complete'
    /** URL ranges are bounded by community start, never today's aligned floor. */
    minimumRangeStart?: string | null
    /** Only the default period is bounded by this aligned range. */
    minimumFallback?: BillingRange | null
    legacyParams?: boolean
    /** Dashboard resets on community/interval changes; the chart re-reads the URL;
     * billing aligns a carried-over range to the new community's periods.
     * With reset, the fallback must pass minimumRangeStart or URL reconciliation cannot settle. */
    scopeChange: 'preserve-url' | 'reset' | 'align'
}

export function readBillingPeriodParams(params: URLSearchParams, legacyParams = false): BillingRange | null {
    if (params.has('period_start') || params.has('period_end')) {
        return billingRangeFromParams(params.get('period_start'), params.get('period_end'))
    }
    return legacyParams ? billingRangeFromParams(params.get('from'), params.get('to')) : null
}

const UNRESOLVED_RANGE: BillingRange = { from: '', to: '' }

/** URL rewrite needed for a scope change or a rejected billing link. */
export function resolveBillingPeriodTarget({
    scopeChanged, scopeChange, interval, validRange, hasRangeParams,
    fallbackRange, minimumRangeStart, minimumFallback,
}: {
    scopeChanged: boolean
    scopeChange: BillingPeriodParamsPolicy['scopeChange']
    interval: BillingInterval
    validRange: BillingRange | null
    hasRangeParams: boolean
    fallbackRange: BillingRange
    minimumRangeStart?: string | null
    minimumFallback?: BillingRange | null
}): BillingRange | null {
    if (scopeChanged && scopeChange === 'reset') return fallbackRange
    if (scopeChange !== 'align') return null
    if (hasRangeParams && !validRange) return fallbackRange
    if (!scopeChanged || !validRange || isBillingAlignedPeriod(validRange.from, validRange.to, interval)) return null
    const aligned = alignedPeriodEndingWith(validRange, interval)
    if (!invoiceRangeFromParams(aligned.from, aligned.to, minimumRangeStart)
        || (minimumFallback && aligned.from < minimumFallback.from)) return fallbackRange
    return aligned
}

/** The URL is authoritative; no effect copies an old period into a new scope's query. */
export function useBillingPeriodParams({
    interval, ready: scopeReady, scopeId, fallback, minimumRangeStart, minimumFallback,
    legacyParams = false, scopeChange,
}: BillingPeriodParamsPolicy) {
    const { searchParams, updateParams } = usePageNavigation()
    const ready = scopeReady && interval !== undefined
    const context = `${scopeId}|${interval}`
    const [resolvedContext, setResolvedContext] = useState<string | null>(() => ready ? context : null)
    const scopeChanged = ready && resolvedContext !== null && resolvedContext !== context

    const defaultRange = interval === undefined ? UNRESOLVED_RANGE : fallback === 'previous-complete'
        ? getPreviousBillingPeriod(interval)
        : getCurrentBillingPeriod(interval)
    const fallbackRange = minimumFallback && defaultRange.from < minimumFallback.from ? minimumFallback : defaultRange
    const requested = readBillingPeriodParams(searchParams, legacyParams)
    const validRange = invoiceRangeFromParams(requested?.from, requested?.to, minimumRangeStart)
    const hasRangeParams = searchParams.has('period_start') || searchParams.has('period_end')
        || (legacyParams && (searchParams.has('from') || searchParams.has('to')))
    const rejected = ready && scopeChange === 'align' && hasRangeParams && !validRange
    const target = ready && interval ? resolveBillingPeriodTarget({
        scopeChanged, scopeChange, interval, validRange, hasRangeParams,
        fallbackRange, minimumRangeStart, minimumFallback,
    }) : null
    const period = !ready ? UNRESOLVED_RANGE : target ?? validRange ?? fallbackRange
    const targetFrom = target?.from
    const targetTo = target?.to

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
        if (!ready || (resolvedContext === context && !rejected)) return
        // Navigation can commit after a scope render. Keep returning the reset
        // period until its URL arrives, so queries never see the old URL range
        // paired with the new community between those two updates.
        if (targetFrom && targetTo && (requested?.from !== targetFrom || requested?.to !== targetTo)) {
            setPeriod({ from: targetFrom, to: targetTo })
            return
        }
        setResolvedContext(context)
    }, [ready, resolvedContext, context, rejected, targetFrom, targetTo, setPeriod, requested?.from, requested?.to])

    return { period, setPeriod, isReady: ready }
}
