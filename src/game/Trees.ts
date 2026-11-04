import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { addRimLight } from './materials'
import { makeRng } from './rng'
import { addWind, type WindTime } from './wind'

// Number of distinct procedural tree shapes. Every placed tree reuses one of
// these geometries with its own yaw/scale, so variety costs no extra memory.
const VARIANT_COUNT = 6
const VARIANT_SEED = 1337

// Trunk. Height is the base value; each variant scales it slightly.
const TRUNK_HEIGHT = 3.2
const TRUNK_RADIUS = 0.2
const TRUNK_TOP_TAPER = 0.5 // top radius as a fraction of the base radius
const TRUNK_BEND = 0.25 // max sideways wander of the trunk's spline, meters
const ROOT_FLARE = 1.3 // extra base radius at the root lobes, as a fraction
const ROOT_FLARE_HEIGHT = 0.35 // meters over which the flare fades out
const ROOT_LOBES = 5
const BARK_RIDGES = 11
const BARK_RIDGE_DEPTH = 0.06 // fraction of local radius
const TRUNK_RADIAL_SEGMENTS = 28
const TRUNK_LENGTH_SEGMENTS = 36

// Branches fork off the upper trunk and each carries a foliage clump.
const BRANCH_MIN = 3
const BRANCH_MAX = 5
const BRANCH_START_MIN = 0.5 // along the trunk, 0 = ground, 1 = top
const BRANCH_START_MAX = 0.85
const BRANCH_LENGTH_MIN = 0.8
const BRANCH_LENGTH_MAX = 1.3
const BRANCH_RADIUS = 0.6 // fraction of the trunk radius where it forks
const BRANCH_RADIAL_SEGMENTS = 12
const BRANCH_LENGTH_SEGMENTS = 10

// Canopy: each clump is one big sphere plus a few satellites, so the
// silhouette reads as billowy cauliflower lumps rather than balls. The spheres
// are never rendered — they're the volume the leaf cards fill.
const CROWN_RADIUS = 1.25
const CLUMP_RADIUS = 0.85
const SATELLITES_PER_CLUMP = 6
const SATELLITE_OFFSET = 0.8 // fraction of the clump radius
const SATELLITE_RADIUS_MIN = 0.4
const SATELLITE_RADIUS_MAX = 0.6
const CLUMP_LUMP = 0.12 // big billows, fraction of sphere radius
const CLUMP_LUMP_FREQ = 1.3
const CLUMP_BUMP = 0.07 // leaf-cluster bumps
const CLUMP_BUMP_FREQ = 3.2
const CLUMP_FLATTEN = 0.7 // squash factor applied to clump undersides
// Leaf cards: alpha-cut quads of a leaf-sprig texture filling the outer shell
// of each clump, darkened with depth so gaps read as shadowed foliage.
const LEAF_CARDS_PER_M2 = 16 // per m² of clump surface, spread through the shell
const LEAF_SHELL_DEPTH = 0.5 // fraction of the clump radius the shell spans
const LEAF_MAX_DEPTH = 0.55 // cards deeper inside the canopy than this are dropped
const LEAF_OCCLUSION = 1.6 // darkening per unit depth
const LEAF_MIN_LIGHT = 0.2
const LEAF_CARD_SIZE = 0.6 // meters, before tree scale
const LEAF_CARD_TWIST = 0.8 // how far card planes tilt off the surface normal
const LEAF_ALPHA_TEST = 0.4
// The player never leaves the booth, so each placed tree drops the cards on
// the far side of its canopy — they'd only be shaded and then hidden behind
// the nearer leaves. Cards whose outward normal is turned further from the
// viewer than this dot product are culled; the margin keeps the silhouette
// fringe and the inner layers seen through gaps.
// VIEWER must match Game's camera position (x = z = 0, y = EYE_HEIGHT).
const VIEWER = new THREE.Vector3(0, 1.7, 0)
const LEAF_CULL_DOT = -0.5
const LEAF_TEXTURE_SIZE = 512
const LEAVES_PER_SPRIG = 22
const LEAF_SPECKLE = 0.25
const LEAF_SPECKLE_FREQ = 9

const BARK_DARK = new THREE.Color(0x2e1a0d)
const BARK_LIGHT = new THREE.Color(0x6e4a2c)
// Painted three-stop leaf ramp: cool shadowed undersides through to warm,
// sunlit tops. Multiplied with real lighting, so it exaggerates form.
const LEAF_SHADOW = new THREE.Color(0x24573a)
const LEAF_MID = new THREE.Color(0x4f9e3e)
const LEAF_LIGHT = new THREE.Color(0xb4d95c)
// Per-variant hue/lightness wobble so neighbours aren't identical greens.
const VARIANT_HUE_JITTER = 0.03
const VARIANT_LIGHTNESS_JITTER = 0.04
// Lower than the default rim: the cards' many silhouette edges would
// otherwise wash out pale.
const LEAF_RIM_STRENGTH = 0.12
// Sunlight glowing through leaves when looking toward the sun — the warm
// backlit-canopy look. Scales the sun's color times the leaf albedo.
const LEAF_TRANSLUCENCY = 0.55
const LEAF_TRANSLUCENCY_POWER = 4.0

// Wind (see wind.ts). Each tree bends from its base by an amount that grows
// with the square of height above `swayStart`, so roots stay planted and the
// crown moves most; leaf cards add a faster, smaller flutter along their normals.
const TREE_WIND = { kind: 'tree', swayStart: 0.8, swayAmount: 0.006 } as const
const TREE_LEAF_WIND = { ...TREE_WIND, flutter: 0.025 } as const

interface TreeSpec {
    x: number
    z: number
    /** Which procedural shape to use; defaults to a hash of the position. */
    variant?: number
    /** Yaw about the trunk; defaults to a hash of the position. */
    rotationY?: number
    /** Lean about world Z, applied after yaw. */
    rotationZ?: number
    /** Uniform scale, default 1. */
    scale?: number
}

// Foreground woods plus an outer ring forming a forest clearing. Background positions sit at |x| > 8 or z > 4
// so they aren't hidden behind the booth's solid side walls; one tall tree
// goes deep behind the booth so its scaled-up canopy pokes over the roof.
const TREES: TreeSpec[] = [
    // Outer corners beside the booth front. Scaled down so their canopies
    // (≈2 m spread at scale 1) stay clear of the booth's side walls.
    { x: -7.0, z: -2.0, scale: 0.85, variant: 0, rotationY: 0.4 },
    // Negative lean tips the top toward +X, away from the booth.
    { x: 7.0, z: -2.0, scale: 0.85, variant: 3, rotationY: 2.1, rotationZ: -Math.PI / 12 },

    // Background woods — left of player.
    { x: -14, z: -1,  scale: 1.5 },
    { x: -18, z:  4,  scale: 2.5 },
    { x: -12, z:  8,  scale: 1.8 },
    { x: -22, z: 14,  scale: 3.0 },
    { x: -25, z:  2,  scale: 2.0 },

    // Background woods — right of player.
    { x:  14, z: -1,  scale: 1.4 },
    { x:  19, z:  5,  scale: 2.7 },
    { x:  12, z: 10,  scale: 1.0 },
    { x:  22, z: 14,  scale: 2.8 },
    { x:  26, z:  3,  scale: 1.9 },

    // Background woods — behind player.
    { x:  -7, z: 14,  scale: 1.6 },
    { x:   5, z: 12,  scale: 1.3 },
    { x: -12, z: 22,  scale: 2.4 },
    { x:   9, z: 22,  scale: 1.1 },
    { x:   0, z: 19,  scale: 2.5 },
    { x:  -4, z: 28,  scale: 2.2 },
    { x: -10, z: 16,  scale: 1.2 },
    { x:  16, z: 16,  scale: 1.4 },
    { x:  18, z: 24,  scale: 1.8 },
    { x: -16, z: 30,  scale: 1.5 },

    // Outer ring: taller trees closing the clearing in on every visible side,
    // so the horizon reads as forest rather than open meadow.
    { x: -28, z: -18, scale: 2.4 },
    { x: -32, z:  -8, scale: 2.6 },
    { x: -36, z:  10, scale: 3.0 },
    { x: -30, z:  26, scale: 2.4 },
    { x: -20, z:  34, scale: 2.8 },
    { x:  -6, z:  40, scale: 3.2 },
    { x:  10, z:  36, scale: 2.6 },
    { x:  24, z:  30, scale: 3.0 },
    { x:  34, z:  16, scale: 2.5 },
    { x:  36, z:  -4, scale: 2.8 },
    { x:  30, z: -14, scale: 2.2 },
]

function hash3(x: number, y: number, z: number, seed: number): number {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263)
        ^ Math.imul(z, 1274126177) ^ Math.imul(seed, 2246822519)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Trilinear value noise in [0, 1), quintic-faded so it has no creases. */
function valueNoise(x: number, y: number, z: number, seed: number): number {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
    const fx = x - xi, fy = y - yi, fz = z - zi
    const fade = (f: number) => f * f * f * (f * (f * 6 - 15) + 10)
    const u = fade(fx), v = fade(fy), w = fade(fz)
    const lerp = THREE.MathUtils.lerp
    const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed)
    const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u)
    const x10 = lerp(c(0, 1, 0), c(1, 1, 0), u)
    const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u)
    const x11 = lerp(c(0, 1, 1), c(1, 1, 1), u)
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w)
}

/** Three-octave fractal noise, re-centered to roughly [−1, 1]. */
function fbm(x: number, y: number, z: number, seed: number): number {
    let sum = 0, amp = 0.5, freq = 1, norm = 0
    for (let o = 0; o < 3; o++) {
        sum += amp * valueNoise(x * freq, y * freq, z * freq, seed + o * 101)
        norm += amp
        amp *= 0.5
        freq *= 2
    }
    return (sum / norm - 0.5) * 2
}

/**
 * Sweep a variable-radius ring along a curve — a TubeGeometry whose radius
 * can vary with both arc position `t` and angle `theta`, which is what gives
 * the trunk its root lobes and bark ridges. Normals are recomputed from the
 * displaced surface (so ridges shade) and averaged across the UV seam.
 */
function sweep(
    curve: THREE.Curve<THREE.Vector3>,
    lengthSegs: number,
    radialSegs: number,
    radiusAt: (t: number, theta: number) => number,
    colorAt: (t: number, theta: number, out: THREE.Color) => void,
): THREE.BufferGeometry {
    const frames = curve.computeFrenetFrames(lengthSegs, false)
    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const p = new THREE.Vector3()
    const dir = new THREE.Vector3()
    const color = new THREE.Color()

    for (let i = 0; i <= lengthSegs; i++) {
        const t = i / lengthSegs
        curve.getPointAt(t, p)
        const n = frames.normals[i]
        const b = frames.binormals[i]
        for (let j = 0; j <= radialSegs; j++) {
            const theta = (j / radialSegs) * Math.PI * 2
            // Same ring orientation as TubeGeometry, so the winding matches.
            dir.copy(n).multiplyScalar(-Math.cos(theta)).addScaledVector(b, Math.sin(theta))
            const r = radiusAt(t, theta)
            positions.push(p.x + dir.x * r, p.y + dir.y * r, p.z + dir.z * r)
            colorAt(t, theta, color)
            colors.push(color.r, color.g, color.b)
        }
    }
    const ring = radialSegs + 1
    for (let i = 1; i <= lengthSegs; i++) {
        for (let j = 1; j <= radialSegs; j++) {
            const a = ring * (i - 1) + (j - 1)
            const bb = ring * i + (j - 1)
            const c = ring * i + j
            const d = ring * (i - 1) + j
            indices.push(a, bb, d, bb, c, d)
        }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()

    // The first and last vertex of each ring coincide; average their normals
    // so the seam doesn't show as a hard crease.
    const normal = geo.attributes.normal as THREE.BufferAttribute
    const avg = new THREE.Vector3()
    for (let i = 0; i <= lengthSegs; i++) {
        const first = i * ring
        const last = first + radialSegs
        avg.set(
            normal.getX(first) + normal.getX(last),
            normal.getY(first) + normal.getY(last),
            normal.getZ(first) + normal.getZ(last),
        ).normalize()
        normal.setXYZ(first, avg.x, avg.y, avg.z)
        normal.setXYZ(last, avg.x, avg.y, avg.z)
    }
    return geo
}

/** 0..1 ridge profile around a limb; wavy so ridges don't look machined. */
function barkRidge(t: number, theta: number, length: number, seed: number): number {
    const warp = fbm(Math.cos(theta) * 1.5, t * length * 1.2, Math.sin(theta) * 1.5, seed) * 2.5
    return 0.5 + 0.5 * Math.cos(BARK_RIDGES * theta + warp)
}

function barkColor(ridge: number, t: number, out: THREE.Color): void {
    out.lerpColors(BARK_DARK, BARK_LIGHT, 0.2 + 0.65 * ridge)
    out.multiplyScalar(0.8 + 0.2 * t) // a touch darker toward the soil
}

interface Clump {
    center: THREE.Vector3
    radius: number
}

interface TreeVariant {
    bark: THREE.BufferGeometry
    leaves: THREE.BufferGeometry
}

function buildVariant(seed: number): TreeVariant {
    const rng = makeRng(seed)
    const range = (lo: number, hi: number) => lo + (hi - lo) * rng()
    const height = TRUNK_HEIGHT * range(0.9, 1.15)

    // ---- Trunk: gently S-bent spline from just below the ground. ----
    const wander = () => range(-TRUNK_BEND, TRUNK_BEND)
    const trunkCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.2, 0),
        new THREE.Vector3(0, height * 0.15, 0),
        new THREE.Vector3(wander(), height * 0.45, wander()),
        new THREE.Vector3(wander(), height * 0.8, wander()),
        new THREE.Vector3(wander(), height, wander()),
    ])
    const trunkLength = trunkCurve.getLength()
    const lobePhase = rng() * Math.PI * 2
    const trunkRadiusAt = (t: number) => TRUNK_RADIUS * (1 - (1 - TRUNK_TOP_TAPER) * t)

    const limbs: THREE.BufferGeometry[] = []
    limbs.push(sweep(
        trunkCurve,
        TRUNK_LENGTH_SEGMENTS,
        TRUNK_RADIAL_SEGMENTS,
        (t, theta) => {
            const y = t * trunkLength - 0.2
            const flare = Math.exp(-Math.max(y, 0) / ROOT_FLARE_HEIGHT)
            const lobe = Math.max(0, Math.cos(ROOT_LOBES * theta + lobePhase)) ** 2
            const ridge = barkRidge(t, theta, trunkLength, seed)
            return trunkRadiusAt(t)
                * (1 + flare * ROOT_FLARE * (0.3 + 0.7 * lobe))
                * (1 + BARK_RIDGE_DEPTH * (ridge - 0.5) * 2)
        },
        (t, theta, out) => barkColor(barkRidge(t, theta, trunkLength, seed), t, out),
    ))

    // ---- Branches: spread around the trunk, arcing outward then up. ----
    const top = trunkCurve.getPointAt(1)
    const clumps: Clump[] = [{
        center: top.clone().add(new THREE.Vector3(0, 0.5, 0)),
        radius: CROWN_RADIUS * range(1, 1.15),
    }]
    const branchCount = BRANCH_MIN + Math.floor(rng() * (BRANCH_MAX - BRANCH_MIN + 1))
    const azimuth0 = rng() * Math.PI * 2
    for (let i = 0; i < branchCount; i++) {
        const t0 = range(BRANCH_START_MIN, BRANCH_START_MAX)
        const azimuth = azimuth0 + (i / branchCount) * Math.PI * 2 + range(-0.4, 0.4)
        const out = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth))
        const len = range(BRANCH_LENGTH_MIN, BRANCH_LENGTH_MAX)
        const r0 = trunkRadiusAt(t0) * BRANCH_RADIUS
        // Start buried inside the trunk so the joint has no visible gap.
        const start = trunkCurve.getPointAt(t0).addScaledVector(out, -trunkRadiusAt(t0) * 0.5)
        const tip = start.clone()
            .addScaledVector(out, len * 0.7)
            .add(new THREE.Vector3(0, len * range(0.7, 1.0), 0))
        const curve = new THREE.CatmullRomCurve3([
            start,
            start.clone().addScaledVector(out, len * 0.45).add(new THREE.Vector3(0, len * 0.25, 0)),
            tip,
        ])
        const branchLength = curve.getLength()
        const branchSeed = seed + 17 * (i + 1)
        limbs.push(sweep(
            curve,
            BRANCH_LENGTH_SEGMENTS,
            BRANCH_RADIAL_SEGMENTS,
            (t, theta) => r0 * (1 - 0.65 * t)
                * (1 + BARK_RIDGE_DEPTH * 0.7 * (barkRidge(t, theta, branchLength, branchSeed) - 0.5) * 2),
            (t, theta, out) => barkColor(barkRidge(t, theta, branchLength, branchSeed), 0.6 + 0.4 * t, out),
        ))
        clumps.push({
            center: tip.clone().add(new THREE.Vector3(0, 0.25, 0)),
            radius: CLUMP_RADIUS * range(1, 1.3),
        })
    }

    // ---- Foliage: main sphere per clump plus satellites, all displaced. ----
    const spheres: Clump[] = []
    for (const clump of clumps) {
        spheres.push(clump)
        for (let s = 0; s < SATELLITES_PER_CLUMP; s++) {
            // Bias satellites upward/outward; underneath is hidden anyway.
            const dir = new THREE.Vector3(range(-1, 1), range(-0.2, 0.8), range(-1, 1)).normalize()
            spheres.push({
                center: clump.center.clone().addScaledVector(dir, clump.radius * SATELLITE_OFFSET),
                radius: clump.radius * range(SATELLITE_RADIUS_MIN, SATELLITE_RADIUS_MAX),
            })
        }
    }

    let minY = Infinity, maxY = -Infinity
    const canopyCenter = new THREE.Vector3()
    for (const s of spheres) {
        minY = Math.min(minY, s.center.y - s.radius)
        maxY = Math.max(maxY, s.center.y + s.radius)
        canopyCenter.add(s.center)
    }
    canopyCenter.divideScalar(spheres.length)
    let canopyRadius = 0
    for (const s of spheres) {
        canopyRadius = Math.max(canopyRadius, s.center.distanceTo(canopyCenter) + s.radius)
    }

    const hueShift = range(-VARIANT_HUE_JITTER, VARIANT_HUE_JITTER)
    const lightShift = range(-VARIANT_LIGHTNESS_JITTER, VARIANT_LIGHTNESS_JITTER)
    const leafColor = (pos: THREE.Vector3, nrm: THREE.Vector3, out: THREE.Color) => {
        const h = (pos.y - minY) / (maxY - minY)
        const up = nrm.y * 0.5 + 0.5
        const outer = Math.min(pos.distanceTo(canopyCenter) / canopyRadius, 1)
        const speckle = fbm(pos.x * LEAF_SPECKLE_FREQ, pos.y * LEAF_SPECKLE_FREQ, pos.z * LEAF_SPECKLE_FREQ, seed + 13)
            * LEAF_SPECKLE * 0.5
        const k = THREE.MathUtils.clamp(-0.1 + 0.35 * h + 0.3 * up + 0.3 * outer + speckle, 0, 1)
        if (k < 0.5) out.lerpColors(LEAF_SHADOW, LEAF_MID, k * 2)
        else out.lerpColors(LEAF_MID, LEAF_LIGHT, (k - 0.5) * 2)
        out.offsetHSL(hueShift, 0, lightShift * k)
    }
    // Lumpy clump surface; cards are placed relative to it so canopies billow.
    const surfacePoint = (s: Clump, dir: THREE.Vector3, radius: number, out: THREE.Vector3) => {
        out.copy(s.center).addScaledVector(dir, s.radius)
        const lump = fbm(out.x * CLUMP_LUMP_FREQ, out.y * CLUMP_LUMP_FREQ, out.z * CLUMP_LUMP_FREQ, seed) * CLUMP_LUMP
            + fbm(out.x * CLUMP_BUMP_FREQ, out.y * CLUMP_BUMP_FREQ, out.z * CLUMP_BUMP_FREQ, seed + 7) * CLUMP_BUMP
        out.copy(s.center).addScaledVector(dir, radius * (1 + lump))
        if (dir.y < 0) out.y = s.center.y + (out.y - s.center.y) * CLUMP_FLATTEN
        return out
    }

    const n = new THREE.Vector3()
    const color = new THREE.Color()

    // ---- Leaf cards: alpha-cut sprigs filling the outer shell of each clump. ----
    // How deep a point sits inside the canopy: 0 at the surface of whichever
    // sphere encloses it most, 1 at that sphere's center.
    const depthAt = (pos: THREE.Vector3) => {
        let depth = -Infinity
        for (const o of spheres) depth = Math.max(depth, 1 - o.center.distanceTo(pos) / o.radius)
        return depth
    }
    const cardPositions: number[] = []
    const cardNormals: number[] = []
    const cardUvs: number[] = []
    const cardColors: number[] = []
    const cardIndices: number[] = []
    const dir = new THREE.Vector3()
    const center = new THREE.Vector3()
    const facing = new THREE.Vector3()
    const t1 = new THREE.Vector3()
    const t2 = new THREE.Vector3()
    const corner = new THREE.Vector3()
    const toCanopy = new THREE.Vector3()
    for (const s of spheres) {
        const count = Math.round(LEAF_CARDS_PER_M2 * 4 * Math.PI * s.radius * s.radius)
        for (let c = 0; c < count; c++) {
            // Uniform direction on the sphere.
            const y = range(-1, 1)
            const phi = rng() * Math.PI * 2
            const ring = Math.sqrt(1 - y * y)
            dir.set(ring * Math.cos(phi), y, ring * Math.sin(phi))
            // Biased toward the surface, but layered inward so gaps between
            // outer leaves show more (shadowed) leaves rather than sky.
            const shell = 1 - LEAF_SHELL_DEPTH * rng() ** 1.5
            surfacePoint(s, dir, s.radius * shell, center)
            const depth = depthAt(center)
            // Deep inside the canopy union nobody can see it.
            if (depth > LEAF_MAX_DEPTH) continue
            // Fake occlusion — the AO pass skips cards, so bake it in.
            const occlusion = THREE.MathUtils.clamp(1 - depth * LEAF_OCCLUSION, LEAF_MIN_LIGHT, 1)

            const size = LEAF_CARD_SIZE * range(0.8, 1.25) * 0.5
            facing.set(range(-1, 1), range(-1, 1), range(-1, 1))
                .multiplyScalar(LEAF_CARD_TWIST).add(dir).normalize()
            t1.set(0, 1, 0)
            if (Math.abs(facing.y) > 0.9) t1.set(1, 0, 0)
            t1.cross(facing).normalize().applyAxisAngle(facing, rng() * Math.PI * 2)
            t2.crossVectors(facing, t1)
            const flip = rng() < 0.5

            const base = cardPositions.length / 3
            for (let v = 0; v < 4; v++) {
                const su = v === 1 || v === 2 ? 1 : -1
                const sv = v >= 2 ? 1 : -1
                corner.copy(center).addScaledVector(t1, su * size).addScaledVector(t2, sv * size)
                cardPositions.push(corner.x, corner.y, corner.z)
                // Normals point away from the clump (blended with the whole
                // canopy) rather than along the card, so the canopy shades as
                // one soft volume instead of a pile of flat paper.
                n.subVectors(corner, s.center).normalize()
                toCanopy.subVectors(corner, canopyCenter).normalize()
                n.lerp(toCanopy, 0.5).normalize()
                cardNormals.push(n.x, n.y, n.z)
                const u = su > 0 ? 1 : 0
                cardUvs.push(flip ? 1 - u : u, sv > 0 ? 1 : 0)
                leafColor(corner, n, color)
                color.multiplyScalar(occlusion)
                cardColors.push(color.r, color.g, color.b)
            }
            cardIndices.push(base, base + 1, base + 2, base, base + 2, base + 3)
        }
    }
    const leaves = new THREE.BufferGeometry()
    leaves.setAttribute('position', new THREE.Float32BufferAttribute(cardPositions, 3))
    leaves.setAttribute('normal', new THREE.Float32BufferAttribute(cardNormals, 3))
    leaves.setAttribute('uv', new THREE.Float32BufferAttribute(cardUvs, 2))
    leaves.setAttribute('color', new THREE.Float32BufferAttribute(cardColors, 3))
    leaves.setIndex(cardIndices)

    const bark = mergeGeometries(limbs)
    for (const g of limbs) g.dispose()
    return { bark, leaves }
}

/**
 * A sprig of leaves drawn on a transparent canvas, used by every leaf card.
 * Leaves are painted in light greys — a tint mask — so the cards' vertex
 * colors supply the hue and the sunlit/shadow ramp.
 */
function createLeafTexture(): THREE.CanvasTexture {
    const size = LEAF_TEXTURE_SIZE
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    const rng = makeRng(VARIANT_SEED + 1)
    const mid = size / 2

    for (let i = 0; i < LEAVES_PER_SPRIG; i++) {
        const angle = rng() * Math.PI * 2
        const baseR = rng() * size * 0.14
        const bx = mid + Math.cos(angle) * baseR
        const by = mid + Math.sin(angle) * baseR
        const len = size * (0.24 + rng() * 0.14)
        const width = len * (0.32 + rng() * 0.12)
        const shade = Math.round(175 + rng() * 80)

        ctx.save()
        ctx.translate(bx, by)
        ctx.rotate(angle + (rng() - 0.5) * 0.8)
        // Pointed oval along +X: two curves meeting at the tip.
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.bezierCurveTo(len * 0.3, -width * 0.7, len * 0.75, -width * 0.45, len, 0)
        ctx.bezierCurveTo(len * 0.75, width * 0.45, len * 0.3, width * 0.7, 0, 0)
        ctx.closePath()
        const grad = ctx.createLinearGradient(0, -width / 2, 0, width / 2)
        grad.addColorStop(0, `rgb(${shade},${shade},${shade})`)
        grad.addColorStop(1, `rgb(${shade - 45},${shade - 45},${shade - 45})`)
        ctx.fillStyle = grad
        ctx.fill()
        ctx.strokeStyle = `rgba(0,0,0,0.25)`
        ctx.lineWidth = size / 256
        ctx.stroke()
        // Midrib.
        ctx.beginPath()
        ctx.moveTo(len * 0.05, 0)
        ctx.quadraticCurveTo(len * 0.5, width * 0.05, len * 0.92, 0)
        ctx.strokeStyle = `rgba(0,0,0,0.3)`
        ctx.lineWidth = size / 170
        ctx.stroke()
        ctx.restore()
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    return tex
}

/**
 * Stylized, animated-film style trees, generated procedurally: a root-flared
 * trunk with wavy bark ridges, a few curving branches, and a billowy canopy
 * of alpha-cut leaf cards layered through a cluster of clump volumes, painted
 * with a shadow→sunlit vertex-color ramp and baked depth occlusion, and lit
 * with sun translucency. Up to `VARIANT_COUNT` shapes are built once; each
 * placed tree is a bark mesh plus a leaf mesh culled for the fixed viewer, so
 * all trees share two materials, one leaf texture, and a few geometries.
 */
export class Trees {
    readonly group: THREE.Group
    // Built lazily, only for shapes some placed tree uses.
    private variants = new Map<number, TreeVariant>()
    private barkMat: THREE.MeshStandardMaterial
    private leafMat: THREE.MeshStandardMaterial
    private leafTexture: THREE.CanvasTexture
    // Shadow-map materials carrying the same wind displacement.
    private barkDepthMat: THREE.MeshDepthMaterial
    private leafDepthMat: THREE.MeshDepthMaterial
    // World-owned wind clock shared with the grass and flowers.
    private windTime: WindTime
    // Per-tree index subsets of a variant's leaf cards (see LEAF_CULL_DOT).
    private culledLeafGeos: THREE.BufferGeometry[] = []

    constructor(windTime: WindTime) {
        this.group = new THREE.Group()
        this.windTime = windTime

        this.barkMat = addRimLight(new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.95,
        }))
        this.leafTexture = createLeafTexture()
        this.leafMat = addRimLight(new THREE.MeshStandardMaterial({
            map: this.leafTexture,
            vertexColors: true,
            roughness: 0.75,
            alphaTest: LEAF_ALPHA_TEST,
            side: THREE.DoubleSide,
        }), LEAF_RIM_STRENGTH)
        const rimPatch = this.leafMat.onBeforeCompile
        this.leafMat.onBeforeCompile = (shader, renderer) => {
            rimPatch(shader, renderer)
            shader.fragmentShader = shader.fragmentShader
                // Double-sided materials flip the normal on back faces; card
                // normals are already the canopy's outward normals, so keep
                // them as authored.
                .replace(
                    '#include <normal_fragment_begin>',
                    THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'),
                )
                // Translucency: light from the sun (the only directional
                // light) passing through leaves between it and the eye.
                .replace(
                    '#include <lights_fragment_end>',
                    /* glsl */ `#include <lights_fragment_end>
                    #if NUM_DIR_LIGHTS > 0
                    {
                        float through = pow(
                            saturate(dot(-normalize(vViewPosition), directionalLights[0].direction)),
                            ${LEAF_TRANSLUCENCY_POWER.toFixed(2)});
                        reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color
                            * through * ${LEAF_TRANSLUCENCY.toFixed(3)};
                    }
                    #endif`,
                )
        }
        this.leafMat.customProgramCacheKey = () => `leaf-card-${LEAF_RIM_STRENGTH}-${LEAF_TRANSLUCENCY}`

        addWind(this.barkMat, this.windTime, TREE_WIND)
        addWind(this.leafMat, this.windTime, TREE_LEAF_WIND)
        this.barkDepthMat = addWind(new THREE.MeshDepthMaterial(), this.windTime, TREE_WIND)
        this.leafDepthMat = addWind(new THREE.MeshDepthMaterial({
            map: this.leafTexture,
            alphaTest: LEAF_ALPHA_TEST,
        }), this.windTime, TREE_LEAF_WIND)

        for (const tree of TREES) {
            this.group.add(this.makeTree(tree))
        }
    }

    private makeTree(spec: TreeSpec): THREE.Group {
        const hash = hash3(Math.round(spec.x * 10), 0, Math.round(spec.z * 10), VARIANT_SEED)
        const shape = (spec.variant ?? Math.floor(hash * VARIANT_COUNT)) % VARIANT_COUNT
        let variant = this.variants.get(shape)
        if (!variant) {
            variant = buildVariant(VARIANT_SEED + shape * 7919)
            this.variants.set(shape, variant)
        }

        const tree = new THREE.Group()
        tree.position.set(spec.x, 0, spec.z)
        // ZYX: yaw about the trunk first, then lean in world space, so the
        // lean direction doesn't depend on the yaw.
        tree.rotation.order = 'ZYX'
        tree.rotation.y = spec.rotationY ?? hash * 97 % (Math.PI * 2)
        if (spec.rotationZ !== undefined) tree.rotation.z = spec.rotationZ
        // Scale applies in local space, so the trunk base stays at the origin.
        if (spec.scale !== undefined) tree.scale.setScalar(spec.scale)

        const bark = new THREE.Mesh(variant.bark, this.barkMat)
        bark.castShadow = true
        bark.receiveShadow = true
        bark.customDepthMaterial = this.barkDepthMat
        tree.add(bark)

        const leaves = new THREE.Mesh(this.cullLeavesForViewer(variant.leaves, tree), this.leafMat)
        leaves.castShadow = true
        leaves.receiveShadow = true
        leaves.customDepthMaterial = this.leafDepthMat
        leaves.userData.skipAO = true // see ScaledGTAOPass
        tree.add(leaves)

        return tree
    }

    /**
     * A geometry sharing `source`'s attributes but indexing only the cards
     * that can face the fixed viewer, judged in this tree's local frame.
     */
    private cullLeavesForViewer(source: THREE.BufferGeometry, tree: THREE.Group): THREE.BufferGeometry {
        tree.updateMatrix()
        const viewer = VIEWER.clone().applyMatrix4(tree.matrix.clone().invert())
        const pos = source.attributes.position as THREE.BufferAttribute
        const normal = source.attributes.normal as THREE.BufferAttribute
        const src = source.index!
        const kept: number[] = []
        const center = new THREE.Vector3()
        const outward = new THREE.Vector3()
        const v = new THREE.Vector3()
        // Cards are 4 consecutive vertices and 6 consecutive indices each.
        for (let i = 0; i < src.count; i += 6) {
            const base = src.getX(i)
            center.set(0, 0, 0)
            outward.set(0, 0, 0)
            for (let k = 0; k < 4; k++) {
                center.add(v.fromBufferAttribute(pos, base + k))
                outward.add(v.fromBufferAttribute(normal, base + k))
            }
            center.multiplyScalar(0.25)
            v.subVectors(viewer, center).normalize()
            if (outward.normalize().dot(v) < LEAF_CULL_DOT) continue
            for (let k = 0; k < 6; k++) kept.push(src.getX(i + k))
        }
        const geo = new THREE.BufferGeometry()
        for (const name of Object.keys(source.attributes)) {
            geo.setAttribute(name, source.attributes[name])
        }
        geo.setIndex(kept)
        this.culledLeafGeos.push(geo)
        return geo
    }

    dispose(): void {
        for (const g of this.culledLeafGeos) g.dispose()
        for (const v of this.variants.values()) {
            v.bark.dispose()
            v.leaves.dispose()
        }
        this.barkMat.dispose()
        this.leafMat.dispose()
        this.barkDepthMat.dispose()
        this.leafDepthMat.dispose()
        this.leafTexture.dispose()
    }
}
