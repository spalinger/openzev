import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { allowNavigation, useDraftConfirm } from './useDraftGuard'
import { useMinWidth } from '../lib/useMinWidth'

/** Marks the history entry that opening a record added, so X can take it back instead of leaving a Back step. */
const PANE_STATE = { listPane: true }

/** The record the URL asks to be open under `param` (the page checks that the user may see it). */
export function useSelectedParam(param: string): string | null {
    const [searchParams] = useSearchParams()
    return searchParams.get(param)
}

interface Options {
    /** The query parameter holding the open record's id; the control that opens a record carries `data-<param>-open="<id>"`. */
    param: string
    /** A record is actually shown: the id names one the user may see. */
    paneOpen: boolean
    /** Content width (rem) from which the list and the pane sit side by side; below it the pane takes the area. */
    splitMinRem: number
    confirm: Parameters<typeof useDraftConfirm>[0]['confirm']
    /** Further parameters that belong to the open record and go with it. */
    clearParams?: string[]
    /** A hash that belongs to the open record (a deep link into it) and goes with it; any other hash stays. */
    clearHash?: string
    /** The page's own bypass, when its dialogs guard navigation too (`allowNavigation`). */
    bypass?: RefObject<boolean>
}

/**
 * A record's pane beside its list (SPEC-2026-10-ui-patterns §6.2): the open record is `?<param>=<id>` (a reload,
 * Back or a link reopens it; opening from the list adds one history step, switching replaces it, X takes it back),
 * focus moves to the pane's title when it opens and back to the control that opened it (`data-<param>-open`) when
 * it closes, the list comes back where it was scrolled, and a draft in the pane is asked about before the pane lets
 * go of it. A pane that can hold a draft also passes `draftBlock` to `useRouterDraftBlock`, so Back and links ask
 * too; one that never does registers no router blocker (it works in any router, and a router honours one blocker).
 */
export function useListPane({ param, splitMinRem, confirm, paneOpen, clearParams = [], clearHash, bypass }: Options) {
    const location = useLocation()
    const navigate = useNavigate()
    const [splitRef, fitsTwoPanes] = useMinWidth<HTMLDivElement>(splitMinRem)
    const paneTitleRef = useRef<HTMLHeadingElement>(null)
    const focusRequest = useRef<{ kind: 'pane' } | { kind: 'control'; id: string } | null>(null)
    const listScroll = useRef<number | null>(null)
    const ownBypass = useRef(false)
    const bypassGuard = bypass ?? ownBypass
    const [paneDirty, setPaneDirty] = useState(false)
    const guard = useDraftConfirm({ dirty: paneDirty, confirm, bypass: bypassGuard })
    // A caller may hold an older openItem (an upload's completion handler): act on the committed URL, not the render's.
    const committed = useRef({ location, fitsTwoPanes })
    useLayoutEffect(() => { committed.current = { location, fitsTwoPanes } })

    /** Sets or drops the selection in the URL, keeping every other parameter. */
    function select(id: string | null, options: { replace: boolean; state: unknown }) {
        const { search, hash } = committed.current.location
        const params = new URLSearchParams(search)
        if (id) params.set(param, id)
        else params.delete(param)
        for (const extra of clearParams) params.delete(extra)
        navigate({ search: params.toString(), hash: hash === clearHash ? '' : hash }, options)
    }

    const openId = () => new URLSearchParams(committed.current.location.search).get(param)

    /** The pane shows `item`; the caller decides who may see which. */
    function openItem(item: { id: string }) {
        if (item.id === openId()) return
        const fromList = !openId()
        guard.run(() => {
            if (fromList) {
                focusRequest.current = { kind: 'pane' }
                if (!committed.current.fitsTwoPanes) listScroll.current = window.scrollY
            }
            const state = fromList ? PANE_STATE : committed.current.location.state
            allowNavigation(bypassGuard, () => select(item.id, { replace: !fromList, state }))
        })
    }

    // X takes back the step opening added; a pane reached by a link has no step of ours behind it.
    function closePane() {
        guard.run(() => {
            const id = openId()
            if (id) focusRequest.current = { kind: 'control', id }
            if (committed.current.location.state?.listPane) {
                navigate(-1)
                return
            }
            select(null, { replace: true, state: undefined })
        })
    }

    const listHidden = paneOpen && !fitsTwoPanes

    useEffect(() => {
        const request = focusRequest.current
        if (!request) return
        if (request.kind === 'pane' && paneOpen) {
            const title = paneTitleRef.current
            title?.focus({ preventScroll: true })
            // Beside the list the pane is already in view; one that replaces the list starts at its top (its sticky
            // header would otherwise count as in view while the rest sits above the screen).
            if (!fitsTwoPanes) title?.closest('.detail-pane')?.scrollIntoView?.({ block: 'start' })
        } else if (request.kind === 'control' && !paneOpen) {
            document.querySelector<HTMLElement>(`[data-${param}-open="${CSS.escape(request.id)}"]`)?.focus()
        } else {
            return
        }
        focusRequest.current = null
    }, [paneOpen, fitsTwoPanes, param])

    // The list comes back where the user left it.
    useLayoutEffect(() => {
        if (!listHidden && listScroll.current !== null) {
            window.scrollTo(0, listScroll.current)
            listScroll.current = null
        }
    }, [listHidden])

    const draftBlock = { ask: guard.ask, isActive: guard.isActive, bypass: bypassGuard }
    return { splitRef, fitsTwoPanes, listHidden, paneTitleRef, setPaneDirty, openItem, closePane, draftBlock }
}
