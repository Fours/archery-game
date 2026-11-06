import { lazy, Suspense, useSyncExternalStore } from 'react'
import './App.css'
import { UnsupportedScreen } from './Screens'

/**
 * Screens where the game can't be played: anything narrower than a small
 * laptop, or a touch-only device (no mouse for pointer lock, no keyboard for
 * Space) — which also catches phones held in landscape.
 */
const UNSUPPORTED_QUERY = '(max-width: 1024px), (hover: none) and (pointer: coarse)'

// Loaded lazily so Three.js and the game code are never downloaded on devices
// that only get the unsupported screen.
const GameView = lazy(() => import('./GameView'))

function subscribe(onChange: () => void) {
    const mql = window.matchMedia(UNSUPPORTED_QUERY)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
}

function isUnsupported() {
    return window.matchMedia(UNSUPPORTED_QUERY).matches
}

function App() {
    const unsupported = useSyncExternalStore(subscribe, isUnsupported)
    if (unsupported) return <UnsupportedScreen />
    return (
        <Suspense fallback={<div className="game-root" />}>
            <GameView />
        </Suspense>
    )
}

export default App
