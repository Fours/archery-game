import { useEffect, useRef, useState } from 'react'
import './App.css'
import { Game, ROUND_DURATION } from './game/Game'
import { Hud } from './Hud'
import { GameOverScreen, StartScreen } from './Screens'
import { SoundToggle } from './SoundToggle'

function App() {
    const containerRef = useRef<HTMLDivElement>(null)
    const gameRef = useRef<Game | null>(null)
    const [locked, setLocked] = useState(false)
    const [score, setScore] = useState(0)
    const [gameOver, setGameOver] = useState(false)
    const [timeLeft, setTimeLeft] = useState(ROUND_DURATION)
    const [muted, setMuted] = useState(false)

    useEffect(() => {
        if (!containerRef.current) return
        const game = new Game(containerRef.current, setLocked, setScore, setGameOver, setTimeLeft, setMuted)
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
            {!locked && !gameOver && <StartScreen paused={timeLeft < ROUND_DURATION} />}
            {gameOver && <GameOverScreen score={score} onNewGame={() => gameRef.current?.restart()} />}
            <Hud
                score={score}
                timeLeft={timeLeft}
                locked={locked}
                gameOver={gameOver}
            />
            {!gameOver && <div className="crosshair" />}
            <SoundToggle muted={muted} onToggle={() => gameRef.current?.toggleMute()} />
        </div>
    )
}

export default App
