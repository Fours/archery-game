import * as THREE from 'three'
import { BACK_Z, FRONT_Z, HALF_WIDTH } from './Booth'

// Field scatter: full density out to FIELD_NEAR_RADIUS, then density falls off
// as 1/r so the ground cover thins toward FIELD_RADIUS and fades into the fog.
// Because screen-space density rises with distance, 1/r still reads as an
// unbroken meadow on screen while keeping instance counts in the low thousands.
export const FIELD_RADIUS = 150
const FIELD_NEAR_RADIUS = 9
const PLAYER_EXCLUSION_RADIUS = 0.8
// Clearance around the booth footprint; the interior is scattered separately.
const BOOTH_MARGIN = 0.3

// Far instances are scaled up so they stay above a pixel instead of
// shimmering; this is the distance past the near radius that adds 1× scale.
const FAR_SCALE_DISTANCE = 60

export type GroundPoint = {
    x: number
    z: number
    /** Extra scale for distant instances (1 within the near radius). */
    distanceScale: number
}

/** Uniformly scatter `count` points over the booth's interior floor. */
export function scatterBoothInterior(count: number): GroundPoint[] {
    const points: GroundPoint[] = []
    for (let i = 0; i < count; i++) {
        points.push({
            x: THREE.MathUtils.lerp(-HALF_WIDTH + 0.3, HALF_WIDTH - 0.3, Math.random()),
            z: THREE.MathUtils.lerp(BACK_Z + 0.3, FRONT_Z - 0.1, Math.random()),
            distanceScale: 1,
        })
    }
    return points
}

/**
 * Scatter points over the open field around the player at `density` per m²
 * (near the player), skipping the player's feet and the booth footprint.
 */
export function scatterField(density: number): GroundPoint[] {
    const r0 = FIELD_NEAR_RADIUS
    const expected = density * (Math.PI * r0 * r0 + 2 * Math.PI * r0 * (FIELD_RADIUS - r0))
    const count = Math.round(expected)
    const points: GroundPoint[] = []
    let tries = 0
    while (points.length < count && tries < count * 20) {
        tries++
        // Uniform in the disk, then thin with probability r0 / r.
        const r = FIELD_RADIUS * Math.sqrt(Math.random())
        if (r > r0 && Math.random() > r0 / r) continue
        if (r < PLAYER_EXCLUSION_RADIUS) continue
        const theta = Math.random() * Math.PI * 2
        const x = r * Math.cos(theta)
        const z = r * Math.sin(theta)
        const inBooth =
            Math.abs(x) < HALF_WIDTH + BOOTH_MARGIN &&
            z < FRONT_Z + BOOTH_MARGIN &&
            z > BACK_Z - BOOTH_MARGIN
        if (inBooth) continue
        points.push({ x, z, distanceScale: 1 + Math.max(0, r - r0) / FAR_SCALE_DISTANCE })
    }
    return points
}
