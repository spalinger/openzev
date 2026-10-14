import type { BatchFileOutcome } from '../../lib/api/metering'
import type { ImportLog, SdatIssue } from '../../types/api'

/** File picker filter for SDAT-CH deliveries: plain XML or gzipped XML. */
export const SDAT_UPLOAD_ACCEPT = '.xml,.xml.gz,.gz'

export type DeletionProtection = 'overwrite_import_protected' | 'quarantine_replace_protected'

/**
 * Client-side mirror of the backend deletion guard
 * (`backend/metering/deletion.py::protection_code`): an import is protected
 * when it replaced prior billable values (`rows_overwritten`) or prior held
 * (quarantine) values (`result_counts.quarantine_overwritten`). The server
 * stays authoritative — this only gates the UI before dispatch and explains
 * the protection with the matching copy.
 */
export function importLogProtectionCode(
    log: Pick<ImportLog, 'rows_overwritten' | 'result_counts' | 'deletable' | 'deletion_protection_code'>,
): DeletionProtection | null {
    if (log.deletion_protection_code) return log.deletion_protection_code
    // The server always sends a code together with `deletable: false`; the
    // fallback below only covers payloads that predate those fields.
    if (log.deletable === false) return 'overwrite_import_protected'
    if ((log.rows_overwritten ?? 0) > 0) return 'overwrite_import_protected'
    const held = log.result_counts?.quarantine_overwritten
    if (typeof held === 'number' && held !== 0) return 'quarantine_replace_protected'
    return null
}

export function isImportLogDeletable(
    log: Pick<ImportLog, 'rows_overwritten' | 'result_counts' | 'deletable' | 'deletion_protection_code'>,
): boolean {
    return importLogProtectionCode(log) === null
}

/** Whether the log carries the structured SDAT-CH outcome (blank for CSV/manual). */
export function isSdatLog(log: Pick<ImportLog, 'result_status'>): boolean {
    return !!log.result_status
}

/**
 * Machine-readable outcome of an SDAT-CH file, derived from `result_status`
 * and `result_counts` only — never from English warning prose.
 *
 * - `rejected`: the file wrote no observations (atomic rejection).
 * - `held`: only quarantine (non-billable) observations were written.
 * - `unchanged`: valid file, nothing changed (replay/duplicate/stale).
 * - `correctionOnly`: billable writes committed, but only overwrites — a
 *   successful correction with zero new billable rows.
 * - `accepted`: billable writes committed, including new rows.
 * - `legacy`: CSV/manual or pre-structured logs without the new metadata.
 */
export type SdatOutcomeKind = 'rejected' | 'held' | 'unchanged' | 'correctionOnly' | 'accepted' | 'legacy'

export function sdatOutcomeKind(
    log: Pick<ImportLog, 'result_status' | 'result_counts'>,
): SdatOutcomeKind {
    const status = log.result_status
    if (!status) return 'legacy'
    if (status !== 'accepted') return status
    const counts = log.result_counts
    if (counts && (counts.created ?? 0) === 0 && (counts.overwritten ?? 0) > 0) return 'correctionOnly'
    return 'accepted'
}

/**
 * Whether a batch outcome counts as failed for retry selection. A rejected
 * SDAT-CH file arrives as HTTP 201 with a persisted log
 * (`result_status: rejected`) — not as a thrown error — but semantically it
 * failed just like a 413/429, so it stays selected while successful files
 * are cleared.
 */
export function isFailedBatchOutcome(outcome: BatchFileOutcome<ImportLog>): boolean {
    if (outcome.value === null) return true
    return outcome.value.result_status === 'rejected'
}

/** Ordered observation accounting for the protocol: promotion is a subset of
 * created/overwritten, never added on top (spec §4.2). */
export const SDAT_COUNT_ORDER = [
    'created',
    'overwritten',
    'held',
    'promoted',
    'duplicate',
    'stale',
    'excluded',
    'rejected',
    'quarantine_overwritten',
] as const

/** Structured issue params rendered as resolution details, in display order.
 * Values come from stable backend fields — never parsed from prose. */
export const SDAT_ISSUE_PARAM_ORDER = [
    'meter_id',
    'block_id',
    'position',
    'missing',
    'position_timestamp',
    'direction',
    'incoming_document_id',
    'stored_document_id',
    'incoming_delivery_id',
    'stored_delivery_id',
    'product',
    'unit',
    'condition',
    'reason',
    'resolution',
    'document_id',
    'delivery_id',
    'creation',
] as const

export type SdatIssueParamKey = typeof SDAT_ISSUE_PARAM_ORDER[number]

/** Renderable (key, value) pairs of an issue's structured params. Arrays
 * (e.g. `missing` positions) are shortened; anything unlisted stays in the
 * backend message detail only. */
export function sdatIssueParams(issue: SdatIssue): Array<{ key: SdatIssueParamKey; value: string }> {
    const params: Array<{ key: SdatIssueParamKey; value: string }> = []
    for (const key of SDAT_ISSUE_PARAM_ORDER) {
        const raw = issue[key]
        if (raw === null || raw === undefined || raw === '') continue
        if (Array.isArray(raw)) {
            if (raw.length === 0) continue
            const shown = raw.slice(0, 10).map((entry) => String(entry)).join(', ')
            params.push({ key, value: raw.length > 10 ? `${shown} (+${raw.length - 10})` : shown })
        } else if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
            params.push({ key, value: String(raw) })
        }
    }
    return params
}
