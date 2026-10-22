import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faClock } from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { formatShortDate } from '../../lib/appSettings'
import type { AppSettings, TariffSeries } from '../../types/api'
import type { TariffOverviewRow } from './validity'
import { validityState } from './validity'
import type { RateLine, useTariffDisplay } from './useTariffDisplay'

type Props = {
  row: TariffOverviewRow
  kind: 'current' | 'history'
  today: string
  settings: AppSettings
  display: ReturnType<typeof useTariffDisplay>
  onOpenDetail: (series: TariffSeries, versionId: string) => void
}

/** Align comparable bands; keep schedule changes and future-only prices distinct. */
export function TariffPricesCell({ row: { series, version: shown, upcomingVersion }, kind, today, settings, display, onOpenDetail }: Props) {
  const { t } = useTranslation()
  const { rateLines, priceSummary, pricingTooltipFor, sourceById } = display
  const lines = rateLines(series, shown)
  const pricingExplanation = pricingTooltipFor(series, shown, shown.dynamic_source ? sourceById.get(shown.dynamic_source) : undefined)
  const scheduled = validityState(shown, today) === 'scheduled'
  const planned = upcomingVersion ?? (scheduled ? shown : null)
  const plannedLines = planned ? rateLines(series, planned) : []
  const hasPlannedPrices = planned && plannedLines.some(line => line.price && line.price !== '—')
  const comparable = !scheduled && lines.length === plannedLines.length && lines.every((line, index) =>
    line.applies === plannedLines[index].applies && line.unit === plannedLines[index].unit)
  const currentHasEnd = kind === 'current' && !scheduled && Boolean(shown.valid_to)

  function priceComparison(line: RateLine, index: number) {
      return (
          <span className="tariff-price-comparison" data-comparison={comparable && hasPlannedPrices ? 'true' : undefined}>
              {planned && (scheduled || comparable) && plannedLines[index]?.price && plannedLines[index].price !== '—' && (
                  <button
                      type="button"
                      className="tariff-upcoming-price"
                      aria-label={t('pages.tariffs.versions.resultingPrices', { date: formatShortDate(planned.valid_from, settings), prices: priceSummary(series, planned) })}
                      onClick={(event) => {
                          event.stopPropagation()
                          onOpenDetail(series, planned.id)
                      }}
                  >
                      <strong>{plannedLines[index].price}</strong>
                  </button>
              )}
              {!scheduled && <span className="tariff-price-current">{line.price}</span>}
          </span>
      )
  }

  return (
    <td className="tariff-table-bands" colSpan={3}
        headers={`tariff-applies-${kind}-${series.category} tariff-price-${kind}-${series.category} tariff-unit-${kind}-${series.category}`}>
        {(hasPlannedPrices && (scheduled || comparable) || currentHasEnd) && (
            <div className="tariff-table-band tariff-price-headings">
                <span />
                <span className="tariff-table-band-price">
                    <span className="tariff-price-comparison" data-comparison={comparable ? 'true' : undefined}>
                        {hasPlannedPrices && (scheduled || comparable) && <span className="tariff-price-planned-heading">{t('pages.tariffs.workspace.from', { date: formatShortDate(planned.valid_from, settings) })}</span>}
                        {!scheduled && <span className="tariff-price-current-heading">
                            <span>{t('pages.tariffs.workspace.today')}</span>
                            {currentHasEnd && <span className="tariff-current-validity">{t('pages.tariffs.validity.until', { date: formatShortDate(shown.valid_to!, settings) })}</span>}
                        </span>}
                    </span>
                    <span className="tariff-table-band-unit" />
                </span>
            </div>
        )}
        {lines.map((line, index) => (
            <div key={index} className="tariff-table-band" title={pricingExplanation ?? line.applies}>
                <span className="tariff-table-band-applies">{line.applies}</span>
                {line.price && (
                    <span className="tariff-table-band-price">
                        {priceComparison(line, index)}{' '}
                        <span className="tariff-table-band-unit"><span className="tariff-table-band-currency">CHF </span>{line.unit}</span>
                    </span>
                )}
            </div>
        ))}
        {hasPlannedPrices && !scheduled && !comparable && (
            <button
                type="button"
                className="tariff-schedule-change"
                onClick={(event) => {
                    event.stopPropagation()
                    onOpenDetail(series, planned.id)
                }}
            >
                <FontAwesomeIcon icon={faClock} fixedWidth />{' '}
                {t('pages.tariffs.workspace.scheduleChanges', { date: formatShortDate(planned.valid_from, settings) })}
            </button>
        )}
    </td>
  )
}
