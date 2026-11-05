import logo from './assets/archery-blitz-logo.jpg'
import { ScoreDigits } from './ScoreDigits'
import { useCountUp } from './useCountUp'

const CONTROLS: { keys: string[]; action: string }[] = [
    { keys: ['Mouse'], action: 'Aim' },
    { keys: ['Hold', 'Space'], action: 'Draw' },
    { keys: ['Release'], action: 'Fire' },
    { keys: ['Esc'], action: 'Pause' },
    { keys: ['M'], action: 'Sound' },
]

/** Title card shown before play and whenever pointer lock is released mid-round. */
export function StartScreen({ paused }: { paused: boolean }) {
    return (
        <div className="overlay">
            <div className="plaque card start">
                <div className="logo-frame">
                    <img src={logo} alt="Archery Blitz" />
                </div>
                <p className="cta">
                    <span className="gold-text">{paused ? 'Click to resume' : 'Click to play'}</span>
                </p>
                <Ornament />
                <ul className="controls">
                    {CONTROLS.map(({ keys, action }) => (
                        <li key={action}>
                            <span className="keys">
                                {keys.map((k) => (
                                    <kbd key={k}>{k}</kbd>
                                ))}
                            </span>
                            <span className="hud-label">{action}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}

export function GameOverScreen({ score, onNewGame }: { score: number; onNewGame: () => void }) {
    const shown = useCountUp(score, { initial: 0, durationMs: 1200 })
    return (
        <div className="overlay game-over-overlay">
            <div className="plaque card game-over">
                <h1>
                    <span className="gold-text">Game Over</span>
                </h1>
                <Ornament />
                <p className="hud-label">Final Score</p>
                <p className="hud-value final-score">
                    <ScoreDigits value={shown} />
                </p>
                <button
                    className="gold-button"
                    onClick={(e) => {
                        e.stopPropagation()
                        onNewGame()
                    }}
                >
                    New Game
                </button>
            </div>
        </div>
    )
}

/** Gold rule with a diamond in the middle, used as a divider on the cards. */
function Ornament() {
    return (
        <div className="ornament" aria-hidden="true">
            <span />
        </div>
    )
}
