type SparklineProps = {
    /** One value per step, oldest first; `null` breaks the line (no data at that step). */
    values: Array<number | null>
    width?: number
    height?: number
}

/** Decorative sparkline. Null values break the line; fewer than two recorded values render nothing. */
export function Sparkline({ values, width = 56, height = 18 }: SparklineProps) {
    const present = values.filter((value): value is number => value !== null)
    if (present.length < 2) return null

    const pad = 2
    const min = Math.min(0, ...present)
    const max = Math.max(0, ...present)
    const span = max - min || 1
    const x = (index: number) => pad + (index * (width - 2 * pad)) / Math.max(values.length - 1, 1)
    const y = (value: number) => height - pad - ((value - min) / span) * (height - 2 * pad)
    const baseline = y(0).toFixed(1)

    // Runs of consecutive steps with data; a missing step ends a run.
    const runs: Array<Array<[string, string]>> = []
    let run: Array<[string, string]> | null = null
    values.forEach((value, index) => {
        if (value === null) {
            run = null
            return
        }
        if (!run) {
            run = []
            runs.push(run)
        }
        run.push([x(index).toFixed(1), y(value).toFixed(1)])
    })
    const last = runs[runs.length - 1][runs[runs.length - 1].length - 1]

    return (
        <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
            {runs.map((points, index) => {
                const coordinates = points.map((point) => point.join(',')).join(' ')
                return points.length > 1 ? (
                    <g key={index}>
                        <path
                            className="sparkline-area"
                            d={`M${points[0][0]},${baseline} L${coordinates} L${points[points.length - 1][0]},${baseline} Z`}
                        />
                        <polyline className="sparkline-line" points={coordinates} />
                    </g>
                ) : index < runs.length - 1 ? (
                    <circle key={index} className="sparkline-dot" cx={points[0][0]} cy={points[0][1]} r={1} />
                ) : null
            })}
            <circle className="sparkline-end" cx={last[0]} cy={last[1]} r={1.75} />
        </svg>
    )
}
