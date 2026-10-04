import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFileInvoice } from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import type { ActionMenuItem } from '../../components/ActionMenu'
import { InvoiceAmount, InvoiceDeliveryStatus, InvoiceLink, InvoicePdfCell, InvoiceRowActions, InvoiceStatusBadge } from '../../components/InvoicePresentation'
import type { InvoicePeriodParticipantRow } from '../../types/api'

type InvoicePeriodRowsTableProps = {
  rows: InvoicePeriodParticipantRow[]
  period: { period_start: string; period_end: string }
  getPrimaryRowAction: (row: InvoicePeriodParticipantRow) => ActionMenuItem | null
  getRowMenuItems: (row: InvoicePeriodParticipantRow) => ActionMenuItem[]
  /** True while this row's PDF is being rendered — queued or inline. */
  isPdfPending: (row: InvoicePeriodParticipantRow) => boolean
}

export function InvoicePeriodRowsTable({
  rows,
  period,
  getPrimaryRowAction,
  getRowMenuItems,
  isPdfPending,
}: InvoicePeriodRowsTableProps) {
  const { t } = useTranslation()

  return (
    <div className="table-card table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('pages.invoices.col.participant')}</th>
            <th>{t('pages.invoices.col.meteringData')}</th>
            <th>{t('pages.invoices.col.invoice')}</th>
            <th>{t('pages.invoices.col.email')}</th>
            <th>{t('pages.invoices.col.total')}</th>
            <th>{t('pages.invoices.col.pdf')}</th>
            <th className="invoice-actions-cell">{t('pages.invoices.col.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const invoice = row.invoice
            const primaryAction = getPrimaryRowAction(row)
            const rowMenuItems = getRowMenuItems(row)
            const pdfPending = isPdfPending(row)

            return (
              <tr key={row.participant_id}>
                <td>
                  <strong>{row.participant_name}</strong>
                  {row.participant_email ? <div className="muted">{row.participant_email}</div> : null}
                </td>
                <td>
                  {row.metering_data_complete ? (
                    <span className="badge badge-success">{t('pages.invoices.metering.complete')}</span>
                  ) : (
                    <>
                      <span className="badge badge-danger">{t('pages.invoices.metering.missing')}</span>
                      <div className="muted" style={{ fontSize: '0.85rem' }}>
                        {t('pages.invoices.metering.pointsWithData', {
                          n: row.metering_points_with_data,
                          total: row.metering_points_total,
                        })}
                      </div>
                      {row.missing_meter_ids.length > 0 && (
                        <ul className="metering-missing-list muted">
                          {row.missing_meter_details?.length
                            ? row.missing_meter_details.map((item) => (
                                <li key={item.meter_id}>
                                  {item.meter_id} ({t('pages.invoices.metering.missingDays', { count: item.missing_days })})
                                </li>
                              ))
                            : row.missing_meter_ids.map((meterId) => <li key={meterId}>{meterId}</li>)}
                        </ul>
                      )}
                    </>
                  )}
                </td>
                <td>
                  {invoice ? (
                    <div className="invoice-cell-stack">
                      <InvoiceLink invoice={invoice} from="/billing/invoices" period={period} />
                      <InvoiceStatusBadge status={invoice.status} />
                    </div>
                  ) : row.generation_eligibility?.state === 'covered' ? (
                    <div className="invoice-cell-stack">
                      <span className="muted">{t('pages.invoices.settledCovered')}</span>
                      <span className="badge badge-success">{t('pages.invoices.settledCovered')}</span>
                    </div>
                  ) : (
                    <div className="invoice-cell-stack">
                      <span className="muted">{t('pages.invoices.notCreated')}</span>
                      <span className="badge badge-neutral">{t('pages.invoices.notCreated')}</span>
                    </div>
                  )}
                </td>
                <td>
                  <InvoiceDeliveryStatus invoice={invoice} />
                </td>
                <td className="numeric"><InvoiceAmount value={invoice?.total_chf ?? null} /></td>
                <td><InvoicePdfCell invoice={invoice} pending={pdfPending} /></td>
                <td className="invoice-actions-cell">
                  <InvoiceRowActions primary={primaryAction} menuItems={rowMenuItems}>
                    {invoice && (
                      <InvoiceLink
                        invoice={invoice}
                        from="/billing/invoices"
                        period={period}
                        className="button button-secondary button-compact"
                      >
                        <FontAwesomeIcon icon={faFileInvoice} fixedWidth />
                        {t('pages.invoices.openDetails')}
                      </InvoiceLink>
                    )}
                  </InvoiceRowActions>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
