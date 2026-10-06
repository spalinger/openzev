import { useTranslation } from 'react-i18next'
import type { InvoiceRowCounts, InvoiceRowFilter } from './invoiceRowFilters'

type InvoiceRowFilterTabsProps = {
  counts: InvoiceRowCounts
  /** The filter the list currently shows; `null` is the whole period. */
  activeFilter: InvoiceRowFilter
  onFilterChange: (filter: InvoiceRowFilter) => void
}

/** All rows first, then the workflow stages, then the rows needing attention. */
const SEGMENTS: Array<{ filter: InvoiceRowFilter; count: keyof InvoiceRowCounts; labelKey: string }> = [
  { filter: null, count: 'all', labelKey: 'pages.invoices.filters.all' },
  { filter: 'drafts', count: 'drafts', labelKey: 'pages.invoices.filters.drafts' },
  { filter: 'approved', count: 'approved', labelKey: 'pages.invoices.filters.approved' },
  { filter: 'sent', count: 'sent', labelKey: 'pages.invoices.filters.sent' },
  { filter: 'issues', count: 'issues', labelKey: 'pages.invoices.filters.issues' },
]

/** Counts stay period-wide. An active filter stays enabled when it empties,
 * so it can still be cleared. */
export function InvoiceRowFilterTabs({ counts, activeFilter, onFilterChange }: InvoiceRowFilterTabsProps) {
  const { t } = useTranslation()
  return (
    <div className="invoice-row-filters" role="group" aria-label={t('pages.invoices.filters.label')}>
      {SEGMENTS.map(({ filter, count, labelKey }) => {
        const pressed = activeFilter === filter
        const attention = filter === 'issues' && counts.issues > 0
        const empty = filter !== null && counts[count] === 0 && !pressed
        return (
          <button
            key={count}
            type="button"
            className={`invoice-row-filter${attention ? ' invoice-row-filter--attention' : ''}`}
            aria-pressed={pressed}
            disabled={empty}
            onClick={() => onFilterChange(pressed ? null : filter)}
          >
            {/* The space keeps the accessible name "Drafts 2"; flex layout drops it visually. */}
            {t(labelKey)}{' '}
            <span className="invoice-row-filter-count">{counts[count]}</span>
          </button>
        )
      })}
    </div>
  )
}
