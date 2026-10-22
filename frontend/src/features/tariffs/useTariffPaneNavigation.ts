import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { TariffSeries } from '../../types/api'
import { useMinWidth } from '../../lib/useMinWidth'
import { allowNavigation } from './useDraftGuard'
import { listedVersion } from './validity'
import { seriesKeyOf } from './useTariffDisplay'

// Whole-workspace threshold; the list has its own 56rem card breakpoint (§4/§5.1).
const SPLIT_MIN_REM = 62
const PANE_STATE = { tariffPane: true }

type Params = {
  allSeries: TariffSeries[]
  today: string
  scopeKey: string
  settled: boolean
  editor: string | null
  onSelectionChange: (series: TariffSeries | null) => void
  onScopeChange: () => void
}

/** URL selection, one history step, and focus/scroll restoration for the pane. */
export function useTariffPaneNavigation({ allSeries, today, scopeKey, settled, editor, onSelectionChange, onScopeChange }: Params) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const tariffParam = params.get('tariff')
  const shownVersionId = params.get('version')
  const openSeries = useMemo(() => !tariffParam ? null : allSeries.find(series => seriesKeyOf(series) === tariffParam)
    ?? allSeries.find(series => series.versions.some(version => version.id === shownVersionId)) ?? null,
  [allSeries, tariffParam, shownVersionId])
  const selected = useMemo(() => {
    if (!openSeries) return null
    const version = openSeries.versions.find(version => version.id === shownVersionId) ?? listedVersion(openSeries.versions, today)
    return { seriesKey: seriesKeyOf(openSeries), versionId: version.id }
  }, [openSeries, shownVersionId, today])
  const [splitRef, fitsTwoPanes] = useMinWidth<HTMLDivElement>(SPLIT_MIN_REM)
  const pageRef = useRef<HTMLDivElement>(null)
  const paneTitleRef = useRef<HTMLHeadingElement>(null)
  const bypassGuard = useRef(false)
  const pendingSelection = useRef<string | null>(null)
  const listScroll = useRef<number | null>(null)
  const returnSeries = useRef<string | null>(null)
  const returnAction = useRef<string | null>(null)
  const focusTitle = useRef(false)
  const paneOpen = openSeries !== null || editor === 'create'
  const listHidden = paneOpen && !fitsTwoPanes

  function update(change: (next: URLSearchParams) => void, replace = true, state = location.state) {
    allowNavigation(bypassGuard, () => setParams(previous => {
      const next = new URLSearchParams(previous)
      change(next)
      return next
    }, { replace, state }))
  }

  function select(series: Pick<TariffSeries, 'zev' | 'name'>, versionId: string) {
    // A rapid second click can precede the first router commit: push only once.
    const fromList = !tariffParam && !pendingSelection.current
    pendingSelection.current = `${seriesKeyOf(series)}:${versionId}`
    if (fromList && !fitsTwoPanes) listScroll.current = window.scrollY
    focusTitle.current = true
    update(next => {
      next.set('tariff', seriesKeyOf(series))
      next.set('version', versionId)
    }, !fromList, !tariffParam ? PANE_STATE : location.state)
  }

  function deselect() {
    returnSeries.current = selected?.seriesKey ?? null
    if (location.state?.tariffPane) allowNavigation(bypassGuard, () => navigate(-1))
    else update(next => { next.delete('tariff'); next.delete('version') })
  }

  const selectionChanged = useEffectEvent(onSelectionChange)
  const previousVersion = useRef(selected?.versionId)
  useLayoutEffect(() => { pendingSelection.current = null }, [tariffParam, shownVersionId])
  useLayoutEffect(() => {
    if (previousVersion.current === selected?.versionId) return
    previousVersion.current = selected?.versionId
    focusTitle.current = Boolean(openSeries)
    selectionChanged(openSeries)
  }, [selected?.versionId, openSeries])

  const resetScope = useEffectEvent(onScopeChange)
  const clearSelection = useEffectEvent(() => update(next => { next.delete('tariff'); next.delete('version') }))
  const previousScope = useRef(scopeKey)
  useEffect(() => {
    const previous = previousScope.current
    previousScope.current = scopeKey
    if (previous === scopeKey || previous.startsWith('|')) return
    resetScope()
    clearSelection()
  }, [scopeKey])

  const normalize = useEffectEvent(() => {
    if (openSeries && tariffParam !== seriesKeyOf(openSeries)) update(next => next.set('tariff', seriesKeyOf(openSeries)))
    else if (settled && tariffParam && !openSeries) clearSelection()
  })
  useEffect(() => { normalize() }, [tariffParam, openSeries, settled])

  const previousSeries = useRef(selected?.seriesKey)
  const previousEditor = useRef(editor)
  useLayoutEffect(() => {
    const wasEditing = previousEditor.current !== null
    previousEditor.current = editor
    if (!paneOpen && previousSeries.current) returnSeries.current ??= previousSeries.current
    previousSeries.current = selected?.seriesKey
    if (paneOpen && focusTitle.current) {
      focusTitle.current = false
      returnAction.current = null
      paneTitleRef.current?.focus()
    } else if (!paneOpen && returnSeries.current) {
      const key = CSS.escape(returnSeries.current)
      const row = pageRef.current?.querySelector<HTMLElement>(`[data-series-key="${key}"] .tariff-select`)
      returnSeries.current = null
      ;(row ?? pageRef.current?.querySelector<HTMLElement>('#tariff-overview-current'))?.focus()
    } else if (editor === null && wasEditing && returnAction.current) {
      const key = CSS.escape(returnAction.current)
      returnAction.current = null
      const action = pageRef.current?.querySelector<HTMLElement>(`[data-action-key="${key}"]`)
      ;(action && !action.closest('[hidden]') ? action : paneTitleRef.current)?.focus()
    }
  }, [paneOpen, selected?.seriesKey, selected?.versionId, editor])

  useLayoutEffect(() => {
    if (!listHidden && listScroll.current !== null) {
      window.scrollTo(0, listScroll.current)
      listScroll.current = null
    }
  }, [listHidden])

  return {
    pageRef, splitRef, paneTitleRef, bypassGuard, openSeries, shownVersionId, selected, paneOpen, listHidden, fitsTwoPanes,
    select, deselect,
    isSelecting: (series: Pick<TariffSeries, 'zev' | 'name'>, id: string) => pendingSelection.current === `${seriesKeyOf(series)}:${id}`,
    editingFrom: (key: string) => { focusTitle.current = false; returnAction.current = key },
    focusTitle: () => { focusTitle.current = true },
  }
}
