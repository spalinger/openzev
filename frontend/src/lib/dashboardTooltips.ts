import { formatKwh, formatPercent } from './numbers'

// Identify the percentage series by dataKey; names are translated.
export function formatProductionMixTooltip(
    value: unknown,
    name: string,
    dataKey: unknown,
    selfConsumedLabel: string,
): [string, string] {
    if (dataKey === 'self_consumption_rate') {
        return [formatPercent(Number(value)), selfConsumedLabel]
    }
    return [`${formatKwh(Number(value), { maxDecimals: 2 })} kWh`, name]
}
