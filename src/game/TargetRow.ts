import type { Target } from './Target'

interface RowOptions {
    targets: Target[]
    /** X offset of each target relative to the row's center. */
    offsets: number[]
    y: number
    z: number
    /** Speed in m/s of the row's center along X. */
    speed: number
    /** Initial direction: +1 moves right, -1 moves left. */
    direction: 1 | -1
    /** Allowed center-X range; reaching either end reverses direction. */
    bounds: { min: number; max: number }
    /** Initial center-X position; defaults to 0. */
    startCenterX?: number
}

/**
 * A horizontal row of targets that slides along X within fixed bounds, bouncing off
 * each end. The row keeps the spacing between its targets fixed; only the row's
 * center moves. Y and Z are constant per row.
 */
export class TargetRow {
    readonly targets: Target[]
    private offsets: number[]
    private y: number
    private z: number
    private speed: number
    private direction: 1 | -1
    private minCenter: number
    private maxCenter: number
    private centerX: number

    constructor(opts: RowOptions) {
        this.targets = opts.targets
        this.offsets = opts.offsets
        this.y = opts.y
        this.z = opts.z
        this.speed = opts.speed
        this.direction = opts.direction
        this.minCenter = opts.bounds.min
        this.maxCenter = opts.bounds.max
        this.centerX = opts.startCenterX ?? 0
        this.applyPositions()
    }

    update(dt: number): void {
        this.centerX += this.direction * this.speed * dt
        if (this.centerX >= this.maxCenter) {
            this.centerX = this.maxCenter
            this.direction = -1
        } else if (this.centerX <= this.minCenter) {
            this.centerX = this.minCenter
            this.direction = 1
        }
        this.applyPositions()
    }

    private applyPositions(): void {
        for (let i = 0; i < this.targets.length; i++) {
            this.targets[i].object.position.set(
                this.centerX + this.offsets[i],
                this.y,
                this.z,
            )
        }
    }
}
