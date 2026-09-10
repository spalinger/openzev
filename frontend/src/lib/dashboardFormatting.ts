import { formatKwh } from './numbers'

/** Period-bucket Y axes match tooltip precision (up to two decimals). */
export const kwhTick = (value: number): string => formatKwh(value, { maxDecimals: 2 })

/** Hourly-profile Y axes match tooltip precision (up to four decimals). */
export const hourlyKwhTick = (value: number): string => formatKwh(value, { maxDecimals: 4 })

/** Period-bucket tooltip (up to two decimals). */
export const kwhTooltipValue = (value: unknown): string =>
    `${formatKwh(Number(value), { maxDecimals: 2 })} kWh`

/** Hourly-profile tooltip (up to four decimals). */
export const hourlyKwhTooltipValue = (value: unknown): string =>
    `${formatKwh(Number(value), { maxDecimals: 4 })} kWh`

/** Dashboard KPI/table precision: up to two decimals. */
export const dashboardKwhStat = (value: number): string =>
    `${formatKwh(value, { maxDecimals: 2 })} kWh`
