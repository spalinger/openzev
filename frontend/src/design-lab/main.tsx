import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import i18next from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import '@fontsource-variable/inter/index.css'
import '../styles/tokens.css'
import { designLabLocales } from '../i18n/locales/designLab'
import { DesignLab } from './DesignLab'
import './design-lab.css'

// The prototype has its own language preference and no auth or API providers.
const i18n = i18next.createInstance()
let savedLanguage: string | null = null
try {
  savedLanguage = localStorage.getItem('openzev.design-lab.language')
} catch {
  // Some browsers disable storage for local files or private sessions.
}
await i18n.use(initReactI18next).init({
  resources: Object.fromEntries(Object.entries(designLabLocales).map(([language, translation]) => [language, { translation }])),
  lng: savedLanguage ?? 'en',
  fallbackLng: 'en',
  supportedLngs: ['en', 'de', 'fr', 'it'],
  interpolation: { escapeValue: false },
})

function updateLanguage(language: string) {
  document.documentElement.lang = `${language}-CH`
  document.title = i18n.t('gallery.documentTitle')
  try {
    localStorage.setItem('openzev.design-lab.language', language)
  } catch {
    // The gallery works without persistence when storage is unavailable.
  }
}
updateLanguage(i18n.resolvedLanguage ?? 'en')
i18n.on('languageChanged', updateLanguage)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <DesignLab />
    </I18nextProvider>
  </StrictMode>,
)
