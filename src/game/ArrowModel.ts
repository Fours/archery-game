import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createBowWoodTexture, createFeatherTexture } from './materials'
import { sharedResource } from './shared'

// Layout along the arrow's local -Z, measured from the nock throat (z = 0,
// where the string sits) toward the tip.
const SHAFT_RADIUS = 0.011
const SHAFT_START = 0.014 // shaft end buried in the nock
const SHAFT_LENGTH = 0.75
const FERRULE_LENGTH = 0.05
const BLADE_LENGTH = 0.085
const BLADE_HALF_WIDTH = 0.02
const FLETCH_LENGTH = 0.115
const FLETCH_HEIGHT = 0.034
const FLETCH_START = 0.035 // trailing edge, measured from the nock
const FLETCH_CUP = 0.004 // sideways curl at the vane's outer edge

/** Distance from the nock throat to the broadhead's point. */
export const ARROW_LENGTH = SHAFT_START + SHAFT_LENGTH + BLADE_LENGTH - 0.004

const SHAFT_COLOR = 0xe2ae74
const STEEL_COLOR = 0xc9ced6
const COCK_FEATHER_COLOR = 0xf1eadb
const DEFAULT_FLETCH_COLOR = 0xd13a3a
const NOCK_COLOR = 0x7a1c14
const CREST_RED = 0xb8231a
const CREST_GOLD = 0xe8b440
const THREAD_COLOR = 0x2a1810

// Cock feather points away from the riser (toward -X); the hen feathers sit 120° either side.
const COCK_ANGLE = Math.PI / 2
const HEN_ANGLES = [COCK_ANGLE + (Math.PI * 2) / 3, COCK_ANGLE - (Math.PI * 2) / 3]

class ArrowAssets {
    readonly shaftGeo: THREE.BufferGeometry
    readonly steelGeo: THREE.BufferGeometry
    readonly paintGeo: THREE.BufferGeometry
    readonly henGeo: THREE.BufferGeometry
    readonly cockGeo: THREE.BufferGeometry
    readonly woodTex = createBowWoodTexture()
    readonly featherTex = createFeatherTexture()
    readonly shaftMat: THREE.MeshPhysicalMaterial
    readonly steelMat: THREE.MeshStandardMaterial
    readonly paintMat: THREE.MeshPhysicalMaterial
    readonly cockMat: THREE.MeshStandardMaterial
    private henMats = new Map<number, THREE.MeshStandardMaterial>()

    constructor() {
        this.shaftGeo = buildShaft()
        this.steelGeo = buildSteel()
        this.paintGeo = buildPaint()
        this.henGeo = mergeGeometries(HEN_ANGLES.map(buildVane))
        this.cockGeo = buildVane(COCK_ANGLE)

        this.shaftMat = new THREE.MeshPhysicalMaterial({
            color: SHAFT_COLOR,
            map: this.woodTex,
            roughness: 0.5,
            clearcoat: 0.35,
            clearcoatRoughness: 0.35,
        })
        this.steelMat = new THREE.MeshStandardMaterial({ color: STEEL_COLOR, metalness: 0.9, roughness: 0.28 })
        this.paintMat = new THREE.MeshPhysicalMaterial({
            vertexColors: true,
            roughness: 0.4,
            clearcoat: 0.6,
            clearcoatRoughness: 0.2,
        })
        this.cockMat = this.featherMat(COCK_FEATHER_COLOR)
    }

    /** Hen-feather material for a fletch color; one per color, shared by every arrow. */
    henMat(color: number): THREE.MeshStandardMaterial {
        let mat = this.henMats.get(color)
        if (!mat) {
            mat = this.featherMat(color)
            this.henMats.set(color, mat)
        }
        return mat
    }

    private featherMat(color: number): THREE.MeshStandardMaterial {
        return new THREE.MeshStandardMaterial({
            color,
            map: this.featherTex,
            side: THREE.DoubleSide,
            roughness: 0.9,
        })
    }

    dispose(): void {
        for (const g of [this.shaftGeo, this.steelGeo, this.paintGeo, this.henGeo, this.cockGeo]) g.dispose()
        for (const m of [this.shaftMat, this.steelMat, this.paintMat, this.cockMat, ...this.henMats.values()]) {
            m.dispose()
        }
        this.woodTex.dispose()
        this.featherTex.dispose()
    }
}

const assets = sharedResource(() => new ArrowAssets())

/**
 * A detailed arrow — cedar shaft, steel broadhead, lacquered nock, painted
 * cresting, thread wraps and three textured feathers (one cream cock feather).
 * Local frame: the nock throat is the origin and the tip points down -Z.
 * All instances share one set of geometry, materials and textures (five
 * meshes per arrow); `dispose()` releases this instance's hold on them.
 */
export class ArrowModel {
    readonly group = new THREE.Group()
    private disposed = false

    constructor(options: { fletchColor?: number; castShadow?: boolean } = {}) {
        const a = assets.acquire()
        const meshes = [
            new THREE.Mesh(a.shaftGeo, a.shaftMat),
            new THREE.Mesh(a.steelGeo, a.steelMat),
            new THREE.Mesh(a.paintGeo, a.paintMat),
            new THREE.Mesh(a.henGeo, a.henMat(options.fletchColor ?? DEFAULT_FLETCH_COLOR)),
            new THREE.Mesh(a.cockGeo, a.cockMat),
        ]
        for (const m of meshes) {
            m.castShadow = options.castShadow ?? false
            this.group.add(m)
        }
    }

    dispose(): void {
        if (this.disposed) return
        this.disposed = true
        assets.release()
    }
}

/** Orient a geometry built along +Y (Cylinder/Lathe convention) to run down -Z from `startZ`. */
function alongArrow(geo: THREE.BufferGeometry, startZ: number): THREE.BufferGeometry {
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, 0, -startZ)
    return geo
}

function buildShaft(): THREE.BufferGeometry {
    const geo = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 14, 1, true)
    // Rescale the 0..1 UVs to meters so the shared wood texture tiles at its natural size.
    const uv = geo.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * Math.PI * 2 * SHAFT_RADIUS, uv.getY(i) * SHAFT_LENGTH)
    }
    geo.translate(0, SHAFT_LENGTH / 2, 0)
    return alongArrow(geo, SHAFT_START)
}

/** Ferrule (lathed taper off the shaft) + a beveled, leaf-shaped blade, laid flat. */
function buildSteel(): THREE.BufferGeometry {
    const headStart = SHAFT_START + SHAFT_LENGTH - 0.004
    const ferrule = alongArrow(
        new THREE.LatheGeometry(
            [
                new THREE.Vector2(SHAFT_RADIUS * 1.06, 0),
                new THREE.Vector2(SHAFT_RADIUS * 1.12, 0.006),
                new THREE.Vector2(SHAFT_RADIUS * 0.95, 0.02),
                new THREE.Vector2(SHAFT_RADIUS * 0.55, 0.038),
                new THREE.Vector2(0.0008, FERRULE_LENGTH),
            ],
            14,
        ),
        headStart,
    )
    // A lip ring where the ferrule meets the shaft.
    const collar = new THREE.TorusGeometry(SHAFT_RADIUS * 1.08, 0.0016, 6, 16).translate(0, 0, -headStart)

    const L = BLADE_LENGTH
    const W = BLADE_HALF_WIDTH
    const shape = new THREE.Shape()
    shape.moveTo(0, 0.006)
    shape.quadraticCurveTo(L * 0.12, W * 1.05, L * 0.36, W)
    shape.quadraticCurveTo(L * 0.72, W * 0.78, L, 0)
    shape.quadraticCurveTo(L * 0.72, -W * 0.78, L * 0.36, -W)
    shape.quadraticCurveTo(L * 0.12, -W * 1.05, 0, -0.006)
    shape.closePath()
    const blade = new THREE.ExtrudeGeometry(shape, {
        depth: 0.0008,
        bevelEnabled: true,
        bevelThickness: 0.0012,
        bevelSize: 0.0028,
        bevelSegments: 2,
        curveSegments: 10,
    })
    blade.translate(0, 0, -0.0004)
    // Shape X → arrow -Z; shape Y → arrow X so the blade lies flat.
    blade.rotateY(Math.PI / 2)
    blade.rotateZ(Math.PI / 2)
    blade.translate(0, 0, -(headStart + 0.002))

    const parts = [ferrule, collar, blade].map((g) => {
        const ng = g.index ? g.toNonIndexed() : g
        ng.deleteAttribute('uv')
        return ng
    })
    return mergeGeometries(parts)
}

/** Nock, cresting bands and thread wraps, merged into one vertex-colored mesh. */
function buildPaint(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = []
    const add = (geo: THREE.BufferGeometry, color: number): void => {
        const g = geo.index ? geo.toNonIndexed() : geo
        g.deleteAttribute('uv')
        const c = new THREE.Color(color)
        const colors = new Float32Array(g.attributes.position.count * 3)
        for (let i = 0; i < colors.length; i += 3) {
            colors[i] = c.r
            colors[i + 1] = c.g
            colors[i + 2] = c.b
        }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        parts.push(g)
    }

    // Nock: a lathed bulb sleeved over the shaft end, plus two ears either
    // side of the (vertical) string slot.
    add(
        alongArrow(
            new THREE.LatheGeometry(
                [
                    new THREE.Vector2(0.0001, 0),
                    new THREE.Vector2(0.0075, 0),
                    new THREE.Vector2(0.0108, 0.004),
                    new THREE.Vector2(0.0122, 0.013),
                    new THREE.Vector2(0.0118, 0.022),
                    new THREE.Vector2(SHAFT_RADIUS * 1.02, 0.026),
                ],
                14,
            ),
            0,
        ),
        NOCK_COLOR,
    )
    for (const side of [-1, 1]) {
        const ear = new THREE.CylinderGeometry(0.0055, 0.0055, 0.0032, 12, 1, false, 0, Math.PI)
        // Half-disc ear standing behind the throat, flat face toward the slot.
        ear.rotateZ(Math.PI / 2)
        ear.rotateX(Math.PI / 2)
        ear.translate(side * 0.005, 0, 0)
        add(ear, NOCK_COLOR)
    }

    const band = (from: number, length: number, radius: number, color: number): void => {
        const g = new THREE.CylinderGeometry(radius, radius, length, 14, 1, true)
        g.translate(0, length / 2, 0)
        add(alongArrow(g, SHAFT_START + from), color)
    }
    const r = SHAFT_RADIUS + 0.0004
    // Thread wraps binding each end of the fletching.
    band(FLETCH_START - SHAFT_START - 0.008, 0.007, r + 0.0004, THREAD_COLOR)
    band(FLETCH_START - SHAFT_START + FLETCH_LENGTH, 0.006, r + 0.0004, THREAD_COLOR)
    // Cresting below the fletching.
    const crest = FLETCH_START - SHAFT_START + FLETCH_LENGTH + 0.016
    band(crest, 0.022, r, CREST_RED)
    band(crest + 0.026, 0.005, r, CREST_GOLD)
    band(crest + 0.035, 0.009, r, CREST_RED)
    band(crest + 0.048, 0.003, r, CREST_GOLD)

    return mergeGeometries(parts)
}

/** One shield-cut feather vane at `angle` around the shaft (0 = +Y), cupped slightly. */
function buildVane(angle: number): THREE.BufferGeometry {
    const L = FLETCH_LENGTH
    const H = FLETCH_HEIGHT
    const shape = new THREE.Shape()
    shape.moveTo(0, 0)
    shape.lineTo(0.004, H * 0.9)
    shape.quadraticCurveTo(0.012, H * 1.05, L * 0.3, H * 0.92)
    shape.quadraticCurveTo(L * 0.62, H * 0.72, L * 0.86, H * 0.28)
    shape.quadraticCurveTo(L * 0.96, H * 0.08, L, 0)
    shape.closePath()
    const geo = new THREE.ShapeGeometry(shape, 14)

    const pos = geo.attributes.position as THREE.BufferAttribute
    const uv = geo.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i)
        const y = pos.getY(i)
        uv.setXY(i, x / L, y / H)
        const t = y / H
        pos.setZ(i, FLETCH_CUP * t * t)
    }
    geo.computeVertexNormals()
    // Shape X → arrow -Z (toward the tip), shape Y → radial.
    geo.rotateY(Math.PI / 2)
    geo.translate(0, SHAFT_RADIUS * 0.85, -FLETCH_START)
    geo.rotateZ(angle)
    return geo
}
