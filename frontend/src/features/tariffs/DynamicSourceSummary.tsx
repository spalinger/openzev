import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRight, faCheck } from '@fortawesome/free-solid-svg-icons'
import { useTranslation } from 'react-i18next'
import { formatDateTime } from '../../lib/appSettings'
import type { AppSettings, DynamicTariffSource } from '../../types/api'
import { TariffDisclosure } from './TariffDisclosure'

/**
 * Shared-source facts beside the linked tariff: which source and whether it is
 * delivering, up front; where it is fetched from and what it covers, on
 * demand. Maintenance stays in the platform hub, which only an admin can open.
 */
export function DynamicSourceSummary({ source, settings, canOperate }: {
    source: DynamicTariffSource
    settings: AppSettings
    canOperate: boolean
}) {
    const { t } = useTranslation()
    return (
        <div className="tariff-source-summary">
            <strong className="tariff-source-name">{source.label}</strong>
            <div className="tariff-source-statuses">
                <span className={`tariff-source-status ${source.last_fetch_status === 'failed' ? 'text-error' : 'muted'}`} data-status={source.last_fetch_status}>
                    {source.last_fetch_status === 'ok' && <FontAwesomeIcon icon={faCheck} fixedWidth />}
                    <span>
                        {t(`pages.dynamicSources.status.${source.last_fetch_status}`)}
                        {source.last_fetch_status === 'ok' && source.last_success_at && <>{' · '}{formatDateTime(source.last_success_at, settings)}</>}
                    </span>
                </span>
                {!source.enabled && <span className="muted">{t('pages.dynamicSources.details.automaticDisabled')}</span>}
            </div>
            {source.last_success_at && source.last_fetch_status !== 'ok' && (
                <p className="muted" style={{ margin: 0 }}>{t('pages.dynamicSources.lastSuccess', { time: formatDateTime(source.last_success_at, settings) })}</p>
            )}
            {source.last_fetch_status === 'failed' && source.last_fetch_error && <p className="text-error" style={{ margin: 0 }}>{source.last_fetch_error}</p>}
            <TariffDisclosure summary={t('pages.dynamicSources.sourceDetails')}>
                <div className="tariff-source-summary">
                    <dl className="tariff-source-facts">
                        <div className="tariff-source-fact-wide">
                            <dt>{t('pages.dynamicSources.form.url')}</dt>
                            <dd className="tariff-source-address">{source.url}</dd>
                        </div>
                        <div>
                            <dt>{t('pages.dynamicSources.form.apiVersion')}</dt>
                            <dd>{t(`pages.dynamicSources.versions.${source.api_version}`)}</dd>
                        </div>
                        <div>
                            <dt>{t('pages.dynamicSources.form.tariffType')}</dt>
                            <dd>{t(`pages.dynamicSources.types.${source.tariff_type}`)}</dd>
                        </div>
                        {source.tariff_name && (
                            <div className="tariff-source-fact-wide">
                                <dt>{t('pages.dynamicSources.form.tariffName')}</dt>
                                <dd>{source.tariff_name}</dd>
                            </div>
                        )}
                        <div>
                            <dt>{t('pages.dynamicSources.details.storedPrices')}</dt>
                            <dd>{source.point_count > 0 ? source.point_count : t('pages.dynamicSources.noCoverage')}</dd>
                        </div>
                        <div>
                            <dt>{t('pages.dynamicSources.columns.reuse')}</dt>
                            <dd>
                                {t('pages.dynamicSources.details.tariffs', { count: source.linked_tariff_count })}
                                {' · '}{t('pages.dynamicSources.details.zevs', { count: source.linked_zev_count })}
                            </dd>
                        </div>
                        {source.point_count > 0 && (
                            <div className="tariff-source-fact-wide">
                                <dt>{t('pages.dynamicSources.details.coverage')}</dt>
                                <dd>
                                    {formatDateTime(source.covers_from, settings)}{' – '}{formatDateTime(source.covers_to, settings)}
                                    <p className="muted tariff-source-hint">{t('pages.dynamicSources.coverageHint')}</p>
                                </dd>
                            </div>
                        )}
                    </dl>
                    {canOperate && (
                        <Link to={`/admin/dynamic-sources?source=${encodeURIComponent(source.id)}`}>
                            {t('pages.dynamicSources.manageSource')}{' '}<FontAwesomeIcon icon={faArrowRight} fixedWidth aria-hidden="true" />
                        </Link>
                    )}
                </div>
            </TariffDisclosure>
        </div>
    )
}
