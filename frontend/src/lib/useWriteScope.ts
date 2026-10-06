import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'

type WriteScope<ZevId> = {
    selectedZevId: ZevId
    canWrite: boolean
    accountId: number | undefined
    /** Narrows the lifetime further, e.g. to one billing period. */
    scopeKey?: string
}

/** Identity represents one uninterrupted account/community/capability lifetime. */
export function useWriteScope<ZevId extends string | null | undefined>({ selectedZevId, canWrite, accountId, scopeKey }: WriteScope<ZevId>, errorMessage: string) {
    const scope = useMemo(() => ({ selectedZevId, canWrite, accountId, scopeKey }), [selectedZevId, canWrite, accountId, scopeKey])
    const currentScope = useRef<typeof scope | null>(scope)
    useLayoutEffect(() => {
        currentScope.current = scope
        return () => { currentScope.current = null }
    }, [scope])

    const isCurrent = useCallback((submittedScope: typeof scope) => currentScope.current === submittedScope, [])
    const assertWritable = useCallback((submittedScope: typeof scope, requireCommunity = true) => {
        if (!isCurrent(submittedScope) || !submittedScope.canWrite || (requireCommunity && !submittedScope.selectedZevId)) {
            throw new Error(errorMessage)
        }
    }, [isCurrent, errorMessage])

    return { scope, isCurrent, assertWritable }
}
