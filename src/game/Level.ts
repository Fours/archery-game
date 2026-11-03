import * as THREE from 'three'
import { HALF_WIDTH } from './Booth'
import type { LevelConfig } from './levels'
import { RowFlags } from './RowFlags'
import { Target } from './Target'
import { TargetRow } from './TargetRow'

export interface LevelHit {
    t: number
    point: THREE.Vector3
    score: number
    multiplier: number
    target: Target
}

/**
 * Everything that belongs to a single level: the targets, the rows that slide
 * them (plus their connecting bars), and the wall multiplier flags. All of it
 * lives under one `group`, so `Game` swaps levels by removing that group and
 * calling `dispose()`.
 */
export class Level {
    readonly config: LevelConfig
    readonly group: THREE.Group
    private rows: TargetRow[] = []
    private targets: Target[] = []
    private rowFlags: RowFlags

    constructor(config: LevelConfig) {
        this.config = config
        this.group = new THREE.Group()

        this.rowFlags = new RowFlags(
            config.rows.map((r) => ({ tier: r.tier, z: r.z, y: r.y })),
        )
        this.group.add(this.rowFlags.group)

        this.buildTargetRows()
    }

    private buildTargetRows(): void {
        const { targetsPerRow, targetSpacing, edgePadding } = this.config

        // Center the offsets around 0 so each row's center == row midpoint.
        const totalSpan = (targetsPerRow - 1) * targetSpacing
        const offsets: number[] = []
        for (let i = 0; i < targetsPerRow; i++) {
            offsets.push(-totalSpan / 2 + i * targetSpacing)
        }
        // Center-X bounds so even the outermost target stays inside the side walls.
        const maxOffset = Math.max(...offsets.map((v) => Math.abs(v)))
        const centerLimit = HALF_WIDTH - edgePadding - maxOffset

        for (const cfg of this.config.rows) {
            const targets: Target[] = []
            for (let i = 0; i < targetsPerRow; i++) {
                const t = new Target(new THREE.Vector3(0, cfg.y, cfg.z), cfg.tier)
                this.group.add(t.object)
                targets.push(t)
                this.targets.push(t)
            }
            const row = new TargetRow({
                targets,
                offsets,
                y: cfg.y,
                z: cfg.z,
                speed: cfg.speed,
                direction: cfg.direction,
                bounds: { min: -centerLimit, max: centerLimit },
                startCenterX: clamp(cfg.startCenterX, -centerLimit, centerLimit),
                tier: cfg.tier,
                halfWidth: HALF_WIDTH,
            })
            this.group.add(row.barsGroup)
            this.rows.push(row)
        }
    }

    /** Slide rows, then advance each target's cooling/reload state machine.
     *  Call before arrow hit-tests so collisions use this frame's positions. */
    update(dt: number): void {
        for (const row of this.rows) row.update(dt)
        for (const target of this.targets) target.update(dt)
    }

    /** Earliest target hit along the segment `from → to`, or null. */
    findHit(from: THREE.Vector3, to: THREE.Vector3): LevelHit | null {
        let best: LevelHit | null = null
        for (const target of this.targets) {
            const hit = target.testHit(from, to)
            if (hit && (!best || hit.t < best.t)) {
                best = { t: hit.t, point: hit.point, score: hit.score, multiplier: hit.multiplier, target }
            }
        }
        return best
    }

    /** True once every target has used up its hits. */
    get isComplete(): boolean {
        return this.targets.every((t) => t.isDisabled)
    }

    dispose(): void {
        for (const target of this.targets) target.dispose()
        this.targets = []
        for (const row of this.rows) row.dispose()
        this.rows = []
        this.rowFlags.dispose()
    }
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v))
}
