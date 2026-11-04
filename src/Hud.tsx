import { useEffect, useRef, useState } from 'react'
import { ROUND_DURATION } from './game/Game'

/** Seconds left at which the timer turns amber, then red and starts ticking. */
const WARN_TIME = 30
const DANGER_TIME = 10
/** Seconds left at which a big countdown appears in the middle of the screen. */
const FINAL_COUNTDOWN = 5
/** Score is shown zero-padded to this many digits, arcade style. */
const SCORE_DIGITS = 6
const COUNT_UP_MS = 450

type HudProps = {
    score: number
    timeLeft: number
    locked: boolean
    gameOver: boolean
}

export function Hud({ score, timeLeft, locked, gameOver }: HudProps) {
    const shownScore = useCountUp(score)
    const padded = String(shownScore).padStart(SCORE_DIGITS, '0')
    const leadLength = shownScore === 0 ? SCORE_DIGITS - 1 : SCORE_DIGITS - String(shownScore).length

    const timerState = timeLeft <= DANGER_TIME ? 'danger' : timeLeft <= WARN_TIME ? 'warn' : ''
    const paused = !locked && !gameOver && timeLeft < ROUND_DURATION
    const minutes = Math.floor(timeLeft / 60)
    const seconds = String(timeLeft % 60).padStart(2, '0')

    return (
        <>
            <div className={`hud ${gameOver ? 'hud-hidden' : ''}`}>
                <div className={`hud-panel timer ${timerState}`}>
                    <span className="hud-label">{paused ? 'Paused' : 'Time'}</span>
                    <span
                        key={timerState === 'danger' ? timeLeft : 'steady'}
                        className={`hud-value ${timerState === 'danger' ? 'tick' : ''}`}
                    >
                        <span className="num">
                            {minutes}:{seconds}
                        </span>
                    </span>
                    <div className="timer-bar">
                        <div className="timer-fill" style={{ width: `${(timeLeft / ROUND_DURATION) * 100}%` }} />
                    </div>
                </div>

                <div className="hud-panel score">
                    <span className="hud-label">Score</span>
                    <span key={score} className={`hud-value ${score > 0 ? 'pop' : ''}`}>
                        <span className="lead">{padded.slice(0, leadLength)}</span>
                        <span className="num">{padded.slice(leadLength)}</span>
                    </span>
                </div>
            </div>

            {locked && !gameOver && timeLeft > 0 && timeLeft <= FINAL_COUNTDOWN && (
                <div key={timeLeft} className="final-countdown">
                    {timeLeft}
                </div>
            )}
        </>
    )
}

/** Animates the displayed value toward `target`; drops (e.g. a restart) snap instantly. */
function useCountUp(target: number): number {
    const [shown, setShown] = useState(target)
    const shownRef = useRef(target)

    useEffect(() => {
        const from = shownRef.current
        if (from === target) return
        const duration = target < from ? 0 : COUNT_UP_MS
        const start = performance.now()
        let frame = 0
        const step = (now: number) => {
            const k = duration === 0 ? 1 : Math.min(1, (now - start) / duration)
            const eased = 1 - Math.pow(1 - k, 3)
            const value = Math.round(from + (target - from) * eased)
            shownRef.current = value
            setShown(value)
            if (k < 1) frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
        return () => cancelAnimationFrame(frame)
    }, [target])

    return shown
}
