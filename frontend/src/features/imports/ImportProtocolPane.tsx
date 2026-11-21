import { useMemo, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTable, type ColumnDef } from '../../components/DataTable'
import { DetailPane } from '../../components/DetailPane'
import { HeldReadingsPanel } from '../../components/HeldReadingsPanel'
import { formatDateTime, useAppSettings } from '../../lib/appSettings'
import type { ImportLog, SdatIssue } from '../../types/api'
import { CorrectionHistory } from './CorrectionHistory'
import {
    SDAT_COUNT_ORDER,
    importLogProtectionCode,
    isSdatLog,
    sdatIssueParams,
    sdatOutcomeKind,
    type SdatOutcomeKind,
} from './sdatOutcome'

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
    return <><dt className="muted">{label}</dt><dd>{children}</dd></>
}

function SdatIssues({ issues }: { issues: SdatIssue[] }) {
    const { t } = useTranslation()
    const ordered = useMemo(
        () => [...issues].sort((left, right) => (left.severity === right.severity ? 0 : left.severity === 'error' ? -1 : 1)),
        [issues],
    )
    if (ordered.length === 0) return null
    return (
        <div className="page-stack sdat-issues">
            <h4 className="sdat-issues-title">{t('pages.imports.protocol.issues')}</h4>
            {ordered.map((issue, index) => (
                <SdatIssueRow key={`${issue.code}-${index}`} issue={issue} />
            ))}
        </div>
    )
}

function SdatIssueRow({ issue }: { issue: SdatIssue }) {
    const { t } = useTranslation()
    const params = sdatIssueParams(issue)
    const summary = t(`pages.imports.issues.${issue.code}`, { defaultValue: t('pages.imports.issues.unknownCode', { code: issue.code }) })
    const message = typeof issue.detail_code === 'string'
        ? t(`pages.imports.issueDetails.${issue.detail_code}`, { defaultValue: summary })
        : summary
    return (
        <div className="page-stack sdat-issue">
            <div className="actions-row actions-row-wrap">
                {issue.severity === 'error' && <span className="error-text">{t('pages.imports.protocol.issueError')}</span>}
                <strong>{message}</strong>
            </div>
            {params.length > 0 && (
                <dl className="muted sdat-issue-params">
                    {params.map(({ key, value }) => (
                        <div key={key} className="sdat-issue-param">
                            <dt className="sdat-issue-param-label">{t(`pages.imports.protocol.issueParam.${key}`)}:</dt>
                            <dd className="sdat-issue-param-value">
                                {key === 'direction' ? t(`pages.imports.preview.${value === 'out' ? 'directionOut' : 'directionIn'}`)
                                    : key === 'meter_type' ? t(`pages.meteringPoints.meterTypes.${value}`, { defaultValue: value })
                                        : value}
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
        </div>
    )
}

/**
 * One import's protocol beside the history it was picked from (SPEC-2026-10-ui-patterns §5 row 2); picking another
 * import swaps the contents in place.
 */
export function ImportProtocolPane({ log, onClose, focusCorrections, correctionPeriod, titleRef }: {
    log: ImportLog
    onClose: () => void
    focusCorrections?: boolean
    correctionPeriod?: { from: string; to: string }
    /** The title is where focus lands when the pane is opened on purpose. */
    titleRef?: Ref<HTMLHeadingElement>
}) {
    const { t } = useTranslation()
    const { settings } = useAppSettings()

    function timestampTimezoneLabel(zone: ImportLog['timestamp_timezone']) {
        if (zone === 'Europe/Zurich') return t('pages.imports.wizard.timestampTimezoneZurich')
        if (zone === 'UTC') return t('pages.imports.wizard.timestampTimezoneUtc')
        return t('pages.imports.protocol.timestampTimezoneLegacy')
    }

    const columns = useMemo<ColumnDef<NonNullable<ImportLog['errors']>[number], unknown>[]>(
        () => [
            {
                accessorKey: 'row',
                header: t('pages.imports.protocol.row'),
                cell: (ctx) => ctx.row.original.row ?? t('pages.imports.protocol.general'),
            },
            {
                accessorKey: 'meter_id',
                header: t('pages.imports.protocol.meter'),
                cell: (ctx) => ctx.row.original.meter_id ?? '-',
            },
            {
                accessorKey: 'error',
                header: t('pages.imports.protocol.reason'),
            },
        ],
        [t],
    )

    const structured = isSdatLog(log)
    const outcome: SdatOutcomeKind = sdatOutcomeKind(log)
    const protection = importLogProtectionCode(log)
    const counts = log.result_counts
    const nonzeroCounts = structured && counts
        ? SDAT_COUNT_ORDER.filter((key) => (counts[key] ?? 0) !== 0)
        : []
    const delivery = log.source_delivery
    const hasDelivery = !!delivery && !!delivery.delivery_id

    return (
        <DetailPane
            tone="brand"
            title={t('pages.imports.protocol.title')}
            subtitle={[
                log.filename,
                log.zev_name || log.zev || '—',
                formatDateTime(log.created_at, settings),
                log.source === 'csv' || log.source === 'sdatch' ? t(`pages.imports.format.${log.source}`) : log.source,
            ].filter(Boolean).join(' · ')}
            onClose={onClose}
            titleRef={titleRef}
        >
            <div className="detail-pane-body page-stack plain-feedback import-protocol">
                {structured && (
                    <header>
                        <p className={outcome === 'rejected' ? 'error-text m-0' : 'm-0'}>
                            <strong>{t(`pages.imports.protocol.outcome.${outcome}`)}</strong>
                        </p>
                        <p className="muted m-0">{t(`pages.imports.protocol.outcome.${outcome}Description`)}</p>
                    </header>
                )}

                <CorrectionHistory key={log.id} log={log} focusOnLoad={focusCorrections} period={correctionPeriod} />

                {nonzeroCounts.length > 0 ? (
                    <section className="form-section">
                        <h4>{t('pages.imports.protocol.countsTitle')}</h4>
                        <dl className="sdat-counts">
                            {nonzeroCounts.map((key) => (
                                <div key={key} className="sdat-count-row">
                                    <dt>{t(`pages.imports.protocol.counts.${key}`)}</dt>
                                    <dd className="sdat-count-value">{counts?.[key]}</dd>
                                </div>
                            ))}
                        </dl>
                        {(counts?.promoted ?? 0) > 0 && (
                            <p className="muted">{t('pages.imports.protocol.promotedNote')}</p>
                        )}
                    </section>
                ) : !structured && (
                    <section className="form-section">
                        <h4>{t('pages.imports.protocol.countsTitle')}</h4>
                        <dl className="source-facts">
                            <DetailRow label={t('pages.imports.protocol.totalRows')}>{log.rows_total ?? '—'}</DetailRow>
                            <DetailRow label={t('pages.imports.protocol.importedRows')}>{log.rows_imported}</DetailRow>
                            <DetailRow label={t('pages.imports.protocol.skippedRows')}>{log.rows_skipped}</DetailRow>
                        </dl>
                    </section>
                )}
                <section className="form-section">
                    <h4>{t('pages.imports.protocol.technicalDetails')}</h4>
                    <dl className="source-facts">
                        <DetailRow label={t('pages.imports.protocol.importedBy')}>{log.imported_by_display || '—'}</DetailRow>
                        <DetailRow label={t('pages.imports.protocol.batchId')}>{log.batch_id || '—'}</DetailRow>
                        {log.source === 'csv' && (
                            <DetailRow label={t('pages.imports.protocol.timestampTimezone')}>{timestampTimezoneLabel(log.timestamp_timezone)}</DetailRow>
                        )}
                        {hasDelivery && (
                            <>
                                <DetailRow label={t('pages.imports.protocol.delivery.deliveryId')}>{delivery.delivery_id}</DetailRow>
                                {delivery.creation && (
                                    <DetailRow label={t('pages.imports.protocol.delivery.creation')}>{formatDateTime(delivery.creation, settings)}</DetailRow>
                                )}
                                {(delivery.status || delivery.reason) && (
                                    <DetailRow label={t('pages.imports.protocol.delivery.profile')}>{[delivery.status, delivery.reason].filter(Boolean).join(' · ')}</DetailRow>
                                )}
                                {(delivery.sender_id || delivery.receiver_id) && (
                                    <DetailRow label={t('pages.imports.protocol.delivery.parties')}>{[delivery.sender_id, delivery.receiver_id].filter(Boolean).join(' → ')}</DetailRow>
                                )}
                            </>
                        )}
                    </dl>
                </section>

                {structured ? (
                    <>
                        {(counts?.held ?? 0) > 0 && !!log.batch_id && (
                            <HeldReadingsPanel key={log.batch_id} importBatch={log.batch_id} />
                        )}
                        <SdatIssues issues={log.issues ?? []} />
                    </>
                ) : (
                    <>
                        {(log.warnings ?? []).length > 0 && (
                            <section className="form-section">
                                <h4>{t('pages.imports.protocol.warnings')}</h4>
                                {(log.warnings ?? []).map((entry, index) => (
                                    <p className="m-0" key={`warning-${index}`}>{entry.warning}</p>
                                ))}
                            </section>
                        )}
                        <section className="form-section">
                            <h4>{t('pages.imports.protocol.skippedReasons')}</h4>
                            <DataTable data={log.errors ?? []} columns={columns} emptyMessage={t('pages.imports.protocol.noSkippedDetails')} />
                        </section>
                    </>
                )}

                {protection === 'overwrite_import_protected' && (
                    <p className="warning-banner">{t('pages.imports.delete.overwriteProtected')}</p>
                )}
                {protection === 'quarantine_replace_protected' && (
                    <p className="warning-banner">{t('pages.imports.delete.quarantineProtected')}</p>
                )}
            </div>
        </DetailPane>
    )
}
