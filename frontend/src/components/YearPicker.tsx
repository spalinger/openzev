import { useId } from 'react'

type YearPickerProps = {
    years: readonly number[]
    value: number
    onChange: (year: number) => void
    disabled?: boolean
    label: string
    id?: string
    visibleLabel?: boolean
    className?: string
}

/** The caller owns the year range, default, rollover and pending state. */
export function YearPicker({ years, value, onChange, disabled, label, id, visibleLabel = true, className }: YearPickerProps) {
    const generatedId = useId()
    const selectId = id ?? generatedId
    return (
        <label className={className} htmlFor={selectId}>
            {visibleLabel && <span>{label}</span>}
            <select
                id={selectId}
                aria-label={visibleLabel ? undefined : label}
                value={value}
                onChange={event => onChange(Number(event.target.value))}
                disabled={disabled}
            >
                {years.map(year => <option key={year} value={year}>{year}</option>)}
            </select>
        </label>
    )
}
