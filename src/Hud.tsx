import { ROUND_DURATION } from './game/Game'
import { ScoreDigits } from './ScoreDigits'
import { useCountUp } from './useCountUp'

/** Seconds left at which the timer turns amber, then red and starts ticking. */
const WARN_TIME = 30
const DANGER_TIME = 10
/** Seconds left at which a big countdown appears in the middle of the screen. */
const FINAL_COUNTDOWN = 5

type HudProps = {
    score: number
    timeLeft: number
    locked: boolean
    gameOver: boolean
}

export function Hud({ score, timeLeft, locked, gameOver }: HudProps) {
    const shownScore = useCountUp(score)

    const timerState = timeLeft <= DANGER_TIME ? 'danger' : timeLeft <= WARN_TIME ? 'warn' : ''
    const paused = !locked && !gameOver && timeLeft < ROUND_DURATION
    const minutes = Math.floor(timeLeft / 60)
    const seconds = String(timeLeft % 60).padStart(2, '0')

    return (
        <>
            <div className={`hud ${gameOver ? 'hud-hidden' : ''}`}>
                <div className={`plaque hud-panel timer ${timerState}`}>
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

                <div className="plaque hud-panel score">
                    <span className="hud-label">Score</span>
                    <span key={score} className={`hud-value ${score > 0 ? 'pop' : ''}`}>
                        <ScoreDigits value={shownScore} />
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
