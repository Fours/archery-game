import * as THREE from 'three'
import { ARROW_LENGTH, ArrowModel } from './ArrowModel'

const GRAVITY = 22
// How far the tip sinks into the ground past the contact point.
const GROUND_EMBED = 0.06

export class Arrow {
    readonly object: THREE.Group
    /** Broadhead point last frame and this frame: the segment to test for hits.
     *  (`object.position` is the nock end, ARROW_LENGTH behind the tip.) */
    readonly prevTip = new THREE.Vector3()
    readonly tip = new THREE.Vector3()
    private velocity = new THREE.Vector3()
    private stuck = false

    private model = new ArrowModel({ castShadow: true })

    constructor() {
        this.object = this.model.group
    }

    get isStuck(): boolean {
        return this.stuck
    }

    launch(origin: THREE.Vector3, direction: THREE.Vector3, speed: number): void {
        this.object.position.copy(origin)
        this.alignTo(direction)
        this.velocity.copy(direction).setLength(speed)
        this.updateTip()
        this.prevTip.copy(this.tip)
        this.stuck = false
    }

    /** Integrate physics for this frame. Caller is responsible for sticking
     *  the arrow on hit (use `prevTip` and `tip` as the segment). */
    update(dt: number): void {
        if (this.stuck) return
        this.prevTip.copy(this.tip)
        this.velocity.y -= GRAVITY * dt
        this.object.position.addScaledVector(this.velocity, dt)
        this.alignTo(this.velocity)
        this.updateTip()
    }

    /** Pin the arrow where its tip crossed y = 0 this frame, with the tip
     *  embedded GROUND_EMBED along the travel direction and the shaft and
     *  fletching left standing above the ground. */
    stickToGround(): void {
        const dir = this.velocity.clone().normalize()
        const fy = this.prevTip.y
        const t = fy > this.tip.y ? Math.min(1, Math.max(0, fy / (fy - this.tip.y))) : 1
        this.tip.lerpVectors(this.prevTip, this.tip, t).addScaledVector(dir, GROUND_EMBED)
        this.object.position.copy(this.tip).addScaledVector(dir, -ARROW_LENGTH)
        this.alignTo(dir)
        this.stuck = true
    }

    private updateTip(): void {
        this.tip.copy(this.velocity).setLength(ARROW_LENGTH).add(this.object.position)
    }

    private alignTo(direction: THREE.Vector3): void {
        // The arrow's local -Z is its tip, but Object3D.lookAt turns a
        // non-camera object's +Z toward the target — so look *away* from travel.
        const target = this.object.position.clone().sub(direction)
        this.object.lookAt(target)
    }

    dispose(): void {
        this.model.dispose()
    }
}
