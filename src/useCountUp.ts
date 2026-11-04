import { useEffect, useRef, useState } from 'react'

type CountUpOptions = {
    /** Value shown on mount; defaults to `target` (no animation on first render). */
    initial?: number
    durationMs?: number
}

/** Animates the displayed value toward `target`; drops (e.g. a restart) snap instantly. */
export function useCountUp(target: number, { initial = target, durationMs = 450 }: CountUpOptions = {}): number {
    const [shown, setShown] = useState(initial)
    const shownRef = useRef(initial)

    useEffect(() => {
        const from = shownRef.current
        if (from === target) return
        const duration = target < from ? 0 : durationMs
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
    }, [target, durationMs])

    return shown
}
