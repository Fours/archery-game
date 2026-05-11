import * as THREE from 'three'
import { TIER_DARK_COLOR } from './Target'
import type { Target, Tier } from './Target'

const BAR_RADIUS = 0.04
// Matches TIER_RING_RADIUS in Target.ts — the bar segments butt up against
// the outer ring of each target, so they share this radius.
const TARGET_RING_OUTER = 0.43
const WALL_INSET = 0.03

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
    /** Used to color the connecting bars (uses the tier's dark color). */
    tier: Tier
    /** Booth half-width — bar endpoints attach at the side walls. */
    halfWidth: number
}

/**
 * A horizontal row of targets that slides along X within fixed bounds, bouncing off
 * each end. The row keeps the spacing between its targets fixed; only the row's
 * center moves. Y and Z are constant per row.
 *
 * The row also owns N+1 connecting cylinder segments (`barsGroup`) that visually
 * link the targets to each other and to the side walls. Inter-target segments
 * have a fixed length and slide with the row; the two outer segments dynamically
 * stretch/shrink as the row moves so the wall and ring contact points stay glued.
 */
export class TargetRow {
    readonly targets: Target[]
    readonly barsGroup: THREE.Group
    private bars: THREE.Mesh[] = []
    private barGeo: THREE.BufferGeometry
    private barMat: THREE.Material
    private offsets: number[]
    private y: number
    private z: number
    private speed: number
    private direction: 1 | -1
    private minCenter: number
    private maxCenter: number
    private centerX: number
    private halfWidth: number

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
        this.halfWidth = opts.halfWidth

        this.barsGroup = new THREE.Group()
        // Unit-length cylinder pre-rotated to lie along X. Each bar mesh sets
        // its own length via mesh.scale.x.
        this.barGeo = new THREE.CylinderGeometry(BAR_RADIUS, BAR_RADIUS, 1, 8)
        this.barGeo.rotateZ(Math.PI / 2)
        this.barMat = new THREE.MeshStandardMaterial({
            color: TIER_DARK_COLOR[opts.tier],
            roughness: 0.7,
            metalness: 0.3,
        })

        const numBars = this.targets.length + 1
        for (let i = 0; i < numBars; i++) {
            const bar = new THREE.Mesh(this.barGeo, this.barMat)
            bar.castShadow = true
            bar.position.y = this.y
            bar.position.z = this.z
            this.barsGroup.add(bar)
            this.bars.push(bar)
        }

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

        // Build the alternating list of bar endpoints along X:
        //   [left-wall, target0_left_ring, target0_right_ring, target1_left_ring, ..., right-wall]
        // 2*N + 2 entries → N+1 segment pairs.
        const xs: number[] = [-this.halfWidth + WALL_INSET]
        for (const off of this.offsets) {
            xs.push(this.centerX + off - TARGET_RING_OUTER)
            xs.push(this.centerX + off + TARGET_RING_OUTER)
        }
        xs.push(this.halfWidth - WALL_INSET)

        for (let i = 0; i < this.bars.length; i++) {
            const x0 = xs[2 * i]
            const x1 = xs[2 * i + 1]
            const len = Math.max(0, x1 - x0)
            const bar = this.bars[i]
            bar.position.x = (x0 + x1) / 2
            bar.scale.x = len
        }
    }

    dispose(): void {
        this.barGeo.dispose()
        this.barMat.dispose()
    }
}
