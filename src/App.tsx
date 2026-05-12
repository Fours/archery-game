import { useEffect, useRef, useState } from 'react'
import './App.css'
import { Game } from './game/Game'
import logo from "./assets/archery-blitz-logo.png"

function App() {
    const containerRef = useRef<HTMLDivElement>(null)
    const gameRef = useRef<Game | null>(null)
    const [locked, setLocked] = useState(false)
    const [score, setScore] = useState(0)
    const [gameOver, setGameOver] = useState(false)
    const [timeLeft, setTimeLeft] = useState(120)

    useEffect(() => {
        if (!containerRef.current) return
        const game = new Game(containerRef.current, setLocked, setScore, setGameOver, setTimeLeft)
        gameRef.current = game
        return () => {
            game.dispose()
            gameRef.current = null
        }
    }, [])

    return (
        <div
            ref={containerRef}
            className="game-root"
            onClick={() => {
                if (gameOver) return
                gameRef.current?.requestLock()
            }}
        >
            {!locked && !gameOver && (
                <div className="overlay">
                    <div className="card">
                        <img src={logo} />
                        <p>Click to play</p>
                        <p className="hint">
                            Mouse to aim · Hold SPACE to draw the bow · Release to fire · ESC to free the cursor
                        </p>
                    </div>
                </div>
            )}
            {gameOver && (
                <div className="overlay">
                    <div className="card game-over">
                        <h1>Game Over</h1>
                        <p className="final-score-label">Final Score</p>
                        <p className="final-score">{score}</p>
                        <button
                            className="new-game"
                            onClick={(e) => {
                                e.stopPropagation()
                                gameRef.current?.restart()
                            }}
                        >
                            New Game
                        </button>
                    </div>
                </div>
            )}
            <div className="timer">TIME LEFT: {timeLeft}</div>
            <div className="score">SCORE: {score}</div>
            {!gameOver && <div className="crosshair" />}
        </div>
    )
}

export default App
