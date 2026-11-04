import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildBlade, keepAuthoredNormals } from './foliage'
import { scatterBoothInterior, scatterField, type GroundPoint } from './groundScatter'
import { makeRng } from './rng'
import { addWind, type WindTime } from './wind'

// Tuft shapes. A few variants are built once and instanced everywhere; each
// has a detailed near version and a 3-blade far version with the same seed.
const VARIANT_COUNT = 4
const VARIANT_SEED = 4242
const NEAR_BLADES_MIN = 10
const NEAR_BLADES_MAX = 14
const NEAR_SEGMENTS = 4
const FAR_BLADES = 3
const FAR_SEGMENTS = 2
// Tufts beyond this distance use the far version.
const LOD_DISTANCE = 28

const BLADE_LENGTH_MIN = 0.1
const BLADE_LENGTH_MAX = 0.26
const BLADE_WIDTH_MIN = 0.02
const BLADE_WIDTH_MAX = 0.032
const BLADE_FOLD = 0.22
const BLADE_UP_NORMAL = 0.7
const TUFT_RADIUS = 0.05 // spread of blade roots

// Painted ramp: shadowed roots → sunlit tips, matched to the lawn texture.
const BASE_COLOR = new THREE.Color(0x2d5a1d)
const TIP_COLORS = [0x9fcf55, 0xb7d860, 0x86c04a, 0xc7d870].map((c) => new THREE.Color(c))

// Per-tuft tint: a slow world-space pattern between lush and sun-dried
// patches, plus a little random brightness, so the meadow isn't uniform.
const DRY_TINT = new THREE.Color(1.12, 1.04, 0.78)
const LUSH_TINT = new THREE.Color(0.9, 1.0, 0.92)

const INSIDE_COUNT = 70
// Tufts per m² near the player; thins with distance (see groundScatter).
const FIELD_DENSITY = 1.5

// Loose single blades filling the lawn between tufts. Only scattered out to
// SINGLE_RADIUS: past that a lone blade is under a pixel wide and the lawn
// texture carries the look.
const SINGLE_VARIANTS = 6
const SINGLE_SEGMENTS = 3
const SINGLE_INSIDE_COUNT = 600
const SINGLE_DENSITY = 14
const SINGLE_RADIUS = 30
const SINGLE_LENGTH_MIN = 0.07
const SINGLE_LENGTH_MAX = 0.2

const WIND = { kind: 'ground', height: 0.3, amount: 0.035 } as const

/**
 * Grass tufts: clumps of tapered, creased blades that splay out from a shared
 * root and droop toward the tip, painted dark-to-light like the tree canopy
 * and swaying in the shared wind, plus loose single blades filling the lawn
 * between them near the booth. Instanced per variant, with a cheaper tuft
 * past `LOD_DISTANCE`, so the whole field is a handful of draw calls.
 */
export class Plants {
    readonly group: THREE.Group

    private material: THREE.MeshStandardMaterial
    private geometries: THREE.BufferGeometry[] = []
    private meshes: THREE.InstancedMesh[] = []

    constructor(windTime: WindTime) {
        this.group = new THREE.Group()

        this.material = addWind(
            keepAuthoredNormals(
                new THREE.MeshStandardMaterial({
                    vertexColors: true,
                    roughness: 0.85,
                    side: THREE.DoubleSide,
                }),
            ),
            windTime,
            WIND,
        )

        const near: GroundPoint[][] = Array.from({ length: VARIANT_COUNT }, () => [])
        const far: GroundPoint[][] = Array.from({ length: VARIANT_COUNT }, () => [])
        const points = [...scatterBoothInterior(INSIDE_COUNT), ...scatterField(FIELD_DENSITY)]
        for (const p of points) {
            const bucket = p.distance > LOD_DISTANCE ? far : near
            bucket[Math.floor(Math.random() * VARIANT_COUNT)].push(p)
        }

        for (let v = 0; v < VARIANT_COUNT; v++) {
            const seed = VARIANT_SEED + v * 7919
            this.addInstances(buildTuft(seed, false), near[v])
            this.addInstances(buildTuft(seed, true), far[v])
        }

        const singles: GroundPoint[][] = Array.from({ length: SINGLE_VARIANTS }, () => [])
        const singlePoints = [
            ...scatterBoothInterior(SINGLE_INSIDE_COUNT),
            ...scatterField(SINGLE_DENSITY, SINGLE_RADIUS),
        ]
        for (const p of singlePoints) singles[Math.floor(Math.random() * SINGLE_VARIANTS)].push(p)
        for (let v = 0; v < SINGLE_VARIANTS; v++) {
            this.addInstances(buildSingleBlade(VARIANT_SEED + 31 + v * 6151), singles[v])
        }
    }

    private addInstances(geo: THREE.BufferGeometry, points: GroundPoint[]): void {
        this.geometries.push(geo)
        if (points.length === 0) return
        const mesh = new THREE.InstancedMesh(geo, this.material, points.length)
        const matrix = new THREE.Matrix4()
        const pos = new THREE.Vector3()
        const quat = new THREE.Quaternion()
        const scale = new THREE.Vector3()
        const tint = new THREE.Color()
        points.forEach((p, i) => {
            pos.set(p.x, 0, p.z)
            quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.random() * Math.PI * 2)
            scale.setScalar((0.8 + Math.random() * 0.45) * p.distanceScale)
            mesh.setMatrixAt(i, matrix.compose(pos, quat, scale))

            const dry = 0.5 + 0.5 * Math.sin(p.x * 0.19 + Math.sin(p.z * 0.13) * 2.0)
                * Math.sin(p.z * 0.16 + Math.sin(p.x * 0.11) * 2.0)
            tint.lerpColors(LUSH_TINT, DRY_TINT, dry * dry).multiplyScalar(0.88 + Math.random() * 0.2)
            mesh.setColorAt(i, tint)
        })
        mesh.computeBoundingSphere()
        // Darken in tree/booth shade like the lawn. Receiving only samples the
        // existing shadow map; casting would add every instance to its pass.
        mesh.receiveShadow = true
        this.meshes.push(mesh)
        this.group.add(mesh)
    }

    dispose(): void {
        for (const mesh of this.meshes) mesh.dispose()
        for (const geo of this.geometries) geo.dispose()
        this.material.dispose()
    }
}

/** One loose blade, origin at its root; leans along +Z before instance yaw. */
function buildSingleBlade(seed: number): THREE.BufferGeometry {
    const rng = makeRng(seed)
    const range = (a: number, b: number) => a + (b - a) * rng()
    return buildBlade({
        x: 0,
        z: 0,
        yaw: 0,
        length: range(SINGLE_LENGTH_MIN, SINGLE_LENGTH_MAX),
        width: range(BLADE_WIDTH_MIN, BLADE_WIDTH_MAX),
        lean: range(0.1, 0.5),
        curl: range(0.3, 1.1),
        segments: SINGLE_SEGMENTS,
        fold: BLADE_FOLD,
        baseColor: BASE_COLOR,
        tipColor: TIP_COLORS[Math.floor(rng() * TIP_COLORS.length)],
        upNormal: BLADE_UP_NORMAL,
    })
}

/** One tuft of blades splaying out from a shared root, origin at the ground. */
function buildTuft(seed: number, far: boolean): THREE.BufferGeometry {
    const rng = makeRng(seed)
    const range = (a: number, b: number) => a + (b - a) * rng()
    const count = Math.round(range(NEAR_BLADES_MIN, NEAR_BLADES_MAX))
    const blades: THREE.BufferGeometry[] = []
    for (let i = 0; i < count; i++) {
        // Spread evenly around the tuft with jitter; the first blades are the
        // longest and most upright, so the far version keeps the silhouette.
        const yaw = (i / count) * Math.PI * 2 + range(-0.4, 0.4)
        const rank = i / count
        const root = range(0, TUFT_RADIUS)
        const spec = {
            x: Math.sin(yaw) * root,
            z: Math.cos(yaw) * root,
            yaw,
            length: THREE.MathUtils.lerp(BLADE_LENGTH_MAX, BLADE_LENGTH_MIN, rank) * range(0.85, 1.1),
            width: range(BLADE_WIDTH_MIN, BLADE_WIDTH_MAX),
            lean: 0.12 + rank * 0.45 + range(0, 0.15),
            curl: range(0.35, 1.0),
            segments: NEAR_SEGMENTS,
            fold: BLADE_FOLD,
            baseColor: BASE_COLOR,
            tipColor: TIP_COLORS[Math.floor(rng() * TIP_COLORS.length)],
            upNormal: BLADE_UP_NORMAL,
        }
        if (far) {
            if (i >= FAR_BLADES) break
            // Wider and flat so three blades cover what a full tuft does.
            blades.push(buildBlade({ ...spec, width: spec.width * 1.8, segments: FAR_SEGMENTS, fold: 0 }))
        } else {
            blades.push(buildBlade(spec))
        }
    }
    const geo = mergeGeometries(blades)
    for (const b of blades) b.dispose()
    return geo
}
