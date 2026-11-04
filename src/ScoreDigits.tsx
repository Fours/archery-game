/** Score is shown zero-padded to this many digits, arcade style. */
const SCORE_DIGITS = 6

/** Zero-padded score with the leading zeros dimmed; place inside a `.hud-value`. */
export function ScoreDigits({ value }: { value: number }) {
    const padded = String(value).padStart(SCORE_DIGITS, '0')
    const leadLength = value === 0 ? SCORE_DIGITS - 1 : SCORE_DIGITS - String(value).length
    return (
        <>
            <span className="lead">{padded.slice(0, leadLength)}</span>
            <span className="num">{padded.slice(leadLength)}</span>
        </>
    )
}
