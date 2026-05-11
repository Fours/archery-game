import * as THREE from 'three'
import { Bow } from './Bow'
import { createFletching } from './fletching'

const SCALE = 2

// ~23° back lean, shared by bows and quiver. Pre-derived position constants
// below place the bottom (or lower tip) on the ground at y=0 and the contact
// surface against the counter top edge at world y≈0.95, z=FRONT_Z=-2.
const LEAN = 0.4

// Bow grip (group origin) for scale 2 + rot.x = -LEAN with lower tip on ground.
//   y_g = 1.1*cos(LEAN) + 0.12*sin(LEAN)            (lower tip → y=0)
//   z_g = -2 + 0.95*tan(LEAN) - 1.1*sin(LEAN) + 0.12*cos(LEAN)   (touches railing)
const BOW_Y_G = 1.06
const BOW_Z_G = -1.915

const QUIVER_HEIGHT = 0.55      // local; world height = 1.1 at scale 2
const QUIVER_RADIUS_TOP = 0.075
const QUIVER_RADIUS_BOTTOM = 0.06
const QUIVER_COLOR = 0x4a2e10
const QUIVER_TRIM_COLOR = 0x1f140a
// Quiver center for scale 2 + rot.x = -LEAN, bottom on ground, top contacting
// the counter top edge near y=0.95 along the cylinder's axis.
const QUIVER_Y_G = 0.508
const QUIVER_Z_G = -1.813

const ARROW_SHAFT_LEN = 0.7
const ARROW_SHAFT_RADIUS = 0.01
const ARROW_SHAFT_COLOR = 0x9c6b3c
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

const BOW_X_POSITIONS = [-4.6, -3.8, 4.6] // two left front, one right front
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
    private disposableGeos: THREE.BufferGeometry[] = []
    private disposableMats: THREE.Material[] = []

    constructor() {
        this.group = new THREE.Group()
        this.addBows()
        this.addQuiver()
    }

    private addBows(): void {
        for (const x of BOW_X_POSITIONS) {
            const bow = new Bow()
            bow.group.scale.setScalar(SCALE)
            bow.group.rotation.x = -LEAN
            bow.group.position.set(x, BOW_Y_G, BOW_Z_G)
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
            const arrow = makeQuiverArrow(
                spec.fletchColor,
                this.disposableGeos,
                this.disposableMats,
            )
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
        for (const g of this.disposableGeos) g.dispose()
        for (const m of this.disposableMats) m.dispose()
    }
}

/**
 * Build a single quiver arrow. The shaft is laid out with tip toward -Z and
 * tail at z=0 (the same convention as the player's nocked arrow); the whole
 * group is then rotated so the tip points toward -Y and the tail sits at the
 * group's origin. Caller positions the group at the desired tail location in
 * the quiver's local frame.
 */
function makeQuiverArrow(
    fletchColor: number,
    geos: THREE.BufferGeometry[],
    mats: THREE.Material[],
): THREE.Group {
    const arrow = new THREE.Group()
    // 'YXZ' so the caller's rotation.y spins the arrow around its long axis
    // (the world Y after rotation.x = -π/2) instead of swinging the tip
    // away from -Y. With default 'XYZ' the composition is Rx*Ry, which
    // makes Ry tip the *already-down* arrow back toward the horizontal.
    arrow.rotation.order = 'YXZ'

    const shaftGeo = new THREE.CylinderGeometry(
        ARROW_SHAFT_RADIUS,
        ARROW_SHAFT_RADIUS,
        ARROW_SHAFT_LEN,
        8,
    )
    const shaftMat = new THREE.MeshStandardMaterial({
        color: ARROW_SHAFT_COLOR,
        roughness: 0.7,
    })
    const shaft = new THREE.Mesh(shaftGeo, shaftMat)
    shaft.rotation.x = Math.PI / 2
    shaft.position.z = -ARROW_SHAFT_LEN / 2
    arrow.add(shaft)
    geos.push(shaftGeo)
    mats.push(shaftMat)

    const fletching = createFletching(fletchColor)
    arrow.add(fletching)
    // createFletching builds geom + material per call; track them so dispose()
    // can release them along with the rest.
    fletching.traverse((obj) => {
        const m = obj as THREE.Mesh
        if (m.geometry && typeof m.geometry.dispose === 'function') {
            geos.push(m.geometry)
        }
        const mat = m.material as THREE.Material | undefined
        if (mat && typeof mat.dispose === 'function') {
            mats.push(mat)
        }
    })

    // -Z (arrow forward) → -Y so the tip drops into the quiver.
    arrow.rotation.x = -Math.PI / 2

    return arrow
}
