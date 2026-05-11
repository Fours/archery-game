import * as THREE from 'three'
import { BACK_Z, FRONT_Z, HALF_WIDTH } from './Booth'

const SCALE = 2

const BARREL_HEIGHT = 0.9
const BARREL_RADIUS_MID = 0.32
const BARREL_RADIUS_END = 0.28
const SEGMENTS_Y = 12
const SEGMENTS_RADIAL = 20

const BAND_TUBE = 0.018
const BAND_OVERHANG = 0.003
const BAND_HEIGHT_FRACTIONS = [0.15, 0.5, 0.85]

const WOOD_COLOR = 0x6b3e1f
const DARK_WOOD_COLOR = 0x2a1709
const BAND_COLOR = 0x2a2a2a

// Number of stave seams around the barrel. Each tile of the canvas (one wood
// stripe + one dark seam at its right edge) tiles N_STAVES times around the
// circumference, so N_STAVES dark vertical lines appear evenly spaced.
const N_STAVES = 14
const STAVE_TEXTURE_W = 256
const STAVE_TEXTURE_H = 16
const SEAM_PX = 6

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

/**
 * Wooden barrels with metal bands and vertical stave seams. The body is an
 * open LatheGeometry (no cap points in the profile) textured with a tiling
 * stave pattern, so the dark seams only appear on the curved side — never
 * on the top cap. A separate CircleGeometry mesh closes the top with a
 * plain wood material. The bottom is open and hidden by the ground plane.
 */
export class Barrels {
    readonly group: THREE.Group
    private bodyGeo: THREE.BufferGeometry
    private capGeo: THREE.BufferGeometry
    private bodyTex: THREE.CanvasTexture
    private bodyMat: THREE.Material
    private capMat: THREE.Material
    private bandGeos: THREE.BufferGeometry[] = []
    private bandMat: THREE.Material

    constructor() {
        this.group = new THREE.Group()

        // Open-ended bulged profile: starts and ends at R_END (no r=0 cap
        // points), so the lathe produces only the side surface and the
        // texture UVs span [0,1] across the visible side.
        const profile: THREE.Vector2[] = []
        for (let i = 0; i <= SEGMENTS_Y; i++) {
            const t = i / SEGMENTS_Y
            const y = t * BARREL_HEIGHT
            const bulge = Math.sin(Math.PI * t)
            const r = BARREL_RADIUS_END + (BARREL_RADIUS_MID - BARREL_RADIUS_END) * bulge
            profile.push(new THREE.Vector2(r, y))
        }
        this.bodyGeo = new THREE.LatheGeometry(profile, SEGMENTS_RADIAL)

        this.capGeo = new THREE.CircleGeometry(BARREL_RADIUS_END, SEGMENTS_RADIAL)

        this.bodyTex = makeStaveTexture()
        this.bodyMat = new THREE.MeshStandardMaterial({
            map: this.bodyTex,
            roughness: 0.85,
        })
        this.capMat = new THREE.MeshStandardMaterial({
            color: WOOD_COLOR,
            roughness: 0.85,
        })
        this.bandMat = new THREE.MeshStandardMaterial({
            color: BAND_COLOR,
            roughness: 0.5,
            metalness: 0.6,
        })

        // Pre-compute one torus per band — radius matches the barrel's profile
        // radius at that height plus a small overhang so the band protrudes.
        for (const t of BAND_HEIGHT_FRACTIONS) {
            const bulge = Math.sin(Math.PI * t)
            const r =
                BARREL_RADIUS_END +
                (BARREL_RADIUS_MID - BARREL_RADIUS_END) * bulge +
                BAND_OVERHANG
            this.bandGeos.push(new THREE.TorusGeometry(r, BAND_TUBE, 8, 24))
        }

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
            // Random Y rotation so upright barrels don't look stamped from the same mold.
            barrel.rotation.y = Math.random() * Math.PI * 2
        }

        const body = new THREE.Mesh(this.bodyGeo, this.bodyMat)
        body.castShadow = true
        body.receiveShadow = true
        barrel.add(body)

        // Top cap. CircleGeometry default lies in XY plane (normal +Z);
        // rotate to face +Y and lift to the top of the barrel.
        const topCap = new THREE.Mesh(this.capGeo, this.capMat)
        topCap.rotation.x = -Math.PI / 2
        topCap.position.y = BARREL_HEIGHT
        topCap.receiveShadow = true
        barrel.add(topCap)

        // Bottom cap — only needed for sideways barrels. For upright barrels
        // the open bottom sits on the ground and is hidden; for sideways
        // barrels the bottom end now faces sideways and would expose the
        // interior. rotation.x = π/2 flips the disk so it faces -Y in
        // barrel-local, which the parent rotation.z = π/2 then swings to +X.
        if (spec.onSide) {
            const bottomCap = new THREE.Mesh(this.capGeo, this.capMat)
            bottomCap.rotation.x = Math.PI / 2
            bottomCap.position.y = 0
            bottomCap.receiveShadow = true
            barrel.add(bottomCap)
        }

        for (let i = 0; i < BAND_HEIGHT_FRACTIONS.length; i++) {
            const band = new THREE.Mesh(this.bandGeos[i], this.bandMat)
            // Torus default axis is +Z; rotate so it sits flat around the
            // barrel's vertical axis (+Y).
            band.rotation.x = Math.PI / 2
            band.position.y = BAND_HEIGHT_FRACTIONS[i] * BARREL_HEIGHT
            band.castShadow = true
            barrel.add(band)
        }

        return barrel
    }

    dispose(): void {
        this.bodyGeo.dispose()
        this.capGeo.dispose()
        this.bodyTex.dispose()
        this.bodyMat.dispose()
        this.capMat.dispose()
        this.bandMat.dispose()
        for (const g of this.bandGeos) g.dispose()
    }
}

function makeStaveTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = STAVE_TEXTURE_W
    canvas.height = STAVE_TEXTURE_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')

    const wood = '#' + WOOD_COLOR.toString(16).padStart(6, '0')
    const dark = '#' + DARK_WOOD_COLOR.toString(16).padStart(6, '0')

    ctx.fillStyle = wood
    ctx.fillRect(0, 0, STAVE_TEXTURE_W, STAVE_TEXTURE_H)

    // Dark seam at the right edge of the tile. With RepeatWrapping +
    // repeat.x = N_STAVES, this seam appears N_STAVES times around the barrel.
    ctx.fillStyle = dark
    ctx.fillRect(STAVE_TEXTURE_W - SEAM_PX, 0, SEAM_PX, STAVE_TEXTURE_H)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.repeat.x = N_STAVES
    return tex
}
