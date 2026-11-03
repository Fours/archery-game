/**
 * A lazily created, reference-counted resource bundle. The first `acquire()`
 * builds it; the matching last `release()` disposes it. Lets many instances
 * (every fired arrow, every display bow) share one set of geometries,
 * materials and canvas textures without any one owner, while keeping the
 * disposal contract exact: once every holder has released, nothing leaks.
 */
export function sharedResource<T extends { dispose(): void }>(create: () => T): {
    acquire(): T
    release(): void
} {
    let value: T | null = null
    let refs = 0
    return {
        acquire(): T {
            if (!value) value = create()
            refs++
            return value
        },
        release(): void {
            if (refs === 0) return
            refs--
            if (refs === 0 && value) {
                value.dispose()
                value = null
            }
        },
    }
}
