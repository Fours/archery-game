import * as THREE from 'three'

const TARGET_RADIUS = 0.35
const RING_SEGMENTS = 40
const BACKING_RADIUS = 0.40
const BACKING_THICKNESS = 0.05

// Decorative tier ring sits just outside the bullseye and indicates score multiplier.
const TIER_RING_RADIUS = 0.43
const TIER_RING_TUBE = 0.025

// Bands ordered innermost → outermost. Score is awarded for the smallest band whose
// outer radius covers the hit; outermost band's `outer` is also the overall TARGET_RADIUS.
const BANDS = [
    { inner: 0,    outer: 0.05, color: 0xfff04a, score: 100 },
    { inner: 0.05, outer: 0.12, color: 0xc8332c, score: 50 },
    { inner: 0.12, outer: 0.22, color: 0xf2efe6, score: 25 },
    { inner: 0.22, outer: TARGET_RADIUS, color: 0x2b4f8c, score: 10 },
]

const COOLING_TIME = 0.45
const RELOAD_TIME = 0.55
const RELOAD_SPIN_TURNS = 2
const MAX_HITS = 5

export type Tier = 'green' | 'blue' | 'purple'

const TIER_COLOR: Record<Tier, number> = {
    green: 0x35c44a,
    blue: 0x2c6ee0,
    purple: 0x8e3ad1,
}

// Darkened tier colors shown on the ring after a target is permanently disabled.
const TIER_DARK_COLOR: Record<Tier, number> = {
    green: 0x0d3112,
    blue: 0x0b1b38,
    purple: 0x230e34,
}

const TIER_MULTIPLIER: Record<Tier, number> = {
    green: 1,
    blue: 2,
    purple: 3,
}

export interface TargetHit {
    point: THREE.Vector3
    score: number
    /** Tier score multiplier applied to the base band score (1, 2, or 3). */
    multiplier: number
    /** Parametric position along the segment from→to where the hit occurred. */
    t: number
}

type State = 'idle' | 'cooling' | 'reloading' | 'disabled'

/**
 * A bullseye target. The target faces local +Z, which is the direction the player
 * must shoot from for a hit to register. The colored outer ring (green/blue/purple)
 * indicates the target's score multiplier and stays put even when the bullseye is
 * destroyed; the bullseye itself shatters on hit and respawns with a spin.
 */
export class Target {
    readonly object: THREE.Group
    private bullseye: THREE.Group
    private ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>
    private tier: Tier
    private multiplier: number
    private state: State = 'idle'
    private stateTime = 0
    private hitCount = 0

    constructor(position: THREE.Vector3, tier: Tier) {
        this.tier = tier
        this.multiplier = TIER_MULTIPLIER[tier]

        this.object = new THREE.Group()
        this.object.position.copy(position)

        // The bullseye is the part that gets hidden + respawned; it owns the wooden
        // backing and all scoring rings. The persistent tier ring is a sibling.
        this.bullseye = new THREE.Group()
        this.object.add(this.bullseye)

        const backing = new THREE.Mesh(
            new THREE.CylinderGeometry(BACKING_RADIUS, BACKING_RADIUS, BACKING_THICKNESS, 32),
            new THREE.MeshStandardMaterial({ color: 0x3d2812, roughness: 0.9 }),
        )
        // CylinderGeometry runs along Y; rotate so flat face points along +Z.
        backing.rotation.x = Math.PI / 2
        backing.position.z = -BACKING_THICKNESS / 2
        backing.castShadow = true
        backing.receiveShadow = true
        this.bullseye.add(backing)

        // Concentric scoring rings. Tiny z offset per ring avoids z-fighting.
        BANDS.forEach((b, i) => {
            const geom: THREE.BufferGeometry =
                b.inner === 0
                    ? new THREE.CircleGeometry(b.outer, RING_SEGMENTS)
                    : new THREE.RingGeometry(b.inner, b.outer, RING_SEGMENTS)
            const mesh = new THREE.Mesh(
                geom,
                new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.85 }),
            )
            mesh.position.z = 0.001 * (i + 1)
            this.bullseye.add(mesh)
        })

        // Tier ring: small torus encircling the bullseye in the tier's color.
        // Lives outside `bullseye` so it survives explosions.
        this.ring = new THREE.Mesh(
            new THREE.TorusGeometry(TIER_RING_RADIUS, TIER_RING_TUBE, 12, 40),
            new THREE.MeshStandardMaterial({
                color: TIER_COLOR[tier],
                roughness: 0.4,
                metalness: 0.25,
                emissive: TIER_COLOR[tier],
                emissiveIntensity: 0.18,
            }),
        )
        this.ring.position.z = 0.01
        this.ring.castShadow = true
        this.object.add(this.ring)
    }

    /**
     * Test whether the segment from→to (in world space) crosses this target's disk
     * coming from the +Z front face. Returns the hit point, multiplied score, and
     * segment-t if so, otherwise null. While cooling/reloading the target ignores
     * arrows entirely.
     */
    testHit(from: THREE.Vector3, to: THREE.Vector3): TargetHit | null {
        if (this.state !== 'idle') return null

        const localFrom = this.object.worldToLocal(from.clone())
        const localTo = this.object.worldToLocal(to.clone())

        // Front face is local z >= 0; arrow must travel from front to back.
        if (localFrom.z <= 0 || localTo.z > 0) return null

        const t = localFrom.z / (localFrom.z - localTo.z)
        if (t < 0 || t > 1) return null

        const lx = localFrom.x + (localTo.x - localFrom.x) * t
        const ly = localFrom.y + (localTo.y - localFrom.y) * t
        const r = Math.hypot(lx, ly)
        if (r > TARGET_RADIUS) return null

        const score = scoreForRadius(r) * this.multiplier
        const point = this.object.localToWorld(new THREE.Vector3(lx, ly, 0))
        return { point, score, multiplier: this.multiplier, t }
    }

    /** Mark the target as just-hit. Hides the bullseye for the cooling + reload phases. */
    onHit(): void {
        this.bullseye.visible = false
        this.state = 'cooling'
        this.stateTime = 0
        this.hitCount++
    }

    /** Advance the hit→reload→idle state machine. */
    update(dt: number): void {
        if (this.state === 'idle' || this.state === 'disabled') return

        this.stateTime += dt

        if (this.state === 'cooling') {
            if (this.stateTime >= COOLING_TIME) {
                if (this.hitCount >= MAX_HITS) {
                    // Permanently disabled: bullseye stays hidden and the tier ring
                    // dims to its dark variant so the player can read remaining targets.
                    this.state = 'disabled'
                    this.stateTime = 0
                    const dark = TIER_DARK_COLOR[this.tier]
                    this.ring.material.color.setHex(dark)
                    this.ring.material.emissive.setHex(dark)
                    return
                }
                this.state = 'reloading'
                this.stateTime = 0
                // Pose at the reload start before unhiding so we don't flash
                // a full-size bullseye for one frame.
                this.bullseye.scale.setScalar(0.1)
                this.bullseye.rotation.z = 0
                this.bullseye.visible = true
            }
            return
        }

        // Reloading: ease scale from 0.1→1 and spin around the disk's normal axis,
        // landing at full size with identity rotation.
        const t = Math.min(this.stateTime / RELOAD_TIME, 1)
        const ease = 1 - (1 - t) * (1 - t) // ease-out (quadratic)
        const scale = 0.1 + ease * 0.9
        this.bullseye.scale.setScalar(scale)
        this.bullseye.rotation.z = ease * Math.PI * 2 * RELOAD_SPIN_TURNS

        if (t >= 1) {
            this.state = 'idle'
            this.bullseye.scale.setScalar(1)
            this.bullseye.rotation.z = 0
        }
    }

    dispose(): void {
        this.object.traverse((obj) => {
            const mesh = obj as THREE.Mesh
            if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
                mesh.geometry.dispose()
            }
            const mat = mesh.material
            if (Array.isArray(mat)) {
                mat.forEach((m) => m.dispose())
            } else if (mat && typeof (mat as THREE.Material).dispose === 'function') {
                ;(mat as THREE.Material).dispose()
            }
        })
    }
}

function scoreForRadius(r: number): number {
    for (const b of BANDS) {
        if (r <= b.outer) return b.score
    }
    return 0
}
