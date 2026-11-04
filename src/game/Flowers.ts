import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildBlade, buildPetal, paint, type PetalSpec } from './foliage'
import { scatterBoothInterior, scatterField, type GroundPoint } from './groundScatter'
import { addRimLight } from './materials'
import { makeRng } from './rng'
import { addWind, type WindTime } from './wind'

// Shapes per species; every flower instances one of them.
const VARIANT_COUNT = 2
const VARIANT_SEED = 9001
// Flowers beyond this distance use the far version (flat disc head, 3-sided stem).
const LOD_DISTANCE = 28

const STEM_RADIUS = 0.0028
const STEM_BOTTOM = new THREE.Color(0x2f5a1e)
const STEM_TOP = new THREE.Color(0x6aa83a)
const LEAF_BASE = new THREE.Color(0x2b5219)
const LEAF_TIP = new THREE.Color(0x6fae3e)
const RIM_STRENGTH = 0.1
// Storybook proportions: blooms read from the booth, like the old flowers did.
const FLOWER_SCALE = 1.7

const INSIDE_COUNT = 30
// Flowers per m² near the player; thins with distance (see groundScatter).
const FIELD_DENSITY = 0.42

const WIND = { kind: 'ground', height: 0.25, amount: 0.025 } as const

type CenterSpec = {
    radius: number
    /** Dome height as a fraction of radius. */
    height: number
    top: number
    edge: number
}

type Species = {
    /** Share of all flowers. */
    weight: number
    petals: number
    petal: Omit<PetalSpec, 'baseColor' | 'tipColor'> & { base: number; tip: number }
    center: CenterSpec
    stem: [number, number]
    roughness: number
}

const SPECIES: Species[] = [
    // Daisy: many long, slightly spooned white rays around a domed yellow disc.
    {
        weight: 0.7,
        petals: 14,
        petal: { inner: 0.008, length: 0.04, width: 0.0085, cup: 0.18, droop: 0.35, spoon: 0.15, round: 0.8, base: 0xe6dfc2, tip: 0xffffff },
        center: { radius: 0.011, height: 0.75, top: 0xf7c631, edge: 0xc47512 },
        stem: [0.2, 0.3],
        roughness: 0.8,
    },
    // Buttercup: five broad, glossy petals forming a cup.
    {
        weight: 0.14,
        petals: 5,
        petal: { inner: 0.003, length: 0.021, width: 0.018, cup: 0.85, droop: 0.05, spoon: 0.3, round: 1, base: 0xdc930e, tip: 0xffdc3c },
        center: { radius: 0.0045, height: 0.9, top: 0xe8e070, edge: 0x9fae2c },
        stem: [0.16, 0.24],
        roughness: 0.35,
    },
    // Small pink wildflower.
    {
        weight: 0.08,
        petals: 5,
        petal: { inner: 0.003, length: 0.02, width: 0.015, cup: 0.35, droop: 0.2, spoon: 0.2, round: 1, base: 0xd5689a, tip: 0xf8d0e2 },
        center: { radius: 0.004, height: 1, top: 0xfff0b0, edge: 0xeebc4c },
        stem: [0.12, 0.2],
        roughness: 0.75,
    },
    // Small blue wildflower.
    {
        weight: 0.08,
        petals: 5,
        petal: { inner: 0.003, length: 0.02, width: 0.015, cup: 0.35, droop: 0.2, spoon: 0.2, round: 1, base: 0x6680dc, tip: 0xcbd7ff },
        center: { radius: 0.004, height: 1, top: 0xfff6d0, edge: 0xe6c45e },
        stem: [0.12, 0.2],
        roughness: 0.75,
    },
]

/**
 * Wildflowers scattered inside the booth and across the field, thinning into
 * the fog: mostly daisies, with buttercups and small pink/blue blooms. Each
 * flower is a curved stem with basal leaves and a head of individually shaped,
 * cupped petals around a bumpy domed center, vertex-painted base-to-tip and
 * swaying in the shared wind. One InstancedMesh per species × shape × LOD.
 */
export class Flowers {
    readonly group: THREE.Group

    private materials: THREE.Material[] = []
    private geometries: THREE.BufferGeometry[] = []
    private meshes: THREE.InstancedMesh[] = []

    constructor(windTime: WindTime) {
        this.group = new THREE.Group()

        // buckets[species][variant][near=0 | far=1]
        const buckets = SPECIES.map(() =>
            Array.from({ length: VARIANT_COUNT }, () => [[], []] as GroundPoint[][]),
        )
        const total = SPECIES.reduce((sum, s) => sum + s.weight, 0)
        for (const p of [...scatterBoothInterior(INSIDE_COUNT), ...scatterField(FIELD_DENSITY)]) {
            let r = Math.random() * total
            let species = 0
            while (species < SPECIES.length - 1 && (r -= SPECIES[species].weight) > 0) species++
            const variant = Math.floor(Math.random() * VARIANT_COUNT)
            buckets[species][variant][p.distance > LOD_DISTANCE ? 1 : 0].push(p)
        }

        SPECIES.forEach((species, si) => {
            const material = addWind(
                addRimLight(
                    new THREE.MeshStandardMaterial({
                        vertexColors: true,
                        roughness: species.roughness,
                        side: THREE.DoubleSide,
                    }),
                    RIM_STRENGTH,
                ),
                windTime,
                WIND,
            )
            this.materials.push(material)
            for (let v = 0; v < VARIANT_COUNT; v++) {
                const seed = VARIANT_SEED + si * 7919 + v * 104729
                this.addInstances(buildFlower(species, seed, false), material, buckets[si][v][0])
                this.addInstances(buildFlower(species, seed, true), material, buckets[si][v][1])
            }
        })
    }

    private addInstances(
        geo: THREE.BufferGeometry,
        material: THREE.Material,
        points: GroundPoint[],
    ): void {
        this.geometries.push(geo)
        if (points.length === 0) return
        const mesh = new THREE.InstancedMesh(geo, material, points.length)
        const matrix = new THREE.Matrix4()
        const pos = new THREE.Vector3()
        const quat = new THREE.Quaternion()
        const scale = new THREE.Vector3()
        const tint = new THREE.Color()
        points.forEach((p, i) => {
            pos.set(p.x, 0, p.z)
            quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.random() * Math.PI * 2)
            scale.setScalar(FLOWER_SCALE * (0.85 + Math.random() * 0.35) * p.distanceScale)
            mesh.setMatrixAt(i, matrix.compose(pos, quat, scale))
            mesh.setColorAt(i, tint.setScalar(0.92 + Math.random() * 0.13))
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
        for (const mat of this.materials) mat.dispose()
    }
}

/** One flower, origin at the stem's base. `far` builds the cheap version. */
function buildFlower(species: Species, seed: number, far: boolean): THREE.BufferGeometry {
    const rng = makeRng(seed)
    const range = (a: number, b: number) => a + (b - a) * rng()
    const parts: THREE.BufferGeometry[] = []

    // Stem: a gentle S-curve leaning a few cm off vertical.
    const height = range(species.stem[0], species.stem[1])
    const leanYaw = rng() * Math.PI * 2
    const lean = range(0.02, 0.05)
    const lx = Math.sin(leanYaw) * lean
    const lz = Math.cos(leanYaw) * lean
    const wobble = range(-0.012, 0.012)
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(lx * 0.15 + wobble, height * 0.35, lz * 0.15 - wobble),
        new THREE.Vector3(lx * 0.55 - wobble, height * 0.7, lz * 0.55 + wobble),
        new THREE.Vector3(lx, height, lz),
    ])
    const top = curve.getPoint(1)
    const tangent = curve.getTangent(1)
    // Heads nod along the stem but mostly face the sky.
    const axis = tangent.multiplyScalar(0.6).add(new THREE.Vector3(0, 0.4, 0)).normalize()
    const head = new THREE.Matrix4().compose(
        top,
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis),
        new THREE.Vector3(1, 1, 1),
    )

    const petalBase = new THREE.Color(species.petal.base)
    const petalTip = new THREE.Color(species.petal.tip)
    const centerTop = new THREE.Color(species.center.top)

    if (far) {
        const stem = new THREE.CylinderGeometry(STEM_RADIUS * 1.5, STEM_RADIUS * 1.5, top.length(), 3, 1)
        stem.translate(0, top.length() / 2, 0)
        stem.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().normalize()))
        parts.push(paint(stem, STEM_BOTTOM, STEM_TOP))

        // Head: a disc whose rim is the petal color and hub the center color,
        // lifted at the rim for cupped species.
        const p = species.petal
        const radius = p.inner + p.length * Math.cos(p.cup)
        const disc = new THREE.CircleGeometry(radius, Math.max(species.petals, 6))
        disc.rotateX(-Math.PI / 2)
        const pos = disc.attributes.position
        const colors = new Float32Array(pos.count * 3)
        const rim = petalBase.clone().lerp(petalTip, 0.7)
        for (let i = 0; i < pos.count; i++) {
            const isHub = i === 0
            if (!isHub) pos.setY(i, Math.sin(p.cup) * p.length * 0.8)
            ;(isHub ? centerTop : rim).toArray(colors, i * 3)
        }
        disc.deleteAttribute('uv')
        disc.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        disc.computeVertexNormals()
        parts.push(disc.applyMatrix4(head))
    } else {
        parts.push(paint(new THREE.TubeGeometry(curve, 8, STEM_RADIUS, 5, false), STEM_BOTTOM, STEM_TOP))

        // Two basal leaves arching out from the foot of the stem.
        const leafYaw = rng() * Math.PI * 2
        for (let k = 0; k < 2; k++) {
            parts.push(buildBlade({
                x: 0,
                z: 0,
                yaw: leafYaw + k * Math.PI + range(-0.5, 0.5),
                length: range(0.06, 0.1),
                width: range(0.013, 0.018),
                lean: range(0.6, 0.9),
                curl: range(0.6, 1.0),
                segments: 3,
                fold: 0.35,
                baseColor: LEAF_BASE,
                tipColor: LEAF_TIP,
                upNormal: 0.3,
            }))
        }

        const spin = rng() * Math.PI * 2
        for (let k = 0; k < species.petals; k++) {
            // Alternate petals sit a touch higher so neighbors overlap
            // instead of z-fighting, and each gets a little jitter.
            const p = species.petal
            const petal = buildPetal({
                ...p,
                length: p.length * range(0.9, 1.08),
                cup: p.cup + (k % 2 ? 0.08 : -0.04) + range(-0.05, 0.05),
                droop: p.droop * range(0.7, 1.3),
                baseColor: petalBase,
                tipColor: petalTip,
            }, spin + (k / species.petals) * Math.PI * 2 + range(-0.08, 0.08))
            if (k % 2) petal.translate(0, 0.0006, 0)
            parts.push(petal.applyMatrix4(head))
        }

        parts.push(buildCenter(species.center).applyMatrix4(head))
    }

    const geo = mergeGeometries(parts)
    for (const part of parts) part.dispose()
    return geo
}

/**
 * Bumpy domed flower center: a hemisphere squashed to `height`, its surface
 * jittered by a position hash (so seam vertices agree), painted from a dark
 * rim to a bright crown with darker speckled florets.
 */
function buildCenter(spec: CenterSpec): THREE.BufferGeometry {
    const geo = new THREE.SphereGeometry(spec.radius, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2)
    geo.deleteAttribute('uv')
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const edge = new THREE.Color(spec.edge)
    const crown = new THREE.Color(spec.top)
    const color = new THREE.Color()
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i)
        const hash = fract(Math.sin(v.x * 9137.1 + v.y * 4273.7 + v.z * 7121.3) * 43758.5453)
        const up = v.y / spec.radius
        v.multiplyScalar(1 + (hash - 0.5) * 0.18 * up)
        v.y *= spec.height
        pos.setXYZ(i, v.x, v.y, v.z)
        color.lerpColors(edge, crown, Math.sqrt(up))
        if (hash > 0.72) color.multiplyScalar(0.72)
        color.toArray(colors, i * 3)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    return geo
}

function fract(x: number): number {
    return x - Math.floor(x)
}
