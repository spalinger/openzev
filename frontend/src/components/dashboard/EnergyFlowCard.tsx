import { useTranslation } from 'react-i18next'
import { EnergyFlowChart } from '../EnergyFlowChart'
import type { ZevOwnerDashboardSummary } from '../../types/api'

interface EnergyFlowCardProps {
    totals: ZevOwnerDashboardSummary['zev_totals']
    participantStats: ZevOwnerDashboardSummary['participant_stats']
    highlightParticipantId?: string
    zevName?: string
}

export function EnergyFlowCard({ totals, participantStats, highlightParticipantId, zevName }: EnergyFlowCardProps) {
    const { t } = useTranslation()
    if (participantStats.length === 0) return null
    return (
        <section className="card">
            <h3 style={{ marginTop: 0 }}>
                {t('pages.dashboard.energyFlow.title')}
                {zevName ? ` — ${zevName}` : ''}
            </h3>
            <EnergyFlowChart totals={totals} participantStats={participantStats} highlightParticipantId={highlightParticipantId} />
        </section>
    )
}
