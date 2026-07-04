import { deDE, enUS, frFR, itIT } from '@mui/x-data-grid/locales'
import type { GridLocaleText } from '@mui/x-data-grid'

const localeTextByLanguage: Record<string, Partial<GridLocaleText>> = {
    en: enUS.components.MuiDataGrid.defaultProps.localeText,
    de: deDE.components.MuiDataGrid.defaultProps.localeText,
    fr: frFR.components.MuiDataGrid.defaultProps.localeText,
    it: itIT.components.MuiDataGrid.defaultProps.localeText,
}

export function getDataGridLocaleText(language: string): Partial<GridLocaleText> {
    return localeTextByLanguage[language] ?? localeTextByLanguage.en
}
