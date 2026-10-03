import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { DemoWorkspace } from './DemoWorkspace'
import { LabIcon } from './LabIcon'
import { availableScreens, designs, normalizeScope, roleIds } from './mockData'
import type { DemoRole, DesignId, Screen } from './mockData'

interface Location {
  design?: DesignId
  screen: Screen
  mobile: boolean
  role: DemoRole
  communityId?: string
}

function readLocation(): Location {
  const params = new URLSearchParams(window.location.protocol === 'file:' && window.location.hash ? window.location.hash.slice(1) : window.location.search)
  const role = roleIds.find((id) => id === params.get('role')) ?? 'owner'
  const communityId = normalizeScope(role, params.get('community') ?? undefined)
  return {
    design: designs.find((item) => item.id === params.get('design'))?.id,
    screen: availableScreens(role, communityId).find((id) => id === params.get('screen')) ?? 'overview',
    mobile: params.get('viewport') === 'mobile', role, communityId,
  }
}

function hrefFor(next: Location): string {
  const params = new URLSearchParams()
  if (next.design) params.set('design', next.design)
  if (next.screen !== 'overview' && next.design) params.set('screen', next.screen)
  if (next.mobile && next.design) params.set('viewport', 'mobile')
  if (next.role !== 'owner') params.set('role', next.role)
  if (next.communityId && (next.role === 'admin' || next.communityId !== 'sonnenhof')) params.set('community', next.communityId)
  if (window.location.protocol === 'file:') return `${window.location.pathname}${window.location.search}#${params.size ? params : 'gallery'}`
  return `${window.location.pathname}${params.size ? `?${params}` : ''}`
}

function LanguageSelector() {
  const { t, i18n } = useTranslation()
  return <label className="lab-language"><span className="lab-sr-only">{t('gallery.language')}</span><select value={i18n.resolvedLanguage} onChange={(event) => { void i18n.changeLanguage(event.target.value) }}>{['en', 'de', 'fr', 'it'].map((language) => <option value={language} key={language}>{language.toUpperCase()}</option>)}</select></label>
}

function Miniature({ design, role, communityId }: { design: DesignId; role: DemoRole; communityId?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.25)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1440))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return <div className="gallery-preview" ref={ref} inert aria-hidden="true"><div className="gallery-preview-app" style={{ transform: `scale(${scale})` }}><DemoWorkspace key={`${role}-${communityId}`} design={design} role={role} communityId={communityId} screen="overview" preview /></div></div>
}

export function DesignLab() {
  const { t } = useTranslation()
  const [location, setLocation] = useState(readLocation)
  useEffect(() => {
    const handlePopState = () => setLocation(readLocation())
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('hashchange', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('hashchange', handlePopState)
    }
  }, [])

  const navigate = (next: Location) => {
    const href = hrefFor(next)
    if (window.location.protocol === 'file:') window.location.assign(href)
    else window.history.pushState(null, '', href)
    setLocation(next)
    if (location.design !== next.design) window.scrollTo({ top: 0, behavior: 'instant' })
  }
  const openConcept = (event: MouseEvent<HTMLAnchorElement>, design: DesignId) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate({ ...location, design, screen: 'overview', mobile: false })
  }
  const current = designs.find((design) => design.id === location.design)
  const currentIndex = designs.findIndex((design) => design.id === location.design)
  const adjacent = (offset: number) => navigate({ ...location, design: designs[(currentIndex + offset + designs.length) % designs.length].id })
  const roleSelector = <label className="lab-role-picker"><span>{t('roles.viewAs')}</span><select aria-label={t('roles.viewAs')} value={location.role} onChange={(event) => {
    const role = event.target.value as DemoRole
    navigate({ ...location, role, communityId: normalizeScope(role), screen: 'overview' })
  }}>{roleIds.map((role) => <option key={role} value={role}>{t(`roles.${role}`)}</option>)}</select></label>

  if (!current) return <div className="lab-gallery">
    <header className="gallery-top"><a className="lab-wordmark" href={hrefFor({ ...location, design: undefined, screen: 'overview', mobile: false })}>OpenZEV</a><h1>{t('gallery.title')}</h1><div className="gallery-controls">{roleSelector}<LanguageSelector /></div></header>
    <main className="gallery-main"><div className="gallery-grid">{designs.map((design) => <article className="gallery-card" key={design.id} data-design={design.id}>
      <div className="gallery-preview-wrap"><Miniature design={design.id} role={location.role} communityId={location.communityId} /></div>
      <div className="gallery-card-title"><span>{design.number}</span><h2><a href={hrefFor({ ...location, design: design.id, screen: 'overview', mobile: false })} onClick={(event) => openConcept(event, design.id)}>{t(`designs.${design.id}.name`)}</a></h2><LabIcon name="right" /></div>
    </article>)}</div></main>
  </div>

  return <div className="lab-prototype">
    <header className="lab-toolbar"><div className="lab-toolbar-start"><a href={hrefFor({ ...location, design: undefined, screen: 'overview', mobile: false })} onClick={(event) => {
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate({ ...location, design: undefined, screen: 'overview', mobile: false }) }
    }}><LabIcon name="left" /><span>{t('gallery.back')}</span></a><label className="lab-design-picker"><span className="lab-sr-only">{t('gallery.concept')}</span><select aria-label={t('gallery.concept')} value={current.id} onChange={(event) => navigate({ ...location, design: event.target.value as DesignId })}>{designs.map((design) => <option value={design.id} key={design.id}>{design.number} / {t(`designs.${design.id}.name`)}</option>)}</select></label><div className="lab-adjacent"><button type="button" onClick={() => adjacent(-1)} aria-label={t('gallery.previous')}><LabIcon name="left" /></button><button type="button" onClick={() => adjacent(1)} aria-label={t('gallery.next')}><LabIcon name="right" /></button></div></div>
      <div className="lab-toolbar-end">{roleSelector}<div className="lab-viewport" role="group" aria-label={t('gallery.viewport')}><button type="button" aria-pressed={!location.mobile} onClick={() => navigate({ ...location, mobile: false })}><LabIcon name="desktop" /><span>{t('gallery.desktop')}</span></button><button type="button" aria-pressed={location.mobile} onClick={() => navigate({ ...location, mobile: true })}><LabIcon name="mobile" /><span>{t('gallery.mobile')}</span></button></div><LanguageSelector /><span className="lab-demo-label">{t('common.demo')}</span></div>
    </header>
    <div className={`lab-stage ${location.mobile ? 'stage-mobile' : ''}`}><div className="lab-app-frame"><DemoWorkspace key={`${current.id}-${location.role}-${location.communityId}`} design={current.id} role={location.role} communityId={location.communityId} screen={location.screen} onNavigate={(screen, communityId) => navigate({ ...location, screen, communityId })} onScopeChange={(communityId) => navigate({ ...location, communityId, screen: 'overview' })} /></div></div>
  </div>
}
