import type { ReactNode, Ref } from 'react'
import { SortableHeader, useTableSorting } from '../../components/tableSorting'
import { useTranslation } from 'react-i18next'
import { DetailPane } from '../../components/DetailPane'
import { formatDateTime, useAppSettings } from '../../lib/appSettings'
import { formatBytes, formatNumber } from '../../lib/numbers'
import type { BackupJob } from '../../types/api'
import { countMissingMedia, fileGone, readManifest, totalRecords, verificationState } from './backupHelpers'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(7rem, 11rem) 1fr', gap: '0.75rem' }}>
            <dt className="muted m-0">{label}</dt>
            <dd style={{ margin: 0, wordBreak: 'break-all' }}>{children}</dd>
        </div>
    )
}

/**
 * What a finished backup holds, read from the manifest it recorded — no archive is fetched. Beside the jobs it was
 * picked from (SPEC-2026-10-ui-patterns §5 row 2); picking another job swaps the contents in place.
 */
export function BackupJobPane({ job, actions, onClose, titleRef }: {
    job: BackupJob
    /** What can be done with the job's stored file. */
    actions: ReactNode
    onClose: () => void
    /** The title is where focus lands when the pane is opened on purpose. */
    titleRef?: Ref<HTMLHeadingElement>
}) {
    const { t } = useTranslation()
    const { settings } = useAppSettings()

    const manifest = readManifest(job)
    const sorting = useTableSorting(manifest?.zevs ?? [], {
        communities: row => row.name,
        records: row => Object.values(row.counts).reduce((sum, count) => sum + count, 0),
        invoicePdfs: row => row.media.files,
    })
    const missing = countMissingMedia(manifest)
    const scope = job.scope === 'zev' ? job.zev_name || t('pages.backups.jobs.scopeZev') : t('pages.backups.jobs.scopeInstance')

    return (
        <DetailPane
            tone="brand"
            title={t('pages.backups.details.title')}
            subtitle={`${scope} · ${formatDateTime(job.started_at ?? job.created_at, settings)}`}
            onClose={onClose}
            titleRef={titleRef}
        >
            <div className="detail-pane-body page-stack">
                {!fileGone(job) && <div className="actions-row actions-row-wrap">{actions}</div>}
                <dl className="page-stack m-0">
                    <Row label={t('pages.backups.details.archive')}>{job.archive_name || '—'}</Row>
                    <Row label={t('pages.backups.details.location')}>{job.archive_location || '—'}</Row>
                    <Row label={t('pages.backups.details.size')}>
                        {job.archive_bytes != null ? formatBytes(job.archive_bytes) : '—'}
                    </Row>
                    <Row label={t('pages.backups.details.checksum')}>
                        {job.archive_sha256 ? <code>{job.archive_sha256}</code> : '—'}
                    </Row>
                    <Row label={t('pages.backups.details.encryption')}>
                        {job.encrypted
                            ? t('pages.backups.details.encryptedWith', { fingerprint: job.encryption_key_fingerprint })
                            : t('pages.backups.details.notEncrypted')}
                    </Row>
                    <Row label={t('pages.backups.details.started')}>{formatDateTime(job.started_at, settings)}</Row>
                    <Row label={t('pages.backups.details.finished')}>{formatDateTime(job.completed_at, settings)}</Row>
                    {manifest && (
                        <Row label={t('pages.backups.details.records')}>{formatNumber(totalRecords(manifest))}</Row>
                    )}
                    <Row label={t('pages.backups.details.file')}>
                        {fileGone(job)
                            ? t(`pages.backups.jobs.fileGone.${job.artifact_deleted_reason || 'manual'}`)
                            : job.file_expires_at
                              ? t('pages.backups.jobs.expires', { date: formatDateTime(job.file_expires_at, settings) })
                              : t('pages.backups.details.fileKept')}
                    </Row>
                    {!fileGone(job) && (
                        <Row label={t('pages.backups.details.integrity')}>
                            {verificationState(job) === 'never'
                                ? t('pages.backups.jobs.verification.never')
                                : verificationState(job) === 'checking'
                                  ? t('pages.backups.jobs.verification.checking')
                                  : `${t(`pages.backups.jobs.verification.${verificationState(job)}`)} · ${formatDateTime(job.verified_at, settings)}${job.verification_message ? ` — ${job.verification_message}` : ''}`}
                        </Row>
                    )}
                </dl>

                {job.archive_location.startsWith('s3://') && (
                    <div className="info-banner">{t('pages.backups.details.objectStorage')}</div>
                )}
                {missing > 0 && (
                    <div className="warning-banner">{t('pages.backups.details.missingPdfs', { count: missing })}</div>
                )}

                {manifest && manifest.zevs.length > 0 && (
                    <div className="table-card">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <SortableHeader {...sorting.header('communities')}>{t('pages.backups.details.communities')}</SortableHeader>
                                    <SortableHeader {...sorting.header('records')}>{t('pages.backups.details.records')}</SortableHeader>
                                    <SortableHeader {...sorting.header('invoicePdfs')}>{t('pages.backups.details.invoicePdfs')}</SortableHeader>
                                </tr>
                            </thead>
                            <tbody>
                                {sorting.rows.map((zev) => (
                                    <tr key={zev.id}>
                                        <td>{zev.name}</td>
                                        <td>{formatNumber(Object.values(zev.counts).reduce((sum, n) => sum + n, 0))}</td>
                                        <td>{formatNumber(zev.media.files)} · {formatBytes(zev.media.bytes)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </DetailPane>
    )
}
