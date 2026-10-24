import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { TariffSeries } from '../../types/api'
import { useMinWidth } from '../../lib/useMinWidth'
import { allowNavigation } from './useDraftGuard'
import { listedVersion } from './validity'
import { seriesKeyOf } from './useTariffDisplay'

const PANE_STATE = { tariffPane: true }

type Params = {
  allSeries: TariffSeries[]
  today: string
  scopeKey: string
  settled: boolean
  editor: string | null
  onSelectionChange: (versionId: string | null) => void
  onScopeChange: () => void
}

/** One URL-linked expanded tariff and one guarded editing task. */
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
  const [splitRef, fitsTwoPanes] = useMinWidth<HTMLDivElement>(62)
  const pageRef = useRef<HTMLDivElement>(null)
  const paneTitleRef = useRef<HTMLHeadingElement>(null)
  const bypassGuard = useRef(false)
  const pendingSelection = useRef<string | null>(null)
  const returnAction = useRef<string | null>(null)
  const listScroll = useRef<number | null>(null)
  const paneOpen = editor !== null
  const listHidden = paneOpen && !fitsTwoPanes

  function update(change: (next: URLSearchParams) => void, replace = true, state = location.state) {
    allowNavigation(bypassGuard, () => setParams(previous => {
      const next = new URLSearchParams(previous)
      change(next)
      return next
    }, { replace, state }))
  }

  function select(series: Pick<TariffSeries, 'zev' | 'name'>, versionId: string) {
    const fromList = !tariffParam && !pendingSelection.current
    pendingSelection.current = `${seriesKeyOf(series)}:${versionId}`
    update(next => {
      next.set('tariff', seriesKeyOf(series))
      next.set('version', versionId)
    }, !fromList, !tariffParam ? PANE_STATE : location.state)
  }

  function collapse(series: TariffSeries) {
    pageRef.current?.querySelector<HTMLElement>(`[data-series-key="${CSS.escape(seriesKeyOf(series))}"] .tariff-select`)?.focus()
    if (selected?.seriesKey === seriesKeyOf(series)) {
      if (location.state?.tariffPane) allowNavigation(bypassGuard, () => navigate(-1))
      else update(next => { next.delete('tariff'); next.delete('version') })
    }
  }

  const selectionChanged = useEffectEvent(onSelectionChange)
  const previousVersion = useRef(selected?.versionId)
  const previousSeries = useRef(selected?.seriesKey)
  useLayoutEffect(() => { pendingSelection.current = null }, [tariffParam, shownVersionId])
  useLayoutEffect(() => {
    const previous = previousVersion.current
    const wasSeries = previousSeries.current
    previousVersion.current = selected?.versionId
    previousSeries.current = selected?.seriesKey
    if (previous !== selected?.versionId) {
      returnAction.current = null
      selectionChanged(selected?.versionId ?? null)
      if (selected && wasSeries !== selected.seriesKey) pageRef.current?.querySelector<HTMLElement>(`[data-series-key="${CSS.escape(selected.seriesKey)}"] .tariff-select`)?.focus()
    }
  }, [selected?.versionId, openSeries, selected])

  const resetScope = useEffectEvent(onScopeChange)
  const clearSelection = useEffectEvent(() => update(next => { next.delete('tariff'); next.delete('version') }))
  const previousScope = useRef(scopeKey)
  useLayoutEffect(() => {
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

  const previousEditor = useRef(editor)
  useLayoutEffect(() => {
    const wasEditing = previousEditor.current !== null
    previousEditor.current = editor
    if (editor !== null && !wasEditing) {
      if (!fitsTwoPanes) listScroll.current = window.scrollY
      // Forms with their own field focus keep it; the heading is the fallback.
      if (!pageRef.current?.querySelector('.tariff-pane')?.contains(document.activeElement)) paneTitleRef.current?.focus()
    } else if (editor === null && wasEditing) {
      const detail = selected && pageRef.current?.querySelector<HTMLElement>(`[data-series-key="${CSS.escape(selected.seriesKey)}"]`)
      const key = returnAction.current
      const action = key && (detail?.querySelector<HTMLElement>(`[data-action-key="${CSS.escape(key)}"]`) || pageRef.current?.querySelector<HTMLElement>(`[data-action-key="${CSS.escape(key)}"]`))
      returnAction.current = null
      ;(action || detail?.querySelector<HTMLElement>('.tariff-select') || pageRef.current?.querySelector<HTMLElement>('#tariff-overview-current'))?.focus()
    }
  }, [editor, fitsTwoPanes, selected])

  useLayoutEffect(() => {
    if (!listHidden && listScroll.current !== null) {
      window.scrollTo(0, listScroll.current)
      listScroll.current = null
    }
  }, [listHidden])

  return {
    pageRef, splitRef, paneTitleRef, bypassGuard, openSeries, shownVersionId, selected, paneOpen, listHidden, fitsTwoPanes,
    select, collapse,
    expandedVersion: (series: TariffSeries) => selected?.seriesKey === seriesKeyOf(series) ? selected.versionId : null,
    isSelecting: (series: Pick<TariffSeries, 'zev' | 'name'>, id: string) => pendingSelection.current === `${seriesKeyOf(series)}:${id}`,
    editingFrom: (key: string) => { returnAction.current = key },
  }
}
