import { useTranslation } from 'react-i18next'

export type ParticipantCredentialsNoticeData = {
  participantName: string
  username: string
  password: string
  message: string
}

type ParticipantCredentialsNoticeProps = {
  notice: ParticipantCredentialsNoticeData
  onDismiss: () => void
}

export function ParticipantCredentialsNotice({ notice, onDismiss }: ParticipantCredentialsNoticeProps) {
  const { t } = useTranslation()

  return (
    <section className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>{t('pages.participants.credentialsTitle')}</h3>
          <p className="muted" style={{ marginTop: 0 }}>{notice.message}</p>
          <p style={{ marginBottom: '0.35rem' }}><strong>{notice.participantName}</strong></p>
          <p style={{ margin: '0.2rem 0' }}>{t('pages.participants.usernameLabel')} <strong>{notice.username}</strong></p>
          <p style={{ margin: '0.2rem 0' }}>{t('pages.participants.passwordLabel')} <strong>{notice.password}</strong></p>
        </div>
        <button className="button button-secondary" type="button" onClick={onDismiss}>
          {t('pages.participants.dismiss')}
        </button>
      </div>
    </section>
  )
}
