import * as THREE from 'three'
import { HALF_WIDTH } from './Booth'
import { TIER_COLOR, TIER_DARK_COLOR, TIER_MULTIPLIER } from './Target'
import type { Tier } from './Target'

const FLAG_WIDTH = 0.75
const FLAG_HEIGHT = 1.0
const WALL_OFFSET = 0.04
const TEXTURE_W = 512
const TEXTURE_H = 768

export interface RowFlagSpec {
    tier: Tier
    z: number
    y: number
}

/**
 * Large multiplier pennants mounted to the inside of the left and right walls
 * at each row's (z, y). Each pennant is a downward-pointing triangle in the
 * tier's active color, with the tier multiplier ("1X" / "2X" / "3X") rendered
 * in a clean modern sans-serif at the top in semi-transparent dark color.
 *
 * One triangle BufferGeometry is shared across all pennants. Each tier gets
 * its own CanvasTexture + Material, reused by both wall meshes for that tier.
 */
export class RowFlags {
    readonly group: THREE.Group
    private geometry: THREE.BufferGeometry
    private textures: THREE.CanvasTexture[] = []
    private materials: THREE.Material[] = []

    constructor(rows: RowFlagSpec[]) {
        this.group = new THREE.Group()
        this.geometry = makeDownTriangleGeometry(FLAG_WIDTH, FLAG_HEIGHT)

        for (const row of rows) {
            const tex = makeFlagTexture(
                TIER_COLOR[row.tier],
                TIER_DARK_COLOR[row.tier],
                `${TIER_MULTIPLIER[row.tier]}X`,
            )
            this.textures.push(tex)
            const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })
            this.materials.push(mat)

            // Left wall flag: triangle's default normal is +Z;
            // rotation.y = +π/2 swings it to face +X (toward booth interior).
            const left = new THREE.Mesh(this.geometry, mat)
            left.position.set(-HALF_WIDTH + WALL_OFFSET, row.y, row.z)
            left.rotation.y = Math.PI / 2
            this.group.add(left)

            // Right wall flag: rotation.y = -π/2 faces -X.
            const right = new THREE.Mesh(this.geometry, mat)
            right.position.set(HALF_WIDTH - WALL_OFFSET, row.y, row.z)
            right.rotation.y = -Math.PI / 2
            this.group.add(right)
        }
    }

    dispose(): void {
        this.geometry.dispose()
        for (const t of this.textures) t.dispose()
        for (const m of this.materials) m.dispose()
    }
}

/**
 * Three-vertex BufferGeometry for a downward-pointing triangle in the XY plane,
 * normal +Z. UVs map the triangle's top edge to the texture's top edge and the
 * bottom point to the texture's bottom-middle, so a rectangular canvas can be
 * authored with the wide top of the pennant at the top of the canvas.
 */
function makeDownTriangleGeometry(width: number, height: number): THREE.BufferGeometry {
    const w = width / 2
    const h = height / 2
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array([
        -w,  h, 0,  // 0: top-left
         w,  h, 0,  // 1: top-right
         0, -h, 0,  // 2: bottom point
    ])
    const uvs = new Float32Array([
        0, 1,    // top-left → texture top-left
        1, 1,    // top-right → texture top-right
        0.5, 0,  // bottom point → texture bottom-middle
    ])
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    // Counter-clockwise from +Z so the face normal points +Z (matches the
    // rotation.y = ±π/2 mounts that aim the flag toward the booth interior).
    geo.setIndex([0, 2, 1])
    geo.computeVertexNormals()
    return geo
}

function makeFlagTexture(
    activeColor: number,
    darkColor: number,
    label: string,
): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = TEXTURE_W
    canvas.height = TEXTURE_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')

    const fill = '#' + activeColor.toString(16).padStart(6, '0')
    const dark = '#' + darkColor.toString(16).padStart(6, '0')

    // Solid background — only the parts inside the triangle's UV-mapped
    // region are visible on the geometry, so painting the full canvas is fine.
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, TEXTURE_W, TEXTURE_H)

    // Triangular inner border. The stroke is centered on the path, so the
    // outer half falls outside the triangle (clipped by UVs) and only the
    // inner half (~20px) shows up as the visible border.
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(TEXTURE_W, 0)
    ctx.lineTo(TEXTURE_W / 2, TEXTURE_H)
    ctx.closePath()
    ctx.strokeStyle = dark
    ctx.lineWidth = 40
    ctx.lineJoin = 'round'
    ctx.stroke()

    // Modern sans-serif stack, heavy weight. "X" rather than "x" for a more
    // graphic, banner-like look.
    ctx.fillStyle = dark
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font =
        '800 180px "Inter", "Helvetica Neue", "SF Pro Display", "Segoe UI", system-ui, sans-serif'
    ctx.globalAlpha = 0.5
    ctx.fillText(label, TEXTURE_W / 2, 70)
    ctx.globalAlpha = 1

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
}
