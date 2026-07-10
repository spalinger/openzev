import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider, createTheme } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import { useTranslation } from 'react-i18next'
import 'dayjs/locale/de'
import 'dayjs/locale/fr'
import 'dayjs/locale/it'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import './index.css'
import App from './App.tsx'
import './i18n'
import { AuthProvider } from './lib/auth'
import { AppSettingsProvider } from './lib/appSettings'
import { ToastProvider } from './lib/toast'

const queryClient = new QueryClient()

// Aligns Mantine's surfaces (date pickers) with the hand-rolled CSS in index.css:
// Tailwind's sky ramp, whose shade 6 is the brand blue used by .button's gradient.
//
// Deliberately no `fontFamily`: Mantine's stylesheet sets `body { font-family }`,
// so overriding it here would restyle the whole app, not just Mantine's surfaces.
const mantineTheme = createTheme({
    defaultRadius: 'md',
    primaryColor: 'brand',
    primaryShade: 6,
    colors: {
        brand: [
            '#f0f9ff',
            '#e0f2fe',
            '#bae6fd',
            '#7dd3fc',
            '#38bdf8',
            '#0ea5e9',
            '#0284c7',
            '#0369a1',
            '#075985',
            '#0c4a6e',
        ],
    },
})

/** Feeds the active UI language to Mantine's calendars, which otherwise render English month names. */
function DatesLocaleProvider({ children }: { children: ReactNode }) {
    const { i18n } = useTranslation()
    // dayjs locales are registered under the bare language code.
    const locale = i18n.language?.split('-')[0] ?? 'en'

    return <DatesProvider settings={{ locale }}>{children}</DatesProvider>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppSettingsProvider>
          <ToastProvider>
            <MantineProvider theme={mantineTheme}>
              <DatesLocaleProvider>
                <App />
              </DatesLocaleProvider>
            </MantineProvider>
          </ToastProvider>
        </AppSettingsProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
