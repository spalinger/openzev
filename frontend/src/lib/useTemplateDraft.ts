import { useEffect, useState } from 'react'

/** Keep local edits during background refreshes; accept clean server changes. */
export function useTemplateDraft<TData, TValue>(
    data: TData | undefined,
    busy: boolean,
    select: (data: TData) => TValue,
    equal: (left: TValue, right: TValue) => boolean,
) {
    const [draft, setDraft] = useState<TValue | null>(null)
    const [saved, setSaved] = useState<TValue | null>(null)

    useEffect(() => {
        if (!data || busy || (saved !== null && draft !== null && !equal(draft, saved))) return
        const next = select(data)
        if (draft === null || !equal(draft, next)) setDraft(next)
        if (saved === null || !equal(saved, next)) setSaved(next)
    }, [data, busy, draft, saved, select, equal])

    function accept(value: TValue) {
        setDraft(value)
        setSaved(value)
    }

    return { draft, setDraft, saved, accept }
}
