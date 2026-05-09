import * as THREE from 'three'
import { createFletching } from './fletching'

const BOW_HALF_HEIGHT = 0.55
const LIMB_RADIUS = 0.012
const STRING_RADIUS = 0.0025
const STRING_REST_OFFSET = 0.05
const STRING_MAX_DRAW = 0.55
const NOCKED_SHAFT_LEN = 0.7

const UPPER_TIP = new THREE.Vector3(0, BOW_HALF_HEIGHT, -0.06)
const LOWER_TIP = new THREE.Vector3(0, -BOW_HALF_HEIGHT, -0.06)
const CYLINDER_AXIS = new THREE.Vector3(0, 1, 0)

export class Bow {
    readonly group: THREE.Group
    private upperString: THREE.Mesh
    private lowerString: THREE.Mesh
    private nockedArrow: THREE.Group
    private nock = new THREE.Vector3()

    constructor() {
        this.group = new THREE.Group()

        const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a2e10, roughness: 0.85 })
        const gripMat = new THREE.MeshStandardMaterial({ color: 0x1f140a, roughness: 0.95 })
        const stringMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 })

        const grip = new THREE.Mesh(
            new THREE.CylinderGeometry(0.025, 0.025, 0.18, 12),
            gripMat,
        )
        this.group.add(grip)

        // The bow is held with its plane perpendicular to the aim direction.
        // Limbs curve toward -Z (away from the archer); string sits at +Z (toward archer).
        const upperCurve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(0, 0.09, 0),
            new THREE.Vector3(0, BOW_HALF_HEIGHT * 0.55, -0.12),
            UPPER_TIP.clone(),
        )
        const lowerCurve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(0, -0.09, 0),
            new THREE.Vector3(0, -BOW_HALF_HEIGHT * 0.55, -0.12),
            LOWER_TIP.clone(),
        )
        this.group.add(
            new THREE.Mesh(new THREE.TubeGeometry(upperCurve, 16, LIMB_RADIUS, 8, false), woodMat),
        )
        this.group.add(
            new THREE.Mesh(new THREE.TubeGeometry(lowerCurve, 16, LIMB_RADIUS, 8, false), woodMat),
        )

        // String as two thin cylinders: upper-tip → nock and nock → lower-tip.
        // (LineBasicMaterial.linewidth is ignored on most WebGL implementations.)
        const stringGeom = new THREE.CylinderGeometry(STRING_RADIUS, STRING_RADIUS, 1, 6)
        this.upperString = new THREE.Mesh(stringGeom, stringMat)
        this.lowerString = new THREE.Mesh(stringGeom, stringMat)
        this.group.add(this.upperString, this.lowerString)

        this.nockedArrow = createNockedArrowMesh()
        this.nockedArrow.visible = false
        this.group.add(this.nockedArrow)

        this.setDraw(0)
    }

    /** Set draw amount in [0, 1]. */
    setDraw(amount: number): void {
        const a = Math.max(0, Math.min(1, amount))
        const nockZ = STRING_REST_OFFSET + STRING_MAX_DRAW * a
        this.nock.set(0, 0, nockZ)

        positionSegment(this.upperString, UPPER_TIP, this.nock)
        positionSegment(this.lowerString, this.nock, LOWER_TIP)

        if (a > 0) {
            this.nockedArrow.visible = true
            this.nockedArrow.position.copy(this.nock)
        } else {
            this.nockedArrow.visible = false
        }
    }

    dispose(): void {
        this.group.traverse((obj) => {
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

/** Place a unit-length-Y cylinder so it spans from `a` to `b`. */
function positionSegment(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    const dir = b.clone().sub(a)
    const len = dir.length()
    mesh.position.copy(a).addScaledVector(dir, 0.5)
    mesh.scale.set(1, len, 1)
    if (len > 1e-6) {
        mesh.quaternion.setFromUnitVectors(CYLINDER_AXIS, dir.divideScalar(len))
    }
}

function createNockedArrowMesh(): THREE.Group {
    const group = new THREE.Group()

    const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.01, NOCKED_SHAFT_LEN, 8),
        new THREE.MeshStandardMaterial({ color: 0x9c6b3c, roughness: 0.7 }),
    )
    shaft.rotation.x = Math.PI / 2
    shaft.position.z = -NOCKED_SHAFT_LEN / 2
    group.add(shaft)

    const tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.018, 0.06, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.6, roughness: 0.4 }),
    )
    tip.rotation.x = -Math.PI / 2
    tip.position.z = -NOCKED_SHAFT_LEN - 0.03
    group.add(tip)

    group.add(createFletching())

    return group
}
