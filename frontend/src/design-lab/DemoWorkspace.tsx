import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LabIcon } from './LabIcon'
import { availableScreens, blankScreens, communities, communityInvoices, dailyConsumption, dailyProduction, formatNumber, invoicesFor, mayManage, navigationGroups, nextStatus, normalizeScope, participant, statusIds } from './mockData'
import type { DemoInvoice, DemoRole, DesignId, InvoiceStatus, NavigationGroup, Screen } from './mockData'

type Navigate = (screen: Screen, filter?: InvoiceStatus) => void
type InvoiceAction = (invoice: DemoInvoice) => void

function Brand() {
  return <span className="demo-brand"><span className="demo-brand-mark" aria-hidden="true" />OpenZEV</span>
}

function Status({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation()
  return <span className={`demo-status status-${status}`}>{t(`status.${status}`)}</span>
}

function Button({ children, onClick, secondary = false }: { children: ReactNode; onClick: () => void; secondary?: boolean }) {
  return <button type="button" className={`demo-button ${secondary ? 'demo-button-secondary' : ''}`} onClick={onClick}>{children}</button>
}

function Metrics({ items, financial = false }: { items: { label: string; value: string; unit?: string }[]; financial?: boolean }) {
  return <dl className={`demo-metrics ${financial ? 'metrics-financial' : ''}`}>{items.map((item) => <div className="demo-metric" key={item.label}><dt>{item.label}</dt><dd>{item.value}<small>{item.unit}</small></dd></div>)}</dl>
}

function EnergyChart({ design, consumptionTotal, productionTotal, personal = false }: { design: DesignId; consumptionTotal: number; productionTotal: number; personal?: boolean }) {
  const { t, i18n } = useTranslation()
  const [weekly, setWeekly] = useState(false)
  const normalize = (series: number[], total: number) => series.map((v) => v / series.reduce((sum, n) => sum + n, 0) * total)
  const aggregate = (series: number[]) => weekly ? Array.from({ length: Math.ceil(series.length / 7) }, (_, i) => series.slice(i * 7, i * 7 + 7).reduce((sum, v) => sum + v, 0)) : series
  const consumption = aggregate(normalize(dailyConsumption, consumptionTotal))
  const production = aggregate(normalize(dailyProduction, productionTotal))
  const maxValue = Math.max(...consumption, ...production)
  const max = Math.ceil(maxValue / (maxValue > 300 ? 100 : 10)) * (maxValue > 300 ? 100 : 10)
  const points = (series: number[]): [number, number][] => series.map((v, i) => [52 + i * (690 / (series.length - 1)), 220 - v / max * 185])
  const line = (series: number[]) => points(series).map(([x, y], i) => `${i ? 'L' : 'M'} ${x},${y}`).join(' ')
  const bars = design === 'control' || design === 'night'
  return <section className="demo-card demo-chart-card">
    <div className="demo-card-header"><h2>{t(personal ? 'personal.consumption' : 'energy.title')}</h2><div className="demo-segment" role="group" aria-label={t('energy.aggregation')}><button type="button" aria-pressed={!weekly} onClick={() => setWeekly(false)}>{t('energy.day')}</button><button type="button" aria-pressed={weekly} onClick={() => setWeekly(true)}>{t('energy.week')}</button></div></div>
    <div className="chart-legend"><span><i className="legend-consumption" />{t('energy.consumption')}</span><span><i className="legend-production" />{t(personal ? 'energy.local' : 'energy.production')}</span><span className="chart-unit">kWh</span></div>
    <svg className="demo-energy-chart" viewBox="0 0 760 265" role="img" aria-label={t(personal ? 'personal.chartLabel' : 'energy.chartLabel')}>
      {[0, 1, 2, 3, 4].map((n) => <g key={n}><line className="chart-gridline" x1="52" x2="742" y1={220 - n * 46} y2={220 - n * 46} /><text className="chart-label" x="40" y={224 - n * 46} textAnchor="end">{formatNumber(Math.round(n * max / 4), i18n.language)}</text></g>)}
      {bars ? points(consumption).map(([x, y], i) => <rect className="chart-bar" key={i} x={x - (weekly ? 26 : 5)} y={y} width={weekly ? 52 : 10} height={220 - y} />) : <path className="chart-consumption-line" d={line(consumption)} />}
      <path className="chart-production-line" d={line(production)} />
      {(weekly ? [0, 1, 2, 3, 4] : [0, 5, 11, 17, 23, 29]).map((n) => <text className="chart-label" x={52 + n * 690 / (consumption.length - 1)} y="249" textAnchor="middle" key={n}>{weekly ? `${n * 7 + 1}–${Math.min(n * 7 + 7, 30)}` : n + 1}</text>)}
    </svg>
  </section>
}

function Readiness({ missing, people, navigate }: { missing: number; people: number; navigate: Navigate }) {
  const { t } = useTranslation()
  const items: { label: string; value: string; screen: Screen; warning?: boolean }[] = [
    { label: t('readiness.readings'), value: t('readiness.readingCount', { count: people - missing, total: people }), screen: 'energy', warning: missing > 0 },
    { label: t('readiness.assignments'), value: t('readiness.assigned', { count: people }), screen: 'participants' },
    { label: t('readiness.tariffs'), value: t('readiness.set'), screen: 'settings' },
    { label: t('readiness.paymentAccount'), value: t('readiness.set'), screen: 'settings' },
  ]
  return <section className="demo-card readiness-card"><div className="demo-card-header"><h2>{t('readiness.title')}</h2></div><dl className="readiness-list">{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd><button type="button" className={item.warning ? 'readiness-warning' : ''} onClick={() => navigate(item.screen)}>{item.value}<LabIcon name="right" /></button></dd></div>)}</dl></section>
}

function PendingWork({ invoices, navigate }: { invoices: DemoInvoice[]; navigate: Navigate }) {
  const { t } = useTranslation()
  return <section className="demo-card pending-work"><div className="demo-card-header"><h2>{t('billing.attention')}</h2></div>{(['draft', 'approved', 'sent'] as const).map((status) => {
    const count = invoices.filter((invoice) => invoice.status === status).length
    if (!count) return null
    return <button type="button" className="pending-row" key={status} onClick={() => navigate('invoices', status)}><span>{t(`billing.${status === 'draft' ? 'review' : status === 'approved' ? 'send' : 'pending'}`, { count })}</span><LabIcon name="right" /></button>
  })}{invoices.every((invoice) => invoice.status === 'paid') && <p className="demo-empty-inline">{t('billing.done')}</p>}</section>
}

function PeriodWork({ invoices, missing, navigate }: { invoices: DemoInvoice[]; missing: number; navigate: Navigate }) {
  const { t, i18n } = useTranslation()
  const draftCount = invoices.filter((invoice) => invoice.status === 'draft').length
  const paidCount = invoices.filter((invoice) => invoice.status === 'paid').length
  const total = invoices.reduce((sum, invoice) => sum + invoice.amount, 0)
  return <section className="demo-card period-work"><div className="demo-card-header"><h2>{t('periods.title')}</h2></div>
    <div className="period-current"><div><strong>{t('periods.dates')}</strong><span>{t('periods.monthly')}</span></div><dl><div><dt>{t('readiness.readings')}</dt><dd className={missing ? 'readiness-warning' : ''}>{missing ? t('readiness.missing', { count: missing }) : t('energy.quality')}</dd></div><div><dt>{t('nav.invoices')}</dt><dd>{t('periods.invoiceCount', { count: invoices.length })}{draftCount > 0 && <span> · {t('periods.drafts', { count: draftCount })}</span>}</dd></div><div><dt>{t('billing.paid')}</dt><dd>{paidCount} / {invoices.length}</dd></div></dl><Button onClick={() => navigate(missing ? 'energy' : 'invoices')}>{t(missing ? 'readiness.checkData' : 'common.review')}</Button></div>
    <details className="period-history"><summary>{t('periods.history')}</summary><div className="demo-table-scroll"><table className="demo-table"><thead><tr><th>{t('invoice.period')}</th><th>{t('fields.status')}</th><th className="numeric">CHF</th></tr></thead><tbody>{(['august', 'july'] as const).map((month, index) => <tr key={month}><td>{t(`months.${month}`)}</td><td>{t('periods.closed')}</td><td className="numeric">{formatNumber(total * (index ? 1.04 : 0.96), i18n.language, 2)}</td></tr>)}</tbody></table></div></details>
  </section>
}

function InvoiceTable({ invoices, openInvoice, updateInvoice, personal = false, platform = false, selected, toggleSelected, allSelected, toggleAll, eligible }: {
  invoices: DemoInvoice[]; openInvoice: InvoiceAction; updateInvoice?: InvoiceAction; personal?: boolean; platform?: boolean;
  selected?: string[]; toggleSelected?: (id: string) => void; allSelected?: boolean; toggleAll?: () => void; eligible?: (invoice: DemoInvoice) => boolean;
}) {
  const { t, i18n } = useTranslation()
  return <div className="demo-table-scroll"><table className={`demo-table ${personal ? 'table-personal' : ''}`}><thead><tr>
    {toggleAll && <th className="checkbox-cell"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t('billing.selectAll')} /></th>}
    {platform && <th>{t('nav.community')}</th>}<th>{t(personal ? 'invoice.period' : 'fields.participant')}</th><th>{t('fields.invoice')}</th><th>{t('fields.status')}</th><th className="numeric">{t('fields.amount')}</th><th className="numeric"><span className="lab-sr-only">{t('fields.action')}</span></th></tr></thead>
    <tbody>{invoices.map((invoice) => <tr key={invoice.id} className={selected?.includes(invoice.id) ? 'row-selected' : ''}>
      {toggleSelected && <td className="checkbox-cell">{eligible?.(invoice) && <input type="checkbox" checked={selected?.includes(invoice.id) ?? false} onChange={() => toggleSelected(invoice.id)} aria-label={t('billing.select', { id: invoice.id })} />}</td>}
      {platform && <td>{communities.find((community) => community.id === invoice.communityId)?.name}</td>}
      <td>{personal ? t(`months.${invoice.period ?? 'september'}`) : <button type="button" className="invoice-person" onClick={() => openInvoice(invoice)}>{invoice.name}</button>}</td>
      <td><button type="button" className="invoice-code" onClick={() => openInvoice(invoice)}>{invoice.id}</button></td><td><Status status={invoice.status} /></td><td className="numeric invoice-amount">{formatNumber(invoice.amount, i18n.language, 2)}</td>
      <td className="numeric"><div className="table-actions">{updateInvoice && eligible?.(invoice) ? <button type="button" className="demo-small-button" onClick={() => updateInvoice(invoice)}>{t('billing.approve')}</button> : <button type="button" className="demo-text-button" onClick={() => openInvoice(invoice)} aria-label={`${t('common.details')} · ${invoice.id}`}>{t('common.details')}</button>}</div></td>
    </tr>)}</tbody></table></div>
}

function InvoiceDocument({ invoice, updateInvoice, blocked = false }: { invoice: DemoInvoice; updateInvoice?: InvoiceAction; blocked?: boolean }) {
  const { t, i18n } = useTranslation()
  const community = communities.find((item) => item.id === invoice.communityId) ?? communities[0]
  const action = { draft: 'approve', approved: 'send', sent: 'markPaid', paid: undefined }[invoice.status]
  const fee = 12
  const localAmount = Math.round((invoice.amount - fee) * 0.44 * 100) / 100
  const gridAmount = invoice.amount - fee - localAmount
  const localKwh = Math.round(invoice.kwh * 0.617)
  const lines = [{ label: 'local', quantity: localKwh, amount: localAmount }, { label: 'grid', quantity: invoice.kwh - localKwh, amount: gridAmount }, { label: 'fee', quantity: 1, amount: fee }]
  const suffix = invoice.id.lastIndexOf('-') + 1
  return <div className="demo-invoice-detail"><article className="demo-paper">
    <header className="paper-header"><div><div className="paper-brand"><span aria-hidden="true" />{community.name}</div><p>{community.manager}<br />{community.address}<br />{community.postalCode} {community.city}</p></div><div><span className="paper-label">{t('invoice.document')}</span><div className="paper-number">{invoice.id.slice(0, suffix)}<strong>{invoice.id.slice(suffix)}</strong></div><Status status={invoice.status} /></div></header>
    <div className="paper-summary"><div className="paper-recipient"><span className="paper-label">{t('invoice.recipient')}</span><strong>{invoice.name}</strong><span>{t('fields.unit')} {invoice.unit}</span><span>{invoice.email}</span></div><dl className="paper-facts"><div><dt>{t('invoice.period')}</dt><dd>{t(`months.${invoice.period ?? 'september'}`)}</dd></div><div><dt>{t('invoice.due')}</dt><dd>{t(`dueDates.${invoice.period ?? 'september'}`)}</dd></div></dl></div>
    <table className="paper-lines"><thead><tr><th>{t('fields.description')}</th><th className="numeric">{t('fields.quantity')}</th><th className="numeric">CHF</th></tr></thead><tbody>{lines.map((line) => <tr key={line.label}><td>{t(`invoice.${line.label}`)}</td><td className="numeric">{formatNumber(line.quantity, i18n.language)}{line.label !== 'fee' && ' kWh'}</td><td className="numeric">{formatNumber(line.amount, i18n.language, 2)}</td></tr>)}</tbody></table>
    <div className="paper-total"><span>{t('invoice.total')}</span><strong><small>CHF</small> {formatNumber(invoice.amount, i18n.language, 2)}</strong></div>
    <p className="paper-note">{t('invoice.note')}</p>
  </article>{updateInvoice && action && !(invoice.status === 'draft' && blocked) && <Button onClick={() => updateInvoice(invoice)}>{t(`billing.${action}`)}</Button>}</div>
}

function ParticipantsScreen({ people, openPerson }: { people: DemoInvoice[]; openPerson: InvoiceAction }) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const visible = people.filter((person) => `${person.name} ${person.email} ${person.unit}`.toLowerCase().includes(search.toLowerCase()))
  return <section className="demo-card"><div className="demo-list-toolbar"><label className="demo-search"><LabIcon name="search" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('participants.search')} aria-label={t('participants.search')} /></label><span>{t('common.count', { count: visible.length })}</span></div><div className="demo-table-scroll"><table className="demo-table participant-table"><thead><tr><th>{t('fields.participant')}</th><th>{t('fields.unit')}</th><th>{t('fields.role')}</th><th>{t('participants.meter')}</th><th>{t('participants.access')}</th></tr></thead><tbody>{visible.map((person) => <tr key={person.id}><td><button type="button" className="invoice-person" onClick={() => openPerson(person)}><strong>{person.name}</strong><small>{person.email}</small></button></td><td>{person.unit}</td><td>{t(`participants.${person.producer ? 'producer' : 'consumer'}`)}</td><td>CH-101-{person.unit}</td><td>{t('participants.active')}</td></tr>)}</tbody></table>{!visible.length && <p className="demo-empty-inline">{t('common.noResults')}</p>}</div></section>
}

function Profile({ person, onSave }: { person: DemoInvoice; onSave?: InvoiceAction }) {
  const { t } = useTranslation()
  const [name, setName] = useState(person.name)
  const [email, setEmail] = useState(person.email)
  return <section className="profile-details"><h2>{person.name}</h2>{onSave ? <form className="profile-form" onSubmit={(event) => { event.preventDefault(); onSave({ ...person, name: name.trim(), email: email.trim() }) }}><label>{t('fields.name')}<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>{t('fields.email')}<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><button type="submit" className="demo-button">{t('setup.save')}</button></form> : <p className="profile-email">{person.email}</p>}<dl><div><dt>{t('nav.community')}</dt><dd>{communities.find((community) => community.id === person.communityId)?.name}</dd></div><div><dt>{t('fields.unit')}</dt><dd>{person.unit}</dd></div><div><dt>{t('participants.meter')}</dt><dd>CH-101-{person.unit}</dd></div><div><dt>{t('fields.role')}</dt><dd>{t(`participants.${person.producer ? 'producer' : 'consumer'}`)}</dd></div></dl></section>
}

function CommunitiesTable({ invoices, onOpen }: { invoices: DemoInvoice[]; onOpen?: (id: string) => void }) {
  const { t } = useTranslation()
  return <section className="demo-card"><div className="demo-card-header"><h2>{t('nav.communities')}</h2></div><div className="demo-table-scroll"><table className="demo-table communities-table"><thead><tr><th>{t('nav.community')}</th><th>{t('admin.manager')}</th><th className="numeric">{t('nav.participants')}</th><th>{t('readiness.title')}</th><th>{t('nav.invoices')}</th><th /></tr></thead><tbody>{communities.map((community) => {
    const rows = invoices.filter((invoice) => invoice.communityId === community.id)
    const draftCount = rows.filter((invoice) => invoice.status === 'draft').length
    return <tr key={community.id}><td><strong>{community.name}</strong><small className="table-subtext">{community.city}</small></td><td>{community.manager}</td><td className="numeric">{rows.length}</td><td className={community.missing ? 'readiness-warning' : ''}>{community.missing ? t('readiness.missing', { count: community.missing }) : t('energy.quality')}</td><td>{draftCount ? t('periods.drafts', { count: draftCount }) : t('periods.issued')}</td><td><button type="button" className="demo-small-button" onClick={() => onOpen?.(community.id)}>{t('admin.manage')}</button></td></tr>
  })}</tbody></table></div></section>
}

function AccountsScreen() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [opened, setOpened] = useState<string>()
  const rows = [
    { name: 'Julia Müller', email: 'julia.mueller@example.com', access: 'roles.owner', scope: 'Sonnenhof, Limmatblick' },
    { name: 'Daniel Frei', email: 'daniel.frei@example.com', access: 'roles.owner', scope: 'Bergacker' },
    { name: 'Alex Schärer', email: 'alex.schaerer@example.com', access: 'roles.admin', scope: t('admin.platform') },
    ...communityInvoices.map((person) => ({ name: person.name, email: person.email, access: 'roles.participant', scope: communities.find((community) => community.id === person.communityId)!.name })),
  ].filter((person) => `${person.name} ${person.email} ${person.scope}`.toLowerCase().includes(search.toLowerCase()))
  return <section className="demo-card"><div className="demo-list-toolbar"><label className="demo-search"><LabIcon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('admin.searchAccounts')} aria-label={t('admin.searchAccounts')} /></label><span>{t('common.count', { count: rows.length })}</span></div><div className="demo-table-scroll"><table className="demo-table"><thead><tr><th>{t('admin.account')}</th><th>{t('participants.access')}</th><th>{t('admin.scope')}</th></tr></thead><tbody>{rows.map((person) => <tr key={person.email}><td><button type="button" className="invoice-person" onClick={() => setOpened(opened === person.email ? undefined : person.email)}><strong>{person.name}</strong><small>{person.email}</small></button>{opened === person.email && <div className="account-expanded">{t(person.access)} · {person.scope}<br />{t('admin.accountActive')}</div>}</td><td>{t(person.access)}</td><td>{person.scope}</td></tr>)}</tbody></table>{!rows.length && <p className="demo-empty-inline">{t('common.noResults')}</p>}</div></section>
}

function SettingsScreen({ platform, communityName, writable, notify }: { platform: boolean; communityName: string; writable: boolean; notify: (message: string) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(platform ? 'OpenZEV' : communityName)
  const [interval, setInterval] = useState('monthly')
  return <form className="demo-card settings-form" onSubmit={(event) => { event.preventDefault(); if (writable) notify(t('setup.saved')) }}>
    <h2>{t('setup.general')}</h2><label>{t(platform ? 'setup.instanceName' : 'setup.communityName')}<input value={name} readOnly={!writable} onChange={(event) => setName(event.target.value)} /></label>
    {!platform && <label>{t('setup.billingInterval')}<select value={interval} disabled={!writable} onChange={(event) => setInterval(event.target.value)}><option value="monthly">{t('periods.monthly')}</option><option value="quarterly">{t('setup.quarterly')}</option></select></label>}
    <dl className="settings-facts"><div><dt>{t('setup.currency')}</dt><dd>CHF</dd></div><div><dt>{t('setup.timezone')}</dt><dd>Europe/Zurich</dd></div>{!platform && <><div><dt>{t('readiness.tariffs')}</dt><dd>{t('setup.tariffValue')}</dd></div><div><dt>{t('readiness.paymentAccount')}</dt><dd>CH93 0076 2011 6238 5295 7</dd></div></>}</dl>
    {writable && <button type="submit" className="demo-button">{t('setup.save')}</button>}
  </form>
}

function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog className="demo-dialog" ref={ref} aria-labelledby={titleId} onClose={close}><div className="dialog-top"><h2 id={titleId}>{title}</h2><button autoFocus type="button" className="demo-icon-button" onClick={close} aria-label={t('common.close')}><LabIcon name="close" /></button></div>{children}</dialog>
}

export function DemoWorkspace({ design, screen, role = 'owner', communityId: requestedCommunity, onNavigate, onScopeChange, preview = false }: {
  design: DesignId; screen: Screen; role?: DemoRole; communityId?: string; onNavigate?: (screen: Screen, communityId?: string) => void; onScopeChange?: (communityId?: string) => void; preview?: boolean;
}) {
  const { t, i18n } = useTranslation()
  const communityId = normalizeScope(role, requestedCommunity)
  const personal = role === 'participant'
  const platform = role === 'admin' && !communityId
  const writable = mayManage(role)
  const screens = availableScreens(role, communityId)
  const menuGroups = navigationGroups(role)
  const activeScreen = screens.includes(screen) ? screen : 'overview'
  const community = communities.find((item) => item.id === communityId)
  const [missing, setMissing] = useState<number>(community?.missing ?? 0)
  const [invoices, setInvoices] = useState<DemoInvoice[]>(() => invoicesFor(role, communityId))
  const [people, setPeople] = useState<DemoInvoice[]>(() => invoicesFor(role, communityId))
  const [filter, setFilter] = useState<InvoiceStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(invoices[0].id)
  const [person, setPerson] = useState(invoices[0])
  const [dialog, setDialog] = useState<'invoice' | 'participant' | 'search' | null>(null)
  const [notice, setNotice] = useState('')
  const [quickSearch, setQuickSearch] = useState('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedInvoiceId) ?? invoices[0]
  const blocked = (invoice: DemoInvoice) => Boolean(communityId ? missing : communities.find((item) => item.id === invoice.communityId)?.missing)
  const eligible = (invoice: DemoInvoice) => writable && invoice.status === 'draft' && !blocked(invoice)
  const visibleInvoices = invoices.filter((invoice) => (filter === 'all' || filter === invoice.status) && `${invoice.name} ${invoice.id} ${invoice.email}`.toLowerCase().includes(search.toLowerCase()))
  const visibleDrafts = visibleInvoices.filter(eligible)
  const allSelected = visibleDrafts.length > 0 && visibleDrafts.every((invoice) => selected.includes(invoice.id))
  const showContext = design === 'community' && !platform && ['overview', 'invoices'].includes(activeScreen)
  const total = invoices.reduce((sum, invoice) => sum + invoice.amount, 0)
  const paid = invoices.filter((invoice) => invoice.status === 'paid').reduce((sum, invoice) => sum + invoice.amount, 0)
  const consumption = personal ? participant.kwh : invoices.reduce((sum, invoice) => sum + invoice.kwh, 0)
  const production = personal ? Math.round(consumption * 0.617) : community?.production ?? 0
  const money = (amount: number) => formatNumber(amount, i18n.language, 2)

  useEffect(() => () => clearTimeout(noticeTimer.current), [])
  useEffect(() => {
    if (preview) return
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); setDialog('search') }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [preview])

  const notify = (message: string) => { setNotice(message); clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(''), 4500) }
  const navigate: Navigate = (nextScreen, nextFilter) => {
    if (!screens.includes(nextScreen)) return
    if (nextScreen === 'invoices') { setFilter(nextFilter ?? 'all'); setSearch(''); setSelected([]) }
    setDialog(null); onNavigate?.(nextScreen, communityId)
  }
  const navigateItem = (group: NavigationGroup, item: NavigationGroup['items'][number]) => {
    const nextScope = group.scope === 'platform' ? undefined : communityId ?? 'sonnenhof'
    if (nextScope === communityId) navigate(item.screen)
    else { setDialog(null); onNavigate?.(item.screen, nextScope) }
  }
  const openInvoice: InvoiceAction = (invoice) => { setSelectedInvoiceId(invoice.id); if (!showContext) setDialog('invoice') }
  const updateInvoice: InvoiceAction = (invoice) => {
    if (!writable || (invoice.status === 'draft' && blocked(invoice))) return
    const status = nextStatus(invoice.status)
    if (!status) return
    setInvoices((current) => current.map((item) => item.id === invoice.id ? { ...item, status } : item))
    setSelected((current) => current.filter((id) => id !== invoice.id))
    notify(t('billing.updated', { id: invoice.id, status: t(`status.${status}`) }))
  }
  const approveDrafts = () => {
    if (!writable) return
    const ids = visibleDrafts.filter((invoice) => !selected.length || selected.includes(invoice.id)).map((invoice) => invoice.id)
    setInvoices((current) => current.map((invoice) => ids.includes(invoice.id) ? { ...invoice, status: 'approved' } : invoice))
    setSelected([]); notify(t('billing.batchUpdated', { count: ids.length }))
  }
  const toggleSelected = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const toggleAll = () => setSelected((current) => allSelected ? current.filter((id) => !visibleDrafts.some((invoice) => invoice.id === id)) : [...new Set([...current, ...visibleDrafts.map((invoice) => invoice.id)])])
  const financial = <Metrics financial items={[
    { label: t('billing.total'), value: money(total), unit: 'CHF' }, { label: t('billing.outstanding'), value: money(total - paid), unit: 'CHF' }, { label: t('billing.paid'), value: money(paid), unit: 'CHF' },
  ]} />
  const energyMetrics = <Metrics items={[
    { label: t(personal ? 'personal.consumption' : 'metrics.consumption'), value: formatNumber(consumption, i18n.language), unit: 'kWh' },
    { label: t(personal ? 'energy.local' : 'metrics.production'), value: formatNumber(production, i18n.language), unit: 'kWh' },
    { label: t('metrics.share'), value: formatNumber(61.7, i18n.language, 1), unit: '%' },
  ]} />
  const chart = <EnergyChart design={design} consumptionTotal={consumption} productionTotal={production} personal={personal} />
  const pending = <PendingWork invoices={invoices} navigate={navigate} />
  const readiness = community && <Readiness missing={missing} people={invoices.length} navigate={navigate} />
  const periods = community && <PeriodWork invoices={invoices} missing={missing} navigate={navigate} />
  const queue = <section className="demo-card demo-queue"><div className="demo-card-header"><h2>{t(personal ? 'personal.invoices' : 'billing.recent')}</h2><button type="button" className="demo-text-button" onClick={() => navigate('invoices')}>{t('common.viewAll')}</button></div><InvoiceTable invoices={invoices} openInvoice={openInvoice} personal={personal} /></section>
  const overview = (() => {
    if (platform) return <><Metrics items={[{ label: t('nav.communities'), value: String(communities.length) }, { label: t('nav.participants'), value: String(invoices.length) }, { label: t('admin.openInvoices'), value: String(invoices.filter((invoice) => invoice.status !== 'paid').length) }]} /><CommunitiesTable invoices={invoices} onOpen={onScopeChange} /><section className="admin-issues"><h2>{t('admin.attention')}</h2><button type="button" onClick={() => onScopeChange?.('limmatblick')}>Limmatblick<span>{t('readiness.missing', { count: 2 })}</span><LabIcon name="right" /></button></section></>
    if (personal) return <>{energyMetrics}<section className="personal-bill"><div><span>{t('personal.currentInvoice')}</span><strong>CHF {money(participant.amount)}</strong><span>{t('invoice.due')}: {t('dueDates.september')}</span></div><Button onClick={() => openInvoice(invoices[0])}>{t('personal.openInvoice')}</Button></section>{design === 'community' ? queue : <div className="personal-overview">{chart}{queue}</div>}</>
    switch (design) {
      case 'control': return <>{financial}{periods}{queue}</>
      case 'canvas': return <>{pending}{periods}{chart}</>
      case 'night': return <>{energyMetrics}<div className="overview-grid">{chart}{pending}</div>{periods}</>
      case 'guided': return <div className="billing-workspace"><div>{periods}{queue}</div>{readiness}</div>
      case 'community': return <>{pending}{queue}</>
      case 'ledger': return <><section className="statement-summary"><div><span className="paper-label">{t('invoice.period')}</span><strong>{t('periods.dates')}</strong><dl><div><dt>{t('nav.participants')}</dt><dd>{invoices.length}</dd></div><div><dt>{t('readiness.readings')}</dt><dd>{missing ? t('readiness.missing', { count: missing }) : t('energy.quality')}</dd></div></dl></div><div className="statement-amount"><span>{t('billing.total')}</span><strong><small>CHF</small> {money(total)}</strong><span>{t('billing.outstanding')}: CHF {money(total - paid)}</span></div></section>{queue}{readiness}</>
      case 'folio': return <>{periods}{queue}{financial}</>
      default: return <><div className="overview-grid">{periods}{readiness}</div>{queue}{financial}</>
    }
  })()
  const contextName = platform ? t('admin.platform') : community!.name
  const accountName = personal ? participant.name : role === 'admin' ? 'Alex Schärer' : 'Julia Müller'
  const activeScope = personal ? 'personal' : platform ? 'platform' : 'community'
  const activeMenuItem = menuGroups.filter((group) => group.scope === activeScope).flatMap((group) => group.items).find((item) => item.screen === activeScreen)
  const title = t(blankScreens.includes(activeScreen) ? activeMenuItem!.labelKey : personal ? `personal.pages.${activeScreen}` : platform ? `admin.pages.${activeScreen}` : `pages.${activeScreen}.title`)
  const navigationName = (group: NavigationGroup, item: NavigationGroup['items'][number]) => group.scope === 'platform' ? t('nav.scopedLabel', { scope: t('nav.platformGroup'), label: t(item.labelKey) }) : t(item.labelKey)
  const isActiveNavigation = (group: NavigationGroup, item: NavigationGroup['items'][number]) => group.scope === activeScope && (item.screen === activeScreen || platform && item.screen === 'overview' && ['communities', 'invoices'].includes(activeScreen))
  const filterStatuses: (InvoiceStatus | 'all')[] = personal ? ['all', 'sent', 'paid'] : ['all', ...statusIds]
  const scopeOptions = role === 'admin' ? communities : communities.filter((item) => item.id !== 'bergacker')
  return <div className={`demo-shell v-${design} ${platform ? 'scope-platform' : ''} ${personal ? 'scope-personal' : ''}`} data-theme={`lab-${design}`} data-role={role} data-scope={communityId ?? 'platform'}>
    <aside className="demo-sidebar"><Brand /><nav className="demo-navigation" aria-label={t('nav.workspace')}>{menuGroups.map((group) => <div className={`demo-nav-group nav-group-${group.id}`} data-nav-group={group.id} role={group.labelKey ? 'group' : undefined} aria-label={group.labelKey ? t(group.labelKey) : undefined} key={group.id}>
      {group.labelKey && <span className="demo-nav-group-label" aria-hidden="true">{t(group.labelKey)}</span>}
      {group.items.map((item) => <button type="button" className={isActiveNavigation(group, item) ? 'nav-active' : ''} aria-label={group.scope === 'platform' ? navigationName(group, item) : undefined} aria-current={isActiveNavigation(group, item) ? 'page' : undefined} onClick={() => navigateItem(group, item)} key={item.screen}><LabIcon name={item.screen} /><span>{t(item.labelKey)}</span></button>)}
    </div>)}</nav><div className="sidebar-bottom"><span>{accountName}</span><small>{t(`roles.${role}`)}</small></div></aside>
    <div className="demo-main"><header className="demo-topbar"><div className="demo-scope">{role === 'admin' || role === 'owner' ? <label><span className="lab-sr-only">{t('admin.scope')}</span><select aria-label={t('admin.scope')} value={communityId ?? 'platform'} onChange={(event) => onScopeChange?.(event.target.value === 'platform' ? undefined : event.target.value)}>{role === 'admin' && <option value="platform">{t('admin.platform')}</option>}{scopeOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <strong>{contextName}</strong>}{role === 'viewer' && <span className="read-only-label">{t('roles.readOnly')}</span>}</div><div className="topbar-actions"><button type="button" className="demo-command-trigger" onClick={() => setDialog('search')} aria-label={t('nav.search')}><LabIcon name="search" /><span>{t('nav.search')}</span><kbd>⌘ K</kbd></button>{personal ? <button type="button" className="topbar-account" aria-label={t('nav.profile')} onClick={() => navigate('profile')}>{accountName}</button> : <span className="topbar-account">{accountName}</span>}</div></header>
      <div className="demo-body"><div className="demo-page-heading"><div><p className="demo-kicker">{contextName}</p><h1>{title}</h1></div>{!platform && !blankScreens.includes(activeScreen) && activeScreen !== 'profile' && activeScreen !== 'settings' && <span className="demo-period">{t('common.period')}</span>}</div>
        <div className={`demo-working-area ${showContext ? 'with-context' : ''}`}><main className="demo-page-content">
          {platform && ['overview', 'communities', 'invoices'].includes(activeScreen) && <nav className="platform-page-nav" aria-label={t('nav.platformGroup')}>{(['overview', 'communities', 'invoices'] as const).map((id) => <button type="button" aria-current={activeScreen === id ? 'page' : undefined} onClick={() => navigate(id)} key={id}>{t(id === 'invoices' ? 'nav.adminInvoices' : `nav.${id}`)}</button>)}</nav>}
          {activeScreen === 'overview' && overview}
          {activeScreen === 'energy' && <>{energyMetrics}{chart}{!personal && <section className="demo-card metering-quality"><div className="demo-card-header"><h2>{t('readiness.readings')}</h2>{writable && missing > 0 && <Button onClick={() => { setMissing(0); notify(t('readiness.loaded')) }}>{t('readiness.loadSample')}</Button>}</div><div className="demo-table-scroll"><table className="demo-table"><thead><tr><th>{t('participants.meter')}</th><th>{t('fields.participant')}</th><th>{t('fields.status')}</th><th className="numeric">kWh</th></tr></thead><tbody>{invoices.map((invoice, index) => <tr key={invoice.id}><td>CH-101-{invoice.unit}</td><td>{invoice.name}</td><td className={index < missing ? 'readiness-warning' : ''}>{t(index < missing ? 'readiness.incomplete' : 'energy.quality')}</td><td className="numeric">{index < missing ? '—' : formatNumber(invoice.kwh, i18n.language)}</td></tr>)}</tbody></table></div></section>}</>}
          {activeScreen === 'invoices' && <>{!personal && financial}<section className="demo-card invoice-list-card"><div className="demo-list-toolbar"><label className="demo-search"><LabIcon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t(personal ? 'personal.searchInvoices' : 'billing.search')} aria-label={t(personal ? 'personal.searchInvoices' : 'billing.search')} /></label>{visibleDrafts.length > 0 && <Button onClick={approveDrafts}>{t(selected.length ? 'billing.approveSelected' : 'billing.approveAll')}</Button>}</div><div className="invoice-status-tabs" role="group" aria-label={t('billing.filter')}>{filterStatuses.map((status) => <button type="button" aria-pressed={filter === status} onClick={() => { setFilter(status); setSelected([]) }} key={status}>{t(status === 'all' ? 'common.all' : `status.${status}`)}<span>{status === 'all' ? invoices.length : invoices.filter((invoice) => invoice.status === status).length}</span></button>)}</div>
            {visibleInvoices.length ? <InvoiceTable invoices={visibleInvoices} openInvoice={openInvoice} personal={personal} platform={platform} updateInvoice={writable ? updateInvoice : undefined} eligible={eligible} selected={selected} toggleSelected={visibleDrafts.length ? toggleSelected : undefined} allSelected={allSelected} toggleAll={visibleDrafts.length ? toggleAll : undefined} /> : <div className="demo-empty"><h2>{t('common.noResults')}</h2><Button onClick={() => { setSearch(''); setFilter('all') }} secondary>{t('common.clear')}</Button></div>}
          </section></>}
          {activeScreen === 'participants' && <ParticipantsScreen people={people} openPerson={(nextPerson) => { setPerson(nextPerson); setDialog('participant') }} />}
          {activeScreen === 'communities' && <CommunitiesTable invoices={invoices} onOpen={onScopeChange} />}
          {activeScreen === 'accounts' && <AccountsScreen />}
          {activeScreen === 'profile' && <section className="demo-card"><Profile person={participant} /></section>}
          {activeScreen === 'settings' && <SettingsScreen platform={platform} communityName={contextName} writable={writable} notify={notify} />}
        </main>{showContext && <aside className="invoice-context" aria-label={t('invoice.preview')}><InvoiceDocument invoice={selectedInvoice} updateInvoice={writable ? updateInvoice : undefined} blocked={blocked(selectedInvoice)} /></aside>}</div>
      </div>
    </div>
    {!preview && <>{createPortal(<div className={`demo-toast ${notice ? 'toast-visible' : ''}`} data-theme={`lab-${design}`} role="status" aria-live="polite">{notice && <><span>{notice}</span><button type="button" className="demo-icon-button" onClick={() => setNotice('')} aria-label={t('common.close')}><LabIcon name="close" /></button></>}</div>, document.body)}
      {dialog && <Dialog title={t(dialog === 'invoice' ? 'invoice.preview' : dialog === 'participant' ? 'fields.participant' : 'nav.help')} close={() => setDialog(null)}>
        {dialog === 'invoice' && <InvoiceDocument invoice={selectedInvoice} updateInvoice={writable ? updateInvoice : undefined} blocked={blocked(selectedInvoice)} />}
        {dialog === 'participant' && <Profile key={person.id} person={person} onSave={writable ? (nextPerson) => { setPerson(nextPerson); setPeople((current) => current.map((item) => item.id === nextPerson.id ? nextPerson : item)); notify(t('setup.saved')); setDialog(null) } : undefined} />}
        {dialog === 'search' && <div className="quick-navigation"><label className="demo-search"><LabIcon name="search" /><input value={quickSearch} onChange={(event) => setQuickSearch(event.target.value)} placeholder={t('nav.search')} aria-label={t('nav.search')} /></label>{menuGroups.flatMap((group) => group.items.filter((item) => navigationName(group, item).toLowerCase().includes(quickSearch.toLowerCase())).map((item) => <button type="button" onClick={() => navigateItem(group, item)} key={`${group.id}-${item.screen}`}><LabIcon name={item.screen} />{navigationName(group, item)}</button>))}{!personal && people.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(quickSearch.toLowerCase())).map((item) => <button type="button" onClick={() => { setPerson(item); setDialog('participant') }} key={item.id}>{item.name}</button>)}</div>}
      </Dialog>}
    </>}
  </div>
}
