import { useEffect, useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleInfo } from '@fortawesome/free-solid-svg-icons'
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CivilDateInput } from '../../components/CivilDateInput'
import { DataTable, type ColumnDef } from '../../components/DataTable'
import { FormModal } from '../../components/FormModal'
import { StatCard } from '../../components/StatCard'
import { Notice } from '../../components/Notice'
import { PageSkeleton } from '../../components/PageSkeleton'
import { fetchDynamicPriceHistory } from '../../lib/api/tariffs'
import { formatDateTime, formatShortDate, useAppSettings } from '../../lib/appSettings'
import { AXIS_COLOR, CHART_GRIDLINE, CONS_COLORS, NEGATIVE_COLOR } from '../../lib/chartTokens'
import { CHART_TOOLTIP_STYLE } from '../../lib/chartTheme'
import { businessDayStartMs, formatBusinessIsoDate, nextIsoDate, formatIsoDate, todayBusinessIso } from '../../lib/dates'
import { queryKeys } from '../../lib/api/queryKeys'
import type { DynamicPriceHistory, DynamicPricePoint, DynamicTariffSource, Tariff } from '../../types/api'

/** What the history view needs from the tariff it was opened for, if any. */
export type TariffValidityContext = Pick<Tariff, 'valid_from' | 'valid_to' | 'minimum_price_chf_per_kwh'>

export function dynamicChartData(points: DynamicPricePoint[], gaps: DynamicPriceHistory['gaps'], start: number, end: number) {
  const data: Array<{ timestamp: number; price: number | null }> = []
  for (const point of points) {
    const from = Math.max(start, Date.parse(point.valid_from))
    const to = Math.min(end, Date.parse(point.valid_to))
    if (from < to) data.push({ timestamp: from, price: Number(point.price_chf_per_kwh) }, { timestamp: to - 1, price: Number(point.price_chf_per_kwh) })
  }
  for (const gap of gaps) {
    data.push({ timestamp: Date.parse(gap.from), price: null }, { timestamp: Date.parse(gap.to) - 1, price: null })
  }
  return data.sort((a, b) => a.timestamp - b.timestamp)
}

/** Future intervals may not have been published yet; warn only about elapsed time. */
export function elapsedPriceGaps(gaps: DynamicPriceHistory['gaps'], now: number): DynamicPriceHistory['gaps'] {
  return gaps.flatMap(gap => {
    const end = Math.min(Date.parse(gap.to), now)
    return Date.parse(gap.from) < end ? [{ from: gap.from, to: new Date(end).toISOString() }] : []
  })
}

/** Collapse missing intervals into distinct civil dates; exact timestamps remain in the disclosure. */
export function missingPriceDates(gaps: DynamicPriceHistory['gaps']) {
  const dates = gaps.map(gap => ({
    from: formatBusinessIsoDate(new Date(gap.from)),
    to: formatBusinessIsoDate(new Date(Date.parse(gap.to) - 1)),
  })).sort((a, b) => a.from.localeCompare(b.from))
  const ranges: Array<{ from: string, to: string }> = []
  for (const range of dates) {
    const previous = ranges.at(-1)
    if (previous && range.from <= nextIsoDate(previous.to)) previous.to = previous.to > range.to ? previous.to : range.to
    else ranges.push(range)
  }
  return ranges
}

function daysBefore(isoDate: string, days: number): string {
  const value = new Date(`${isoDate}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() - days)
  return value.toISOString().slice(0, 10)
}

/**
 * The last civil date a tariff's own prices should be shown for.
 *
 * An open-ended tariff (`valid_to` null) is bounded at "today", since nothing
 * is published beyond it yet — except for a not-yet-started tariff, where
 * "today" would sit *before* `valid_from` and invert the range; there, the
 * bound is `valid_from` itself, an intentionally empty one-day window.
 */
function validityUpperBound(tariff: TariffValidityContext, today: string): string {
  const openEndedBound = tariff.valid_from > today ? tariff.valid_from : today
  return tariff.valid_to && tariff.valid_to < openEndedBound ? tariff.valid_to : openEndedBound
}

/**
 * Clip a range to a tariff's own validity window.
 *
 * A dynamic source is shared globally (ADR 0018) — its stored series can run
 * years before a given tariff ever linked to it, and past any date the
 * tariff was closed on. Opened from the tariff page, "price history" means
 * this tariff's prices, so neither end belongs in view: showing them reads
 * as the tariff having billed at a price it never charged anyone at.
 */
function clampToValidity(
  range: { dateFrom: string, dateTo: string },
  tariff: TariffValidityContext,
  today: string,
): { dateFrom: string, dateTo: string } {
  const upperBound = validityUpperBound(tariff, today)
  const dateFrom = range.dateFrom < tariff.valid_from ? tariff.valid_from : range.dateFrom
  const dateTo = range.dateTo > upperBound ? upperBound : range.dateTo
  // The source's own default window and the tariff's validity can be
  // disjoint entirely (a brand-new tariff on a source with years of prior
  // history) — clamping each end independently would then invert the range.
  return dateFrom > dateTo ? { dateFrom: tariff.valid_from, dateTo: upperBound } : { dateFrom, dateTo }
}

/**
 * The date range a freshly opened history view should start on.
 *
 * A quarter-hourly VSE source defaults to the last week, which is a
 * reasonable recent slice. A BFE reference-price source publishes one point
 * per quarter (or month), so the same default almost always lands on an
 * unpublished period and looks like nothing was ever fetched — default to
 * the source's own covered range instead. Either way, opened for a specific
 * tariff, the range is then clipped to that tariff's own validity.
 */
export function defaultHistoryDateRange(
  source: DynamicTariffSource,
  today: string,
  tariff?: TariffValidityContext | null,
): { dateFrom: string, dateTo: string } {
  const base = source.api_version === 'bfe_rmp' && source.covers_from && source.covers_to
    ? {
      // covers_to is the exclusive end of the last interval, which always
      // lands on a local month boundary here — the inclusive last covered
      // day is the one before it.
      dateFrom: formatIsoDate(new Date(source.covers_from)),
      dateTo: daysBefore(formatIsoDate(new Date(source.covers_to)), 1),
    }
    : { dateFrom: daysBefore(today, 6), dateTo: today }
  return tariff ? clampToValidity(base, tariff, today) : base
}

/**
 * Floor each point at the tariff's minimum, the same way
 * `TariffResolver.price_at` bills it (`backend/invoices/engine.py`) — a
 * fetched price below the floor is displayed at the floor, not at what the
 * series actually published.
 */
export function applyMinimumPrice(
  points: DynamicPricePoint[],
  minimumPriceChfPerKwh: string | null | undefined,
): DynamicPricePoint[] {
  if (!minimumPriceChfPerKwh) return points
  const floor = Number(minimumPriceChfPerKwh)
  return points.map((point) => (
    Number(point.price_chf_per_kwh) < floor
      ? { ...point, price_chf_per_kwh: minimumPriceChfPerKwh }
      : point
  ))
}

/**
 * Recompute the price-derived stats from (already floored) points.
 *
 * `gap_count` is about coverage, not price, so it is passed through from the
 * server response rather than recomputed.
 */
export function statsFromPoints(points: DynamicPricePoint[], gapCount: number): DynamicPriceHistory['stats'] {
  const prices = points.map((point) => Number(point.price_chf_per_kwh))
  if (prices.length === 0) {
    return {
      point_count: 0, minimum_chf_per_kwh: null, maximum_chf_per_kwh: null,
      average_chf_per_kwh: null, negative_count: 0, gap_count: gapCount,
    }
  }
  const sum = prices.reduce((total, price) => total + price, 0)
  return {
    point_count: prices.length,
    minimum_chf_per_kwh: Math.min(...prices).toFixed(5),
    maximum_chf_per_kwh: Math.max(...prices).toFixed(5),
    average_chf_per_kwh: (sum / prices.length).toFixed(5),
    negative_count: prices.filter((price) => price < 0).length,
    gap_count: gapCount,
  }
}

type PanelProps = {
  source: DynamicTariffSource
  /** The tariff this history was opened for, if any — see `TariffValidityContext`. */
  tariff?: TariffValidityContext | null
  /** Inline history uses a short records page below the chart. */
  compact?: boolean
}

/** Fetched prices in the tariff pane or the source-admin dialog. */
export function DynamicPriceHistoryPanel({ source, tariff, compact = false }: PanelProps) {
  const { t } = useTranslation()
  const { settings } = useAppSettings()
  const today = todayBusinessIso()
  const [dateFrom, setDateFrom] = useState(() => defaultHistoryDateRange(source, today, tariff).dateFrom)
  const [dateTo, setDateTo] = useState(() => defaultHistoryDateRange(source, today, tariff).dateTo)
  const rangeErrorId = useId()
  const recordsTitleId = useId()
  const rangeError = dateFrom && dateTo && dateFrom > dateTo ? t('pages.tariffs.apiErrors.dateRange') : undefined

  useEffect(() => {
    const range = defaultHistoryDateRange(source, today, tariff)
    setDateFrom(range.dateFrom)
    setDateTo(range.dateTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id, tariff?.valid_from, tariff?.valid_to])

  const historyQuery = useQuery({
    queryKey: queryKeys.tariffs.dynamicPrices(source.id, dateFrom, dateTo),
    queryFn: () => fetchDynamicPriceHistory(source.id, dateFrom, dateTo),
    enabled: Boolean(dateFrom && dateTo && !rangeError),
  })

  const points = useMemo(
    () => applyMinimumPrice(historyQuery.data?.points ?? [], tariff?.minimum_price_chf_per_kwh),
    [historyQuery.data, tariff?.minimum_price_chf_per_kwh],
  )

  const rangeStart = dateFrom ? businessDayStartMs(dateFrom) : 0
  const rangeEnd = dateTo ? businessDayStartMs(nextIsoDate(dateTo)) : 0
  const chartData = useMemo(() => dynamicChartData(points, historyQuery.data?.gaps ?? [], rangeStart, rangeEnd), [points, historyQuery.data, rangeStart, rangeEnd])

  const columns = useMemo<ColumnDef<DynamicPricePoint, unknown>[]>(() => [
    {
      accessorKey: 'valid_from',
      header: t('pages.dynamicSources.history.from'),
      cell: ({ row }) => formatDateTime(row.original.valid_from, settings),
    },
    {
      accessorKey: 'valid_to',
      header: t('pages.dynamicSources.history.to'),
      cell: ({ row }) => formatDateTime(row.original.valid_to, settings),
    },
    {
      accessorKey: 'price_chf_per_kwh',
      header: t('pages.dynamicSources.history.price'),
      cell: ({ row }) => Number(row.original.price_chf_per_kwh).toFixed(5),
      meta: { numeric: true },
    },
  ], [settings, t])

  const hasFloor = Boolean(tariff?.minimum_price_chf_per_kwh)
  const stats = hasFloor && historyQuery.data
    ? statsFromPoints(points, historyQuery.data.stats.gap_count)
    : historyQuery.data?.stats
  const validityMin = tariff?.valid_from
  const validityMax = tariff ? validityUpperBound(tariff, today) : undefined
  const gaps = elapsedPriceGaps(historyQuery.data?.gaps ?? [], historyQuery.dataUpdatedAt)
  const emptyMessage = t(tariff && tariff.valid_from > today ? 'pages.dynamicSources.history.futureEmpty' : 'pages.dynamicSources.history.empty')
  const records = (
    <DataTable
      data={points}
      columns={columns}
      getRowId={(point) => point.valid_from}
      loading={historyQuery.isLoading}
      emptyMessage={emptyMessage}
      initialPageSize={compact ? 12 : undefined}
    />
  )

  return (
    <div className="page-stack">
      <div className="form-grid">
        <label>
          <span>{t('pages.dynamicSources.history.dateFrom')}</span>
          <CivilDateInput
            value={dateFrom}
            onChange={(value) => setDateFrom(value ?? '')}
            minDate={validityMin}
            maxDate={validityMax}
          />
        </label>
        <label>
          <span>{t('pages.dynamicSources.history.dateTo')}</span>
          <CivilDateInput
            value={dateTo}
            onChange={(value) => setDateTo(value ?? '')}
            minDate={validityMin}
            maxDate={validityMax}
            error={rangeError}
            errorId={rangeErrorId}
          />
        </label>
      </div>
      {gaps.length > 0 && (
        <section className="tariff-band-coverage tariff-band-warning tariff-dynamic-gaps" role="status">
          <FontAwesomeIcon icon={faCircleInfo} fixedWidth aria-hidden="true" />
          <div>
            <strong>{t('pages.dynamicSources.history.gapTitle')}</strong>
            {missingPriceDates(gaps).map(range => {
              const from = formatShortDate(range.from, settings)
              const to = formatShortDate(range.to, settings)
              return <p key={range.from}>{t(from === to ? 'pages.tariffs.ux.missingDate' : 'pages.tariffs.ux.missingDates', { date: from, from, to })}</p>
            })}
            <p className="muted">{t('pages.tariffs.ux.missingEffect')}</p>
            <p>{t('pages.tariffs.ux.exactIntervals')}</p><ul>
              {gaps.map(gap => <li key={gap.from}>{formatDateTime(gap.from, settings)} – {formatDateTime(gap.to, settings)}</li>)}
            </ul>
          </div>
        </section>
      )}


      {tariff && !compact && (
        <p className="muted" style={{ margin: 0 }}>
          {t('pages.dynamicSources.history.validityScope', {
            from: formatShortDate(tariff.valid_from, settings),
            to: tariff.valid_to ? formatShortDate(tariff.valid_to, settings) : t('pages.tariffs.openEnded'),
          })}
          {hasFloor && ` ${t('pages.dynamicSources.history.minimumApplied', {
            price: Number(tariff.minimum_price_chf_per_kwh).toFixed(5),
          })}`}
        </p>
      )}

      {compact && hasFloor && (
        <p className="muted tariff-period-meta">
          {t('pages.dynamicSources.history.minimumApplied', { price: Number(tariff!.minimum_price_chf_per_kwh).toFixed(5) })}
        </p>
      )}

      {historyQuery.isError && <Notice tone="error" onRetry={() => void historyQuery.refetch()} isRetrying={historyQuery.isFetching}>{t('pages.dynamicSources.history.loadError')}</Notice>}

      {stats && !compact && (
        <div className="kpi-row">
          <StatCard label={t('pages.dynamicSources.history.points')} value={stats.point_count} flat />
          <StatCard
            label={t('pages.dynamicSources.history.average')}
            value={stats.average_chf_per_kwh == null ? '—' : Number(stats.average_chf_per_kwh).toFixed(5)}
            flat
          />
          <StatCard label={t('pages.dynamicSources.history.negative')} value={stats.negative_count} flat />
          <StatCard
            label={t('pages.dynamicSources.history.gaps')}
            value={stats.gap_count}
            tone={stats.gap_count > 0 ? 'warning' : 'success'}
          />
        </div>
      )}

      {compact && historyQuery.isLoading && <PageSkeleton variant="card" />}
      {compact && historyQuery.isSuccess && points.length === 0 && <p className="muted">{emptyMessage}</p>}

      {points.length > 0 && (
        <section className={compact ? 'tariff-dynamic-chart' : 'card'} aria-label={t('pages.tariffs.priceHistory.title')}>
          <p className="muted tariff-period-meta">{t('pages.tariffs.ux.chartUnit')}</p>
          <ResponsiveContainer width="100%" height={compact ? 220 : 280}>
            <LineChart data={chartData} margin={{ top: 8, right: 18, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRIDLINE} />
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={[rangeStart, rangeEnd]}
                allowDataOverflow
                tickFormatter={(value: number) => formatDateTime(new Date(value).toISOString(), settings)}
                stroke={AXIS_COLOR}
                fontSize={11}
                minTickGap={48}
              />
              <YAxis stroke={AXIS_COLOR} fontSize={11} width={64} tickFormatter={(value) => Number(value).toFixed(3)} />
              <ReferenceLine y={0} stroke={AXIS_COLOR} />
              {(historyQuery.data?.gaps ?? []).map(gap => <ReferenceArea key={gap.from} x1={Date.parse(gap.from)} x2={Date.parse(gap.to)} fill={NEGATIVE_COLOR} fillOpacity={0.12} />)}
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                labelFormatter={(value) => formatDateTime(new Date(Number(value)).toISOString(), settings)}
                formatter={(value) => [`${Number(value).toFixed(5)} CHF/kWh`, t('pages.dynamicSources.history.price')]}
              />
              <Line
                dataKey="price"
                type="stepAfter"
                stroke={CONS_COLORS[0]}
                dot={points.length === 1 ? { r: 4 } : false}
                connectNulls={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {compact ? points.length > 0 && <section aria-labelledby={recordsTitleId}>
        <h4 id={recordsTitleId}>{t('pages.dynamicSources.history.sectionTitle')}</h4>{records}
      </section> : records}
    </div>
  )
}

type ModalProps = {
  source: DynamicTariffSource | null
  onClose: () => void
  /** The tariff this history was opened for, if any — see `TariffValidityContext`. */
  tariff?: TariffValidityContext | null
}

/** The admin dynamic-sources table opens this out of context, from a row
 * action rather than an already-open detail view — so unlike the tariff
 * inline detail, it still gets a modal around the same panel. */
export function DynamicPriceHistoryModal({ source, onClose, tariff }: ModalProps) {
  const { t } = useTranslation()
  return (
    <FormModal
      isOpen={Boolean(source)}
      title={t('pages.dynamicSources.history.title', { label: source?.label ?? '' })}
      onClose={onClose}
      maxWidth="1000px"
    >
      {source && <DynamicPriceHistoryPanel source={source} tariff={tariff} />}
    </FormModal>
  )
}
