import { useEffect, useRef, useState } from 'react'
import './App.css'
import { Game } from './game/Game'

function App() {
    const containerRef = useRef<HTMLDivElement>(null)
    const gameRef = useRef<Game | null>(null)
    const [locked, setLocked] = useState(false)

    useEffect(() => {
        if (!containerRef.current) return
        const game = new Game(containerRef.current, setLocked)
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
            onClick={() => gameRef.current?.requestLock()}
        >
            {!locked && (
                <div className="overlay">
                    <div className="card">
                        <h1>Archery</h1>
                        <p>Click to play</p>
                        <p className="hint">
                            Mouse to aim · Hold SPACE to draw the bow · Release to fire · ESC to free the cursor
                        </p>
                    </div>
                </div>
            )}
            <div className="crosshair" />
        </div>
    )
}

export default App
