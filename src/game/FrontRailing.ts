import * as THREE from 'three'
import { Bow } from './Bow'
import { ArrowModel } from './ArrowModel'

const SCALE = 2

// ~23° back lean, shared by the quiver and the default bow pose. Pre-derived
// position constants below place the bottom (or lower tip) on the ground at
// y=0 and the contact surface against the counter top edge at world y≈0.95,
// z=FRONT_Z=-2.
const LEAN = 0.4

// Bow grip (group origin) for scale 2 + rot.x = -lean with lower tip on ground
// and the back face touching the counter edge. Keeps a leaning bow planted no
// matter its lean angle, so each bow can lean differently.
//   y_g = 1.1*cos(lean) + 0.12*sin(lean)            (lower tip → y=0)
//   z_g = -2 + 0.95*tan(lean) - 1.1*sin(lean) + 0.12*cos(lean)   (touches railing)
function bowPose(lean: number): { y: number; z: number } {
    return {
        y: 1.1 * Math.cos(lean) + 0.12 * Math.sin(lean),
        z: -2 + 0.95 * Math.tan(lean) - 1.1 * Math.sin(lean) + 0.12 * Math.cos(lean),
    }
}

const QUIVER_HEIGHT = 0.55      // local; world height = 1.1 at scale 2
const QUIVER_RADIUS_TOP = 0.075
const QUIVER_RADIUS_BOTTOM = 0.06
const QUIVER_COLOR = 0x4a2e10
const QUIVER_TRIM_COLOR = 0x1f140a
// Quiver center for scale 2 + rot.x = -LEAN, bottom on ground, top contacting
// the counter top edge near y=0.95 along the cylinder's axis.
const QUIVER_Y_G = 0.508
const QUIVER_Z_G = -1.55

// Shrinks the shared arrow model so its tip stays inside the quiver.
const ARROW_SCALE = 0.84
// Arrow tail Y in quiver-local frame. Pushes the fletching well above the rim
// (rim at +QUIVER_HEIGHT/2 = 0.275) while keeping the tip just inside the
// quiver bottom (-0.275).
const ARROW_TAIL_Y_LOCAL = 0.5

interface ArrowSpec {
    x: number
    z: number
    fletchColor: number
}

// Per-arrow offsets in quiver local — clustered near the cylinder axis but
// spread enough that the fletching feathers don't all stack on the same line.
const ARROWS: ArrowSpec[] = [
    { x:  0.000, z:  0.000, fletchColor: 0xd13a3a },
    { x:  0.045, z:  0.020, fletchColor: 0xe6e3d8 },
    { x: -0.045, z:  0.020, fletchColor: 0xf0c040 },
    { x:  0.030, z: -0.040, fletchColor: 0xd13a3a },
    { x: -0.030, z: -0.040, fletchColor: 0xe6e3d8 },
    { x:  0.000, z:  0.045, fletchColor: 0xd13a3a },
    { x:  0.040, z: -0.020, fletchColor: 0xf0c040 },
    { x: -0.040, z: -0.020, fletchColor: 0xd13a3a },
]

interface BowSpec {
    x: number
    lean: number // back-lean about X; bowPose() keeps the tip planted
    yaw?: number // twist about Y so the bow face angles sideways
}

// Two left-front bows and one right-front bow. The front-left bow (nearest the
// player) leans back more and twists outward so the pair reads as two bows
// propped at different angles rather than a mirrored copy.
const BOW_SPECS: BowSpec[] = [
    { x: -4.6, lean: LEAN },
    { x: -3.55, lean: 0.56, yaw: -0.22 },
    { x: 4.6, lean: LEAN },
]
// Sits next to the right bow (x = +4.6) so the right side has a bow + quiver,
// balancing the two bows on the left.
const QUIVER_X = 3.5

/**
 * Decorations leaning on the front counter (the booth's "railing"): two bows
 * in the left front corner, one in the right front corner, and a quiver
 * loaded with arrows. Bows and quiver are at scale 2 to match the corner-bow
 * display, and the arrows' fletching pokes well above the rim.
 */
export class FrontRailing {
    readonly group: THREE.Group
    private bows: Bow[] = []
    private arrows: ArrowModel[] = []
    private disposableGeos: THREE.BufferGeometry[] = []
    private disposableMats: THREE.Material[] = []

    constructor() {
        this.group = new THREE.Group()
        this.addBows()
        this.addQuiver()
    }

    private addBows(): void {
        for (const spec of BOW_SPECS) {
            const bow = new Bow()
            bow.group.scale.setScalar(SCALE)
            // 'YXZ' so the yaw twist spins the bow about its own upright axis
            // before the back-lean, rather than swinging the leaned tip around.
            bow.group.rotation.order = 'YXZ'
            bow.group.rotation.y = spec.yaw ?? 0
            bow.group.rotation.x = -spec.lean
            const { y, z } = bowPose(spec.lean)
            bow.group.position.set(spec.x, y, z)
            this.group.add(bow.group)
            this.bows.push(bow)
        }
    }

    private addQuiver(): void {
        const quiverGroup = new THREE.Group()
        quiverGroup.position.set(QUIVER_X, QUIVER_Y_G, QUIVER_Z_G)
        quiverGroup.rotation.x = -LEAN
        quiverGroup.scale.setScalar(SCALE)

        const bodyGeo = new THREE.CylinderGeometry(
            QUIVER_RADIUS_TOP,
            QUIVER_RADIUS_BOTTOM,
            QUIVER_HEIGHT,
            16,
        )
        const bodyMat = new THREE.MeshStandardMaterial({
            color: QUIVER_COLOR,
            roughness: 0.85,
        })
        const body = new THREE.Mesh(bodyGeo, bodyMat)
        body.castShadow = true
        body.receiveShadow = true
        quiverGroup.add(body)
        this.disposableGeos.push(bodyGeo)
        this.disposableMats.push(bodyMat)

        // Trim ring around the rim (top opening).
        const trimGeo = new THREE.TorusGeometry(QUIVER_RADIUS_TOP, 0.012, 8, 24)
        const trimMat = new THREE.MeshStandardMaterial({
            color: QUIVER_TRIM_COLOR,
            roughness: 0.7,
        })
        const trim = new THREE.Mesh(trimGeo, trimMat)
        // Torus default lives in XY plane (axis +Z); rotate to lie flat
        // around the cylinder axis (+Y).
        trim.rotation.x = Math.PI / 2
        trim.position.y = QUIVER_HEIGHT / 2
        quiverGroup.add(trim)
        this.disposableGeos.push(trimGeo)
        this.disposableMats.push(trimMat)

        for (let i = 0; i < ARROWS.length; i++) {
            const spec = ARROWS[i]
            const model = new ArrowModel({ fletchColor: spec.fletchColor })
            this.arrows.push(model)
            const arrow = makeQuiverArrow(model)
            arrow.position.set(spec.x, ARROW_TAIL_Y_LOCAL, spec.z)
            // Stagger fletching rotation deterministically so feathers face
            // different directions without depending on random.
            arrow.rotation.y = (i / ARROWS.length) * Math.PI * 2
            quiverGroup.add(arrow)
        }

        this.group.add(quiverGroup)
    }

    dispose(): void {
        for (const bow of this.bows) bow.dispose()
        for (const arrow of this.arrows) arrow.dispose()
        for (const g of this.disposableGeos) g.dispose()
        for (const m of this.disposableMats) m.dispose()
    }
}

/**
 * Wrap a quiver arrow model (tip toward -Z, nock at z=0) in a group rotated so
 * the tip points toward -Y and the nock sits at the group's origin. Caller
 * positions the group at the desired tail location in the quiver's local frame.
 */
function makeQuiverArrow(model: ArrowModel): THREE.Group {
    const arrow = new THREE.Group()
    // 'YXZ' so the caller's rotation.y spins the arrow around its long axis
    // (the world Y after rotation.x = -π/2) instead of swinging the tip
    // away from -Y. With default 'XYZ' the composition is Rx*Ry, which
    // makes Ry tip the *already-down* arrow back toward the horizontal.
    arrow.rotation.order = 'YXZ'
    model.group.scale.setScalar(ARROW_SCALE)
    arrow.add(model.group)

    // -Z (arrow forward) → -Y so the tip drops into the quiver.
    arrow.rotation.x = -Math.PI / 2

    return arrow
}
