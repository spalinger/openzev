export const designs = [
  { id: 'alpine', number: '01' },
  { id: 'control', number: '02' },
  { id: 'canvas', number: '03' },
  { id: 'night', number: '04' },
  { id: 'guided', number: '05' },
  { id: 'community', number: '06' },
  { id: 'ledger', number: '07' },
  { id: 'folio', number: '08' },
] as const

export type Design = (typeof designs)[number]
export type DesignId = Design['id']
export type Screen = 'overview' | 'energy' | 'invoices' | 'participants' | 'communities' | 'accounts' | 'settings' | 'profile' | 'metering' | 'reports' | 'meteringPoints' | 'tariffs' | 'feasibility' | 'annualStatement' | 'templates'
// Preview personas, not backend roles. A manager/viewer relationship belongs
// to a community; only admin is a platform role in the actual application.
export type DemoRole = 'owner' | 'participant' | 'admin' | 'viewer'
export const roleIds: DemoRole[] = ['owner', 'participant', 'admin', 'viewer']
export interface NavigationGroup {
  id: string
  labelKey?: string
  scope: 'community' | 'platform' | 'personal'
  items: { screen: Screen; labelKey: string }[]
}

// Complete menu from ui-sidebar-labels, independent of populated sample pages.
export function navigationGroups(role: DemoRole): NavigationGroup[] {
  if (role === 'participant') return [{ id: 'personal', scope: 'personal', items: [
    { screen: 'overview', labelKey: 'nav.dashboard' },
    { screen: 'invoices', labelKey: 'personal.invoices' },
    { screen: 'annualStatement', labelKey: 'nav.annualStatement' },
  ] }]
  const groups: NavigationGroup[] = [
    { id: 'community', scope: 'community', items: [
      { screen: 'overview', labelKey: 'nav.overview' },
      { screen: 'energy', labelKey: 'nav.energy' },
      { screen: 'metering', labelKey: 'nav.metering' },
      { screen: 'invoices', labelKey: 'nav.invoices' },
      { screen: 'reports', labelKey: 'nav.reports' },
    ] },
    { id: 'setup', labelKey: 'nav.setupGroup', scope: 'community', items: [
      { screen: 'participants', labelKey: 'nav.participants' },
      { screen: 'meteringPoints', labelKey: 'nav.meteringPoints' },
      { screen: 'tariffs', labelKey: 'nav.tariffs' },
      { screen: 'settings', labelKey: 'nav.settings' },
    ] },
    { id: 'feasibility', scope: 'community', items: [{ screen: 'feasibility', labelKey: 'nav.feasibility' }] },
  ]
  if (role === 'admin') groups.push({ id: 'platform', labelKey: 'nav.platformGroup', scope: 'platform', items: [
    { screen: 'overview', labelKey: 'nav.overview' },
    { screen: 'accounts', labelKey: 'nav.accounts' },
    { screen: 'templates', labelKey: 'nav.templates' },
    { screen: 'settings', labelKey: 'nav.settings' },
  ] })
  return groups
}

export const blankScreens: Screen[] = ['metering', 'reports', 'meteringPoints', 'tariffs', 'feasibility', 'annualStatement', 'templates']
export type InvoiceStatus = 'draft' | 'approved' | 'sent' | 'paid'

export interface DemoInvoice {
  id: string
  name: string
  initials: string
  email: string
  unit: string
  amount: number
  kwh: number
  status: InvoiceStatus
  producer: boolean
  communityId?: string
  period?: 'september' | 'august' | 'july'
}

export const initialInvoices: DemoInvoice[] = [
  { id: 'OZ-2026-091', name: 'Nina Keller', initials: 'NK', email: 'nina.keller@example.com', unit: 'A1', amount: 186.40, kwh: 742, status: 'draft', producer: false },
  { id: 'OZ-2026-092', name: 'Reto Meier', initials: 'RM', email: 'reto.meier@example.com', unit: 'A2', amount: 154.80, kwh: 618, status: 'draft', producer: false },
  { id: 'OZ-2026-093', name: 'Lena Weber', initials: 'LW', email: 'lena.weber@example.com', unit: 'B1', amount: 228.60, kwh: 934, status: 'approved', producer: true },
  { id: 'OZ-2026-094', name: 'Maya Roth', initials: 'MR', email: 'maya.roth@example.com', unit: 'B2', amount: 142.30, kwh: 557, status: 'sent', producer: false },
  { id: 'OZ-2026-095', name: 'Atelier Nord', initials: 'AN', email: 'atelier.nord@example.com', unit: 'C1', amount: 416.90, kwh: 1756, status: 'paid', producer: true },
  { id: 'OZ-2026-096', name: 'Benedikt Steiner', initials: 'BS', email: 'benedikt.steiner@example.com', unit: 'C2', amount: 167.20, kwh: 682, status: 'paid', producer: false },
]

export const communities = [
  { id: 'sonnenhof', name: 'Sonnenhof', city: 'Zürich', address: 'Sonnenweg 4', postalCode: '8004', manager: 'Julia Müller', production: 4268, missing: 0 },
  { id: 'limmatblick', name: 'Limmatblick', city: 'Dietikon', address: 'Limmatstrasse 12', postalCode: '8953', manager: 'Julia Müller', production: 2590, missing: 2 },
  { id: 'bergacker', name: 'Bergacker', city: 'Winterthur', address: 'Bergackerweg 8', postalCode: '8400', manager: 'Daniel Frei', production: 1840, missing: 0 },
] as const

export const communityInvoices: DemoInvoice[] = [
  ...initialInvoices.map((invoice) => ({ ...invoice, communityId: 'sonnenhof', period: 'september' as const })),
  { id: 'LB-2026-041', name: 'Anna Huber', initials: 'AH', email: 'anna.huber@example.com', unit: 'D1', amount: 205.70, kwh: 861, status: 'draft', producer: false, communityId: 'limmatblick' },
  { id: 'LB-2026-042', name: 'Felix Graf', initials: 'FG', email: 'felix.graf@example.com', unit: 'D2', amount: 178.20, kwh: 728, status: 'draft', producer: true, communityId: 'limmatblick' },
  { id: 'LB-2026-043', name: 'Eva Schmid', initials: 'ES', email: 'eva.schmid@example.com', unit: 'E1', amount: 156.90, kwh: 640, status: 'sent', producer: false, communityId: 'limmatblick' },
  { id: 'LB-2026-044', name: 'Noah Bachmann', initials: 'NB', email: 'noah.bachmann@example.com', unit: 'E2', amount: 217.60, kwh: 898, status: 'paid', producer: false, communityId: 'limmatblick' },
  { id: 'BA-2026-021', name: 'Sara Baumann', initials: 'SB', email: 'sara.baumann@example.com', unit: 'F1', amount: 182.30, kwh: 741, status: 'approved', producer: true, communityId: 'bergacker' },
  { id: 'BA-2026-022', name: 'Luca Brunner', initials: 'LB', email: 'luca.brunner@example.com', unit: 'F2', amount: 166.50, kwh: 670, status: 'paid', producer: false, communityId: 'bergacker' },
  { id: 'BA-2026-023', name: 'Tim Fischer', initials: 'TF', email: 'tim.fischer@example.com', unit: 'F3', amount: 144.80, kwh: 596, status: 'sent', producer: false, communityId: 'bergacker' },
]

export const participant = communityInvoices.find((invoice) => invoice.id === 'OZ-2026-094')!
export const participantInvoices: DemoInvoice[] = [
  participant,
  { ...participant, id: 'OZ-2026-074', amount: 131.60, kwh: 516, status: 'paid', period: 'august' },
  { ...participant, id: 'OZ-2026-054', amount: 149.20, kwh: 585, status: 'paid', period: 'july' },
]

export function availableScreens(role: DemoRole, communityId?: string): Screen[] {
  const scope = role === 'participant' ? 'personal' : role === 'admin' && !communityId ? 'platform' : 'community'
  const screens = navigationGroups(role).filter((group) => group.scope === scope).flatMap((group) => group.items.map((item) => item.screen))
  if (scope === 'personal') screens.push('energy', 'profile')
  if (scope === 'platform') screens.push('communities', 'invoices')
  return screens
}

export function normalizeScope(role: DemoRole, id?: string): string | undefined {
  if (role === 'participant' || role === 'viewer') return 'sonnenhof'
  const found = communities.find((community) => community.id === id)?.id
  if (role === 'admin') return found
  return found === 'bergacker' ? 'sonnenhof' : found ?? 'sonnenhof'
}

export function invoicesFor(role: DemoRole, communityId?: string): DemoInvoice[] {
  if (role === 'participant') return participantInvoices
  const scope = normalizeScope(role, communityId)
  return communityInvoices.filter((invoice) => !scope || invoice.communityId === scope)
}

export function mayManage(role: DemoRole): boolean {
  return role === 'owner' || role === 'admin'
}

export const screenIds: Screen[] = ['overview', 'energy', 'invoices', 'participants', 'communities', 'accounts', 'settings', 'profile', ...blankScreens]
export const statusIds: InvoiceStatus[] = ['draft', 'approved', 'sent', 'paid']

export const dailyConsumption = [340, 390, 425, 395, 365, 360, 450, 470, 415, 380, 430, 460, 400, 345, 410, 480, 440, 410, 420, 495, 465, 410, 395, 430, 490, 460, 430, 450, 400, 470]
export const dailyProduction = [280, 320, 395, 310, 280, 330, 410, 415, 290, 315, 375, 390, 340, 280, 360, 405, 370, 305, 340, 420, 365, 300, 340, 380, 420, 330, 340, 390, 350, 400]

export function formatNumber(value: number, language: string, decimals = 0) {
  return new Intl.NumberFormat(`${language}-CH`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)
}

export function nextStatus(status: InvoiceStatus): InvoiceStatus | undefined {
  return { draft: 'approved', approved: 'sent', sent: 'paid', paid: undefined }[status] as InvoiceStatus | undefined
}
