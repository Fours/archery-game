import * as THREE from 'three'
import { addRimLight, createBarrelHeadTexture, createStaveTexture } from './materials'
import { BACK_Z, FRONT_Z, HALF_WIDTH } from './Booth'

const SCALE = 2

const BARREL_HEIGHT = 0.9
const BARREL_RADIUS_MID = 0.32
const BARREL_RADIUS_END = 0.28
const SEGMENTS_Y = 12
const SEGMENTS_RADIAL = 32

// Flat iron hoops: thin straps that follow the bulge rather than round wire.
// Pairs near each end (head + quarter hoops), as on a real cask.
const HOOP_WIDTH = 0.04
const HOOP_THICK = 0.006
const HOOP_CENTER_FRACTIONS = [0.06, 0.2, 0.8, 0.94]
const HOOP_SEGMENTS = 4

// Stave wall thickness, visible as end grain around the rim, and how far the
// head sits below the stave ends (the chime).
const STAVE_THICK = 0.022
const HEAD_INSET = 0.018

const N_STAVES = 16

// Tints for the near-white canvas masks.
const STAVE_COLOR = 0x8f5a32
const HEAD_COLOR = 0x80502c
const END_GRAIN_COLOR = 0x4a2c16
const HOOP_COLOR = 0x3a3530

interface BarrelSpec {
    x: number
    z: number
    /** When true, the barrel is rotated 90° about Z and lifted to sit on its bulged side. */
    onSide?: boolean
}

// Offsets account for the doubled radius (0.64 m at scale 2) so each barrel
// clears the booth walls and the front-railing bows.
const BARRELS: BarrelSpec[] = [
    // Inside booth, back-left corner. 0.8 inset from each wall clears the
    // 0.64 m radius with ~16 cm of breathing room.
    { x: -HALF_WIDTH + 0.8, z: BACK_Z + 0.8 },
    // Outside booth, front-left corner — pushed 0.8 m past the left post so
    // the barrel's inner edge stays clear of the side wall at x = -5.
    { x: -HALF_WIDTH - 0.8, z: FRONT_Z + 0.5 },
    // Outside booth, front-left cluster — sits inboard of the post but in
    // front of the booth opening. x = -4.5 keeps the +x edge of the barrel
    // (-3.86) just clear of the front-railing bow at x = -3.8.
    { x: -HALF_WIDTH + 0.5, z: FRONT_Z + 1.5 },
    // Inside booth, back-left area — on its side, long axis parallel to the
    // back wall. Center is in front of the upright back-left barrel (no z
    // overlap with the upright at z = -15.2).
    { x: -3.0, z: -13.5, onSide: true },
    // Outside booth, front-right corner — upright, mirror of the outside
    // front-left barrel.
    { x: HALF_WIDTH + 0.8, z: FRONT_Z + 0.5 },
    // Inside booth, back-right corner. Mirror of the back-left interior
    // barrel; the two CornerBows are repositioned to flank this barrel.
    { x: HALF_WIDTH - 0.8, z: BACK_Z + 0.8 },
]

/** Profile radius at height fraction t: R_END at the ends, R_MID at the bilge. */
function radiusAt(t: number): number {
    return BARREL_RADIUS_END + (BARREL_RADIUS_MID - BARREL_RADIUS_END) * Math.sin(Math.PI * t)
}

/**
 * Wooden barrels with staves, flat iron hoops and a recessed head. The body is
 * an open LatheGeometry (U wraps the circumference, V runs up) carrying a
 * per-stave grain texture. Each open end gets a "head" assembly: an end-grain
 * ring for the stave thickness, a short inner wall, and a plank disk set
 * HEAD_INSET below the rim. Upright barrels only get a top head; the open
 * bottom is hidden by the ground.
 */
export class Barrels {
    readonly group: THREE.Group
    private geos: THREE.BufferGeometry[] = []
    private hoopGeos: THREE.BufferGeometry[] = []
    private textures: THREE.Texture[] = []
    private mats: THREE.Material[] = []
    private bodyGeo: THREE.BufferGeometry
    private rimGeo: THREE.BufferGeometry
    private innerWallGeo: THREE.BufferGeometry
    private headGeo: THREE.BufferGeometry
    private bodyMat: THREE.Material
    private endGrainMat: THREE.Material
    private headMat: THREE.Material
    private hoopMat: THREE.Material

    constructor() {
        this.group = new THREE.Group()

        // Open-ended bulged profile: starts and ends at R_END (no r=0 cap
        // points), so the lathe produces only the side surface and the
        // texture's V spans [0,1] bottom to top.
        const profile: THREE.Vector2[] = []
        for (let i = 0; i <= SEGMENTS_Y; i++) {
            const t = i / SEGMENTS_Y
            profile.push(new THREE.Vector2(radiusAt(t), t * BARREL_HEIGHT))
        }
        this.bodyGeo = new THREE.LatheGeometry(profile, SEGMENTS_RADIAL)

        // Head parts are built relative to the stave ends at y = 0, head
        // pointing +Y; makeHead() places them at either end.
        const rIn = BARREL_RADIUS_END - STAVE_THICK
        this.rimGeo = new THREE.RingGeometry(rIn, BARREL_RADIUS_END, SEGMENTS_RADIAL)
        this.rimGeo.rotateX(-Math.PI / 2)
        this.innerWallGeo = new THREE.CylinderGeometry(rIn, rIn, HEAD_INSET, SEGMENTS_RADIAL, 1, true)
        this.innerWallGeo.translate(0, -HEAD_INSET / 2, 0)
        this.headGeo = new THREE.CircleGeometry(rIn, SEGMENTS_RADIAL)
        this.headGeo.rotateX(-Math.PI / 2)
        this.headGeo.translate(0, -HEAD_INSET, 0)
        this.geos.push(this.bodyGeo, this.rimGeo, this.innerWallGeo, this.headGeo)

        // Each hoop is a strap lathed along the barrel's own profile, offset
        // outward by HOOP_THICK, so it hugs the bulge; its short edges give it
        // visible thickness.
        for (const c of HOOP_CENTER_FRACTIONS) {
            const t0 = c - HOOP_WIDTH / BARREL_HEIGHT / 2
            const t1 = c + HOOP_WIDTH / BARREL_HEIGHT / 2
            const pts = [new THREE.Vector2(radiusAt(t0), t0 * BARREL_HEIGHT)]
            for (let i = 0; i <= HOOP_SEGMENTS; i++) {
                const t = t0 + ((t1 - t0) * i) / HOOP_SEGMENTS
                pts.push(new THREE.Vector2(radiusAt(t) + HOOP_THICK, t * BARREL_HEIGHT))
            }
            pts.push(new THREE.Vector2(radiusAt(t1), t1 * BARREL_HEIGHT))
            this.hoopGeos.push(new THREE.LatheGeometry(pts, SEGMENTS_RADIAL))
        }

        const staveTex = createStaveTexture(N_STAVES)
        const headTex = createBarrelHeadTexture()
        this.textures.push(staveTex, headTex)

        this.bodyMat = addRimLight(new THREE.MeshStandardMaterial({
            color: STAVE_COLOR,
            map: staveTex,
            roughness: 0.8,
        }))
        this.headMat = new THREE.MeshStandardMaterial({
            color: HEAD_COLOR,
            map: headTex,
            roughness: 0.85,
        })
        // Rim and inner wall share this; DoubleSide so the inner wall (seen
        // from inside the cylinder) renders.
        this.endGrainMat = new THREE.MeshStandardMaterial({
            color: END_GRAIN_COLOR,
            roughness: 0.9,
            side: THREE.DoubleSide,
        })
        this.hoopMat = new THREE.MeshStandardMaterial({
            color: HOOP_COLOR,
            roughness: 0.55,
            metalness: 0.75,
        })
        this.mats.push(this.bodyMat, this.headMat, this.endGrainMat, this.hoopMat)

        for (const spec of BARRELS) {
            this.group.add(this.makeBarrel(spec))
        }
    }

    private makeBarrel(spec: BarrelSpec): THREE.Group {
        const barrel = new THREE.Group()
        barrel.scale.setScalar(SCALE)

        if (spec.onSide) {
            // Lay the barrel on its bulged side. rotation.z = π/2 swings the
            // local +Y axis to world -X (so the long axis lies horizontally),
            // and lifting by R_MID * SCALE puts the widest point of the body
            // on the ground. Ends with R_END < R_MID stay slightly above the
            // floor, matching how a real bulged barrel sits.
            barrel.position.set(spec.x, BARREL_RADIUS_MID * SCALE, spec.z)
            barrel.rotation.z = Math.PI / 2
        } else {
            barrel.position.set(spec.x, 0, spec.z)
        }
        // Random spin about the long axis so barrels don't look stamped from
        // the same mold (stave pattern and head boards both turn). 'ZYX'
        // applies this local Y spin before the lay-down Z rotation, so a
        // sideways barrel rolls in place instead of swinging around.
        barrel.rotation.order = 'ZYX'
        barrel.rotation.y = Math.random() * Math.PI * 2

        const body = new THREE.Mesh(this.bodyGeo, this.bodyMat)
        body.castShadow = true
        body.receiveShadow = true
        barrel.add(body)

        const top = this.makeHead()
        top.position.y = BARREL_HEIGHT
        barrel.add(top)
        // Sideways barrels expose their bottom end too; flip a second head
        // to face -Y.
        if (spec.onSide) {
            const bottom = this.makeHead()
            bottom.rotation.x = Math.PI
            barrel.add(bottom)
        }

        for (const geo of this.hoopGeos) {
            const hoop = new THREE.Mesh(geo, this.hoopMat)
            hoop.castShadow = true
            hoop.receiveShadow = true
            barrel.add(hoop)
        }

        return barrel
    }

    private makeHead(): THREE.Group {
        const head = new THREE.Group()
        const rim = new THREE.Mesh(this.rimGeo, this.endGrainMat)
        const wall = new THREE.Mesh(this.innerWallGeo, this.endGrainMat)
        const disk = new THREE.Mesh(this.headGeo, this.headMat)
        for (const m of [rim, wall, disk]) {
            m.receiveShadow = true
            head.add(m)
        }
        return head
    }

    dispose(): void {
        for (const g of this.geos) g.dispose()
        for (const g of this.hoopGeos) g.dispose()
        // Material.dispose() doesn't free maps.
        for (const t of this.textures) t.dispose()
        for (const m of this.mats) m.dispose()
    }
}
