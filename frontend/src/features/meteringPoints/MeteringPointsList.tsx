import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  type IconDefinition,
  faChartLine,
  faChevronDown,
  faDatabase,
  faEllipsis,
  faHouse,
  faPen,
  faRightLeft,
  faSolarPanel,
  faTrash,
  faTriangleExclamation,
  faUserPlus,
} from '@fortawesome/free-solid-svg-icons'
import { Fragment, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ActionMenu, type ActionMenuItem } from '../../components/ActionMenu'
import { BehindMeterBadge } from '../../components/BehindMeterBadge'
import { Sparkline } from '../../components/Sparkline'
import { formatDateTime, formatShortDate } from '../../lib/appSettings'
import { todayBusinessIso } from '../../lib/dates'
import { formatKwh } from '../../lib/numbers'
import { METER_TYPE_OPTIONS } from '../../lib/options'
import { SupplementarySourceStatus } from './SupplementarySourceStatus'
import type { AppSettings, MeteringPoint, MeteringPointAssignment } from '../../types/api'
import {
  assignmentStateBadgeClass,
  assignmentStateSortOrder,
  getAssignmentState,
  type BuildingGroup,
  type MeteringPointHealth,
} from './useMeteringPointForms'

const METER_TYPE_ICONS: Record<MeteringPoint['meter_type'], IconDefinition> = {
  consumption: faHouse,
  production: faSolarPanel,
  bidirectional: faRightLeft,
}

type ConfirmOptions = {
  title: string
  message: string
  confirmText: string
  isDangerous: boolean
  onConfirm: () => void | Promise<void>
}

type MeteringPointsListProps = {
  meteringPoints: MeteringPoint[]
  assignmentsByMeteringPoint: Map<string, MeteringPointAssignment[]>
  participantNameById: Map<string, string>
  healthByMeteringPoint: Map<string, MeteringPointHealth>
  /** Empty for a role that has no assignment data loaded (see the hook) — never render a false positive from a missing entry. */
  holderLessByMeteringPoint: Map<string, boolean>
  /** Daily kWh over the health window per meter, `null` for a day without readings; drawn in the chart button. */
  dailySeriesByMeteringPoint?: Map<string, Array<number | null>>
  settings: AppSettings
  isManagedScope: boolean
  /** Several buildings: one sheet per building, each headed by `renderGroupHeader`. */
  groups?: BuildingGroup[] | null
  renderGroupHeader?: (group: BuildingGroup) => ReactNode
  /** Without groups: what heads the single sheet (a one-building ZEV's building). */
  header?: ReactNode
  buildingId?: string
  /** A viewer reads only (#761): no edit, assign, delete. */
  readOnly?: boolean
  canDeleteData: boolean
  deleteMeteringPointPending: boolean
  deleteAssignmentPending: boolean
  dialogLoading: boolean
  confirm: (options: ConfirmOptions) => void
  onOpenCreateAssignModal: (meteringPointId: string) => void
  onOpenEditMeteringPoint: (point: MeteringPoint) => void
  onOpenDeleteDataModal: (point: MeteringPoint) => void
  onOpenEditAssignment: (assignment: MeteringPointAssignment) => void
  onDeleteMeteringPoint: (id: string) => void
  onDeleteAssignment: (id: string) => void
}

/** Metering-point tables grouped by building, with expandable assignment history. */
export function MeteringPointsList({
  meteringPoints,
  assignmentsByMeteringPoint,
  participantNameById,
  healthByMeteringPoint,
  holderLessByMeteringPoint,
  dailySeriesByMeteringPoint,
  settings,
  isManagedScope,
  groups = null,
  renderGroupHeader,
  header,
  buildingId,
  readOnly = false,
  canDeleteData,
  deleteMeteringPointPending,
  deleteAssignmentPending,
  dialogLoading,
  confirm,
  onOpenCreateAssignModal,
  onOpenEditMeteringPoint,
  onOpenDeleteDataModal,
  onOpenEditAssignment,
  onDeleteMeteringPoint,
  onDeleteAssignment,
}: MeteringPointsListProps) {
  const { t } = useTranslation()
  const todayIso = todayBusinessIso()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const canManage = isManagedScope && !readOnly
  const columnCount = isManagedScope ? 4 : 3

  const toggleExpanded = (id: string) => setExpanded((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })

  const holderName = (assignment: MeteringPointAssignment) =>
    participantNameById.get(assignment.participant) ?? assignment.participant

  const confirmRemoveAssignment = (assignment: MeteringPointAssignment) =>
    confirm({
      title: t('pages.meteringPoints.removeAssignTitle'),
      message: t('pages.meteringPoints.removeAssignMessage', { name: holderName(assignment) }),
      confirmText: t('pages.meteringPoints.removeAssignConfirm'),
      isDangerous: true,
      onConfirm: () => onDeleteAssignment(assignment.id),
    })

  // Remove lives in the overflow menu everywhere, matching the meter-level
  // Edit/Delete pattern instead of a standalone danger button.
  function assignmentMenuItems(assignment: MeteringPointAssignment): ActionMenuItem[] {
    return [
      {
        key: 'remove',
        label: t('pages.meteringPoints.removeAssignment'),
        icon: <FontAwesomeIcon icon={faTrash} fixedWidth />,
        disabled: deleteAssignmentPending || dialogLoading,
        danger: true,
        onClick: () => confirmRemoveAssignment(assignment),
      },
    ]
  }

  function pointMenuItems(point: MeteringPoint, current: MeteringPointAssignment | undefined): ActionMenuItem[] {
    // With a holder the menu serves two subjects, so it names them; without
    // one, Assign is the row's visible button and the menu is the meter's alone.
    const meterSection = current ? t('pages.meteringPoints.columns.meteringPoint') : undefined
    const holderSection = t('pages.meteringPoints.columns.holder')
    const items: ActionMenuItem[] = current
      ? [
          {
            key: 'assign',
            label: t('pages.meteringPoints.assign'),
            icon: <FontAwesomeIcon icon={faUserPlus} fixedWidth />,
            section: holderSection,
            onClick: () => onOpenCreateAssignModal(point.id),
          },
          {
            key: 'edit-assignment',
            label: t('pages.meteringPoints.editAssignTitle'),
            icon: <FontAwesomeIcon icon={faPen} fixedWidth />,
            section: holderSection,
            onClick: () => onOpenEditAssignment(current),
          },
          {
            key: 'remove-assignment',
            label: t('pages.meteringPoints.removeAssignTitle'),
            icon: <FontAwesomeIcon icon={faTrash} fixedWidth />,
            section: holderSection,
            disabled: deleteAssignmentPending || dialogLoading,
            danger: true,
            onClick: () => confirmRemoveAssignment(current),
          },
        ]
      : []
    items.push({
      key: 'edit',
      label: t('common.edit'),
      icon: <FontAwesomeIcon icon={faPen} fixedWidth />,
      section: meterSection,
      onClick: () => onOpenEditMeteringPoint(point),
    })
    if (canDeleteData) {
      items.push({
        key: 'delete-data',
        label: t('pages.meteringPoints.deleteData.button'),
        icon: <FontAwesomeIcon icon={faDatabase} fixedWidth />,
        section: meterSection,
        onClick: () => onOpenDeleteDataModal(point),
      })
    }
    items.push({
      key: 'delete',
      label: t('common.delete'),
      icon: <FontAwesomeIcon icon={faTrash} fixedWidth />,
      section: meterSection,
      disabled: deleteMeteringPointPending || dialogLoading,
      danger: true,
      onClick: () =>
        confirm({
          title: t('pages.meteringPoints.deleteTitle'),
          message: t('pages.meteringPoints.deleteMessage', {
            meterId: point.meter_id,
            readingCount: point.reading_count,
            assignmentCount: point.assignment_count,
          }),
          confirmText: t('pages.meteringPoints.deleteConfirm'),
          isDangerous: true,
          onConfirm: () => onDeleteMeteringPoint(point.id),
        }),
    })
    return items
  }

  const renderRow = (point: MeteringPoint) => {
    const sortedAssignments = [...(assignmentsByMeteringPoint.get(point.id) ?? [])].sort((left, right) => {
      const stateDelta = assignmentStateSortOrder(getAssignmentState(left, todayIso))
        - assignmentStateSortOrder(getAssignmentState(right, todayIso))
      if (stateDelta !== 0) return stateDelta
      return right.valid_from.localeCompare(left.valid_from)
    })
    const current = sortedAssignments.find((assignment) => getAssignmentState(assignment, todayIso) === 'current')
    // Anything beyond the one holder the row already names opens beneath it.
    const hasHistory = sortedAssignments.length > (current ? 1 : 0)
    const isExpanded = hasHistory && expanded.has(point.id)
    const historyId = `metering-history-${point.id}`
    const health = healthByMeteringPoint.get(point.id) ?? 'no_data'
    const isHolderLess = holderLessByMeteringPoint.get(point.id) ?? false
    const typeLabel = t(`pages.meteringPoints.meterTypes.${point.meter_type}`)
    const series = dailySeriesByMeteringPoint?.get(point.id)
    const seriesValues = series?.filter((value): value is number => value !== null) ?? []
    const chartLabel = seriesValues.length > 1
      ? t('pages.meteringPoints.chartForTotal', {
          meterId: point.meter_id,
          kwh: formatKwh(seriesValues.reduce((sum, value) => sum + value, 0), { maxDecimals: 0 }),
          days: series!.length,
        })
      : t('pages.meteringPoints.chartFor', { meterId: point.meter_id })

    return (
      <Fragment key={point.id}>
        <tr role="row" className={`metering-row${point.is_active ? '' : ' is-inactive'}${isExpanded ? ' is-expanded' : ''}`}>
          <td role="cell" className="metering-row-point">
            <span className="metering-row-id">
              <span className="metering-row-name">
                <span className="metering-type-icon" title={typeLabel}>
                  <FontAwesomeIcon icon={METER_TYPE_ICONS[point.meter_type]} fixedWidth aria-hidden="true" />
                  <span className="visually-hidden">{typeLabel}</span>
                </span>
                <strong>{point.meter_id}</strong>
              </span>
              {!point.is_active && <span className="badge badge-neutral">{t('pages.meteringPoints.inactive')}</span>}
              {point.has_behind_meter_generation && <BehindMeterBadge />}
              {isManagedScope && <SupplementarySourceStatus point={point} canManage={!readOnly} confirm={confirm} />}
            </span>
            {point.location_description && <span className="metering-row-sub muted">{point.location_description}</span>}
          </td>
          {isManagedScope && (
            <td role="cell" className="metering-row-holder">
              {current ? (
                <>
                  <span className="metering-holder-name">
                    {holderName(current)}
                    {current.allocation_mode === 'community' && (
                      <span className="badge badge-tag" title={t('pages.meteringPoints.communityBadgeHint')}>{t('pages.meteringPoints.communityBadge')}</span>
                    )}
                  </span>
                  <span className="metering-row-sub muted">
                    {t('pages.meteringPoints.holderSince', { date: formatShortDate(current.valid_from, settings) })}
                  </span>
                </>
              ) : (
                <span className="metering-holder-none">
                  {isHolderLess && (
                    <span className="badge badge-danger" title={t('pages.meteringPoints.holderLessHint')}>
                      <FontAwesomeIcon icon={faTriangleExclamation} fixedWidth />
                      {t('pages.meteringPoints.holderLessBadge')}
                    </span>
                  )}
                  {canManage ? (
                    <button
                      className="button button-primary button-outline button-compact metering-assign-button"
                      type="button"
                      onClick={() => onOpenCreateAssignModal(point.id)}
                    >
                      <FontAwesomeIcon icon={faUserPlus} fixedWidth />
                      {t('pages.meteringPoints.assign')}
                    </button>
                  ) : !isHolderLess && (
                    <span className="muted">{t('pages.meteringPoints.noHolder')}</span>
                  )}
                </span>
              )}
              {hasHistory && (
                <button
                  type="button"
                  className="metering-history-toggle"
                  aria-expanded={isExpanded}
                  aria-controls={historyId}
                  onClick={() => toggleExpanded(point.id)}
                >
                  {t('pages.meteringPoints.assignmentsToggle', { count: sortedAssignments.length })}
                  <FontAwesomeIcon icon={faChevronDown} className="metering-history-chevron" />
                </button>
              )}
            </td>
          )}
          <td role="cell" className="metering-row-data">
            <Link
              className={`metering-health metering-health-${health}`}
              to={`/metering-data?metering_point=${point.id}&tab=quality`}
              title={point.last_reading_at ? `${t('pages.meteringPoints.health.linkHint')} · ${formatDateTime(point.last_reading_at, settings)}` : t('pages.meteringPoints.health.linkHint')}
            >
              <span className="metering-health-dot" aria-hidden="true" />
              {health === 'green' && point.last_reading_at ? (
                <>
                  <span className="visually-hidden">{t('pages.meteringPoints.health.green')}: </span>
                  {formatDateTime(point.last_reading_at, settings)}
                </>
              ) : (
                t(`pages.meteringPoints.health.${health}`)
              )}
            </Link>
          </td>
          <td role="cell" className="metering-row-actions">
            <div className="actions-row">
              <Link
                className="button button-secondary button-compact metering-chart-button"
                style={{ textDecoration: 'none' }}
                to={`/metering/chart?metering_point=${point.id}`}
                aria-label={chartLabel}
                title={chartLabel}
              >
                {seriesValues.length > 1 && series ? <Sparkline values={series} /> : <FontAwesomeIcon icon={faChartLine} fixedWidth />}
              </Link>
              {canManage && (
                <ActionMenu
                  label={t('pages.meteringPoints.moreActionsFor', { meterId: point.meter_id })}
                  icon={<FontAwesomeIcon icon={faEllipsis} fixedWidth />}
                  iconOnly
                  items={pointMenuItems(point, current)}
                />
              )}
            </div>
          </td>
        </tr>
        {isExpanded && (
          <tr role="row" className="metering-history-row" id={historyId}>
            <td role="cell" colSpan={columnCount} aria-colspan={columnCount}>
              <div className="metering-assignment-list">
                {sortedAssignments.map((assignment) => {
                  const assignmentState = getAssignmentState(assignment, todayIso)
                  return (
                    <div key={assignment.id} className="metering-assignment-row">
                      <div className="metering-assignment-main">
                        <div className="metering-assignment-line">
                          <strong>{holderName(assignment)}</strong>
                          <span className={assignmentStateBadgeClass(assignmentState)}>
                            {t(`pages.meteringPoints.assignmentState.${assignmentState}`)}
                          </span>
                          {assignment.allocation_mode === 'community' && (
                            <span className="badge badge-tag" title={t('pages.meteringPoints.communityBadgeHint')}>{t('pages.meteringPoints.communityBadge')}</span>
                          )}
                        </div>
                        <div className="muted">
                          {formatShortDate(assignment.valid_from, settings)} –{' '}
                          {assignment.valid_to ? formatShortDate(assignment.valid_to, settings) : t('pages.meteringPoints.openEnded')}
                        </div>
                      </div>
                      {canManage && (
                        <div className="metering-assignment-actions">
                          <button
                            className="button button-secondary button-compact"
                            type="button"
                            onClick={() => onOpenEditAssignment(assignment)}
                          >
                            <FontAwesomeIcon icon={faPen} fixedWidth />
                            {t('common.edit')}
                          </button>
                          <ActionMenu
                            label={t('pages.meteringPoints.assignmentActionsFor', { name: holderName(assignment) })}
                            icon={<FontAwesomeIcon icon={faEllipsis} fixedWidth />}
                            iconOnly
                            items={assignmentMenuItems(assignment)}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  const renderTable = (points: MeteringPoint[], buildingId?: string) => (
    <table className="metering-rows" role="table" aria-labelledby={buildingId ? `metering-building-${buildingId}` : undefined} aria-label={buildingId ? undefined : t('pages.meteringPoints.title')}>
      <thead role="rowgroup">
        <tr role="row">
          <th role="columnheader" scope="col">{t('pages.meteringPoints.columns.meteringPoint')}</th>
          {isManagedScope && <th role="columnheader" scope="col">{t('pages.meteringPoints.columns.holder')}</th>}
          <th role="columnheader" scope="col" className="metering-col-data">{t('pages.meteringPoints.columns.data')}</th>
          <th role="columnheader" scope="col" className="metering-col-actions">
            <span className="visually-hidden">{t('pages.meteringPoints.columns.actions')}</span>
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">{points.map(renderRow)}</tbody>
    </table>
  )

  // Names the type icons of the meters on show, once under all sheets.
  const shownTypes = METER_TYPE_OPTIONS.filter((option) => meteringPoints.some((point) => point.meter_type === option.value))
  const legend = shownTypes.length > 0 && (
    <ul className="metering-type-legend" aria-label={t('pages.meteringPoints.filters.type')}>
      {shownTypes.map((option) => (
        <li key={option.value}>
          <FontAwesomeIcon icon={METER_TYPE_ICONS[option.value]} fixedWidth aria-hidden="true" />
          {t(option.labelKey)}
        </li>
      ))}
    </ul>
  )

  if (groups) {
    return (
      <>
        <div className="building-groups">
          {groups.map((group) => (
            <section key={group.building.id} className="table-card metering-sheet">
              {renderGroupHeader?.(group)}
              {group.points.length === 0 ? (
                <p className="muted building-group-empty">{t('pages.meteringPoints.buildings.emptyGroup')}</p>
              ) : (
                renderTable(group.points, renderGroupHeader ? group.building.id : undefined)
              )}
            </section>
          ))}
        </div>
        {legend}
      </>
    )
  }

  return (
    <>
      <div className="table-card metering-sheet">
        {header}
        {renderTable(meteringPoints, buildingId)}
      </div>
      {legend}
    </>
  )
}
