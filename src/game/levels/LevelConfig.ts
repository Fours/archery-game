import type { Tier } from '../Target'

export interface RowConfig {
    z: number
    y: number
    tier: Tier
    /** Speed in m/s of the row's center along X. */
    speed: number
    /** Initial direction: +1 moves right, -1 moves left. */
    direction: 1 | -1
    /** Initial center-X; clamped to the row's movement bounds. */
    startCenterX: number
}

/** Pure data describing one level's targets. `Level` turns this into scene objects. */
export interface LevelConfig {
    name: string
    rows: RowConfig[]
    targetsPerRow: number
    /** X distance between adjacent targets in a row. */
    targetSpacing: number
    /** Minimum gap between the outermost target and a side wall. */
    edgePadding: number
}
