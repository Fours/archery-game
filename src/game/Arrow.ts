import * as THREE from 'three'
import { createFletching } from './fletching'

const GRAVITY = 22
const SHAFT_LENGTH = 0.75
const SHAFT_RADIUS = 0.012
const TIP_LENGTH = 0.08

export class Arrow {
    readonly object: THREE.Group
    readonly prevPosition = new THREE.Vector3()
    private velocity = new THREE.Vector3()
    private stuck = false

    constructor() {
        const group = new THREE.Group()

        const shaft = new THREE.Mesh(
            new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 10),
            new THREE.MeshStandardMaterial({ color: 0x9c6b3c, roughness: 0.7 }),
        )
        // CylinderGeometry runs along Y by default; rotate so it lies along Z.
        // Position so the tail is at z=0 and the body extends toward -Z.
        shaft.rotation.x = Math.PI / 2
        shaft.position.z = -SHAFT_LENGTH / 2
        shaft.castShadow = true
        group.add(shaft)

        const tip = new THREE.Mesh(
            new THREE.ConeGeometry(0.022, TIP_LENGTH, 10),
            new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.7, roughness: 0.3 }),
        )
        tip.rotation.x = -Math.PI / 2
        tip.position.z = -SHAFT_LENGTH - TIP_LENGTH / 2
        tip.castShadow = true
        group.add(tip)

        group.add(createFletching())

        this.object = group
    }

    get isStuck(): boolean {
        return this.stuck
    }

    launch(origin: THREE.Vector3, direction: THREE.Vector3, speed: number): void {
        this.object.position.copy(origin)
        this.prevPosition.copy(origin)
        this.alignTo(direction)
        this.velocity.copy(direction).setLength(speed)
        this.stuck = false
    }

    /** Integrate physics for this frame. Caller is responsible for sticking
     *  the arrow on hit (use `prevPosition` and `object.position` as the segment). */
    update(dt: number): void {
        if (this.stuck) return
        this.prevPosition.copy(this.object.position)
        this.velocity.y -= GRAVITY * dt
        this.object.position.addScaledVector(this.velocity, dt)
        this.alignTo(this.velocity)
    }

    /** Snap to the ground plane and embed the tip slightly along travel direction. */
    stickToGround(): void {
        const dir = this.velocity.clone().normalize()
        this.object.position.y = 0
        this.object.position.addScaledVector(dir, 0.06)
        this.alignTo(this.velocity)
        this.stuck = true
    }

    private alignTo(direction: THREE.Vector3): void {
        // The arrow's local -Z is its tip; lookAt orients local -Z toward target.
        const target = this.object.position.clone().add(direction)
        this.object.lookAt(target)
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
