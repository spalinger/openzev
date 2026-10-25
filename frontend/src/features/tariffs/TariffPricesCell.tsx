import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faClock } from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '@mantine/core'
import type { ReactNode } from 'react'
import { formatShortDate } from '../../lib/appSettings'
import type { AppSettings, TariffSeries } from '../../types/api'
import type { TariffOverviewRow } from './validity'
import { validityState } from './validity'
import { sameBandSchedule } from './rateLines'
import type { RateLine, useTariffDisplay } from './useTariffDisplay'

type Props = {
  row: TariffOverviewRow
  kind: 'current' | 'history'
  today: string
  settings: AppSettings
  display: ReturnType<typeof useTariffDisplay>
  onOpenDetail: (series: TariffSeries, versionId: string) => void
  warning?: ReactNode
}

/** One dated comparison column; changed schedules link to their full configuration. */
export function TariffPricesCell({ row: { series, version: shown, upcomingVersion }, kind, today, settings, display, onOpenDetail, warning }: Props) {
  const { t } = useTranslation()
  const { rateLines, pricingTooltipFor, sourceById } = display
  const lines = rateLines(series, shown)
  const pricingExplanation = pricingTooltipFor(series, shown, shown.dynamic_source ? sourceById.get(shown.dynamic_source) : undefined)
  const scheduled = validityState(shown, today) === 'scheduled'
  const planned = upcomingVersion ?? (scheduled ? shown : null)
  const plannedLines = planned ? rateLines(series, planned) : []
  const hasPlannedPrices = planned && plannedLines.some(line => line.price && line.price !== '—')
  const showComparison = Boolean(hasPlannedPrices && !scheduled)
  const comparable = !scheduled && planned && Boolean(shown.dynamic_source) === Boolean(planned.dynamic_source)
    && shown.periods.length === planned.periods.length
    && shown.periods.every((band, index) => sameBandSchedule(band, planned.periods[index]))
    && lines.length === plannedLines.length && lines.every((line, index) => line.unit === plannedLines[index].unit)

  const comparisonColumns = showComparison && comparable
  const changedSchedule = showComparison && !comparable
  const comparisonRows = `1 / span ${Math.max(lines.length, plannedLines.length) + 1}`
  const plannedInfo = planned ? [
    t(comparable ? 'pages.tariffs.workspace.from' : 'pages.tariffs.workspace.scheduleChanges', { date: formatShortDate(planned.valid_from, settings) }),
    ...plannedLines.map(line => `${line.applies}: ${line.price || '—'} ${line.unit}`),
  ].join('\n') : ''

  function priceComparison(line: RateLine, index: number) {
    return (
      <span className="tariff-price-comparison" data-comparison={comparisonColumns ? 'true' : undefined}>
        {planned && (scheduled || comparisonColumns) && (plannedLines[index]?.price && plannedLines[index].price !== '—' ? (
          <button
            type="button"
            className="tariff-upcoming-price"
            aria-label={t('pages.tariffs.workspace.showPlannedPrice', {
              band: plannedLines[index].applies,
              price: `${plannedLines[index].price} ${plannedLines[index].unit}`,
              date: formatShortDate(planned.valid_from, settings),
            })}
            onClick={(event) => {
              event.stopPropagation()
              onOpenDetail(series, planned.id)
            }}
          >
            <strong>{plannedLines[index].price}</strong>
          </button>
        ) : <span className={scheduled ? 'tariff-price-current' : 'tariff-price-planned-heading'}>—</span>)}
        {!scheduled && <span className="tariff-price-current">{line.price || '—'}</span>}
      </span>
    )
  }

  const headings = hasPlannedPrices && (
    <div className="tariff-table-band tariff-price-headings">
        <span />
        <span className="tariff-table-band-price">
            <span className="tariff-price-comparison" data-comparison={comparisonColumns ? 'true' : undefined}>
                {(scheduled || comparable) && <span className="tariff-price-planned-heading"><FontAwesomeIcon icon={faClock} fixedWidth aria-hidden="true" />{' '}{t('pages.tariffs.workspace.from', { date: formatShortDate(planned.valid_from, settings) })}</span>}
                {!scheduled && <span className="tariff-price-current-heading">
                    {showComparison && <Tooltip label={plannedInfo} multiline w="min(20rem, calc(100vw - 2rem))"
                        classNames={{ tooltip: 'tariff-planned-tooltip' }} events={{ hover: true, focus: true, touch: true }}>
                        <button type="button" className="tariff-planned-compact" aria-label={plannedInfo}
                            onClick={event => event.stopPropagation()}>
                            <FontAwesomeIcon icon={faClock} fixedWidth aria-hidden="true" />
                        </button>
                    </Tooltip>}
                    <span>{t('pages.tariffs.workspace.today')}</span>
                </span>}
            </span>
            <span className="tariff-table-band-unit" />
        </span>
    </div>
)

  const rates = lines.map((line, index) => (
    <div key={index} className="tariff-table-band" title={pricingExplanation ?? line.applies} data-band-label={!!line.label || undefined}>
        {line.label && <span className="tariff-rate-name">{line.label}</span>}
        {line.schedule && <span className="tariff-rate-schedule">{line.schedule}</span>}
        <span className="tariff-table-band-applies">{line.applies}</span>
        {line.price && (
            <span className="tariff-table-band-price">
                {priceComparison(line, index)}{' '}
                <span className="tariff-table-band-unit">{line.unit}</span>
            </span>
        )}
    </div>
))

  return (
    <td className="tariff-table-bands" colSpan={3} data-comparison={comparisonColumns || undefined} data-schedule-change={changedSchedule || undefined} data-future-only={Boolean(hasPlannedPrices && scheduled) || undefined}
        headers={`tariff-applies-${kind}-${series.category} tariff-price-${kind}-${series.category} tariff-unit-${kind}-${series.category}`}>
        {changedSchedule ? <div className="tariff-current-group" style={{ gridRow: comparisonRows }}>
            {headings}
            <div className="tariff-current-rates">{rates}</div>
        </div> : <>{headings}{rates}</>}
        {planned && changedSchedule && <button type="button" className="tariff-upcoming-price tariff-planned-summary" style={{ gridRow: comparisonRows }}
            onClick={event => {
                event.stopPropagation()
                onOpenDetail(series, planned.id)
            }}>
            <span className="tariff-schedule-change"><FontAwesomeIcon icon={faClock} fixedWidth aria-hidden="true" />{' '}
                {t('pages.tariffs.workspace.scheduleChanges', { date: formatShortDate(planned.valid_from, settings) })}
            </span>
            <span className="tariff-planned-rates">{plannedLines.map((line, index) => <span className="tariff-planned-rate" key={index}>
                <span>{line.applies}</span>
                <span><strong>{line.price || '—'}</strong>{!lines.some(current => current.price && current.unit === line.unit) && <> {line.unit}</>}</span>
            </span>)}</span>
        </button>}
        {warning}
    </td>
  )
}
