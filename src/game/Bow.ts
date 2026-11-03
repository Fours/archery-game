import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ArrowModel } from './ArrowModel'
import { createLoft, makeStation, updateLoft, type LoftStation } from './loft'
import { addRimLight, createBowWoodTexture, createLeatherWrapTexture, createStringTexture } from './materials'
import { sharedResource } from './shared'

// Overall size: the horn tip caps reach ±BOW_HALF_HEIGHT at rest.
const BOW_HALF_HEIGHT = 0.55
const FADE_Y = 0.14 // where each limb starts, buried in the riser
const RISER_END_Y = 0.205 // the riser tapers into the limb here
const LIMB_STEPS = 60
const LIMB_RADIAL = 20
const LIMB_E = 2.8 // superellipse exponent of the limb section
const LIMB_ANGLE0 = 0.12 // limb pocket angle toward the archer (rad)
const HORN_START = 0.9 // fraction of the limb sleeved in horn
const HORN_THICKNESS = 0.0013
const HORN_CAP = 0.0075 // horn cap length past the limb's end
const GROOVE_U = 0.955 // string groove, as a fraction of limb length

const STRING_RADIUS = 0.0026
const SERVING_RADIUS = 0.0031
const STRING_REST_OFFSET = 0.12 // nock z at rest (brace height)
const STRING_FULL_DRAW = 0.6 // nock z at full draw
const NOCK_Y = 0.045 // the arrow rests on the shelf
const CENTER_SERVING = 0.07 // served length either side of the nock
const END_SERVING = 0.045 // served length at each tip loop
const STRING_RING = 6
const STRING_WRAP_PTS = 18 // samples where the string lies on the recurve

// Limb flex: extra turn rate (rad per limb length) per unit of bend. The
// working section bends; the recurve partly unrolls; the horn tip stays rigid.
const BEND_WORK = 1.5
const BEND_UNROLL = 3.0
// Past-rest overshoot of the release wobble is shown at this fraction so the
// string never snaps back through the riser.
const OVERSHOOT_SCALE = 0.25
const SPRING_FREQ = 5.5 // Hz
const SPRING_DAMPING = 0.28
const SPRING_STEP = 1 / 240

const NOCKED_ARROW_SCALE = 0.93

const WOOD_COLOR = 0xf0a850
const ACCENT_WOOD_COLOR = 0x5a2c14
const HORN_COLOR = 0x3a2318
const BRASS_COLOR = 0xd8a548
const STRING_COLOR = new THREE.Color(0xeee2c6)
const SERVING_COLOR = new THREE.Color(0x3a2216)
const CORD_COLOR = 0x4a2a1a

// ---------------------------------------------------------------------------
// Limb centerline: a planar chain in bow-local (y, z), integrated from a turn
// rate along the limb. The upper limb rises from (FADE_Y, 0); the lower limb
// is its mirror in y. φ is the angle from +Y toward +Z (toward the archer).

interface Chain {
    phi: Float64Array
    y: Float64Array
    z: Float64Array
}

function makeChain(): Chain {
    const n = LIMB_STEPS + 1
    return { phi: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n) }
}

function smoothstep(a: number, b: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
}

function sineWindow(u: number, a: number, b: number): number {
    return u <= a || u >= b ? 0 : Math.sin((Math.PI * (u - a)) / (b - a))
}

/** Rest shape: a gently curved working section, then a tight recurve. */
function restTurn(u: number): number {
    return THREE.MathUtils.lerp(0.25, -3.6, smoothstep(0.66, 0.76, u))
}

function bendTurn(u: number): number {
    return BEND_WORK * sineWindow(u, 0.18, 0.72) + BEND_UNROLL * sineWindow(u, 0.7, 0.88)
}

function solveChain(bend: number, ds: number, out: Chain): void {
    const du = 1 / LIMB_STEPS
    let phi = LIMB_ANGLE0
    let y = 0
    let z = 0
    out.phi[0] = phi
    out.y[0] = 0
    out.z[0] = 0
    for (let i = 1; i <= LIMB_STEPS; i++) {
        const um = (i - 0.5) * du
        const dphi = (restTurn(um) + bend * bendTurn(um)) * du
        const mid = phi + dphi / 2
        y += ds * Math.cos(mid)
        z += ds * Math.sin(mid)
        phi += dphi
        out.phi[i] = phi
        out.y[i] = y
        out.z[i] = z
    }
}

// Step length chosen so the rest tip (plus horn cap) lands at BOW_HALF_HEIGHT.
const LIMB_DS = (() => {
    const c = makeChain()
    solveChain(0, 1, c)
    return (BOW_HALF_HEIGHT - HORN_CAP - FADE_Y) / c.y[LIMB_STEPS]
})()

const REST = makeChain()
solveChain(0, LIMB_DS, REST)

const HORN_INDEX = Math.round(HORN_START * LIMB_STEPS)
const GROOVE_INDEX = Math.round(GROOVE_U * LIMB_STEPS)
/** First limb station past the riser end; the brass fade band covers the joint here. */
const BAND_INDEX = (() => {
    let i = 0
    while (FADE_Y + REST.y[i] < RISER_END_Y + 0.006) i++
    return i
})()

function limbHalfWidth(u: number): number {
    return THREE.MathUtils.lerp(0.0175, 0.0085, smoothstep(0, 1, u))
}

function limbHalfThickness(u: number): number {
    return THREE.MathUtils.lerp(0.0078, 0.005, u)
}

/**
 * Pose `st` as limb station `i` of `chain` for the upper (sign = 1) or lower
 * (sign = -1) limb. `grow` thickens the section (sleeves, bands); `extend`
 * pushes past the station along the limb's tangent; `scale` shrinks the
 * section (for end caps). `n` is the belly normal, toward the string.
 */
function setLimbStation(
    st: LoftStation,
    chain: Chain,
    i: number,
    sign: number,
    grow = 0,
    extend = 0,
    scale = 1,
): LoftStation {
    const c = Math.cos(chain.phi[i])
    const s = Math.sin(chain.phi[i])
    const u = i / LIMB_STEPS
    st.p.set(0, sign * (FADE_Y + chain.y[i] + c * extend), chain.z[i] + s * extend)
    st.b.set(1, 0, 0)
    st.n.set(0, -sign * s, c)
    st.hx = (limbHalfWidth(u) + grow) * scale
    st.hz = (limbHalfThickness(u) + grow) * scale
    st.cx = 0
    st.cz = 0
    st.e = LIMB_E
    return st
}

/** Limb stations 0..LIMB_STEPS plus a rounded end cap (hidden inside the horn). */
function poseLimb(stations: LoftStation[], chain: Chain, sign: number): void {
    for (let i = 0; i <= LIMB_STEPS; i++) setLimbStation(stations[i], chain, i, sign)
    setLimbStation(stations[LIMB_STEPS + 1], chain, LIMB_STEPS, sign, 0, 0.0015, 0.75)
    setLimbStation(stations[LIMB_STEPS + 2], chain, LIMB_STEPS, sign, 0, 0.003, 0.2)
}

/** Horn sleeve over the limb tip: a collar step, then a rounded cap past the end. */
function hornStations(sign: number): LoftStation[] {
    const t = HORN_THICKNESS
    const out = [
        setLimbStation(makeStation(), REST, HORN_INDEX, sign, 0.0002),
        setLimbStation(makeStation(), REST, HORN_INDEX, sign, 0.0024),
        setLimbStation(makeStation(), REST, HORN_INDEX + 1, sign, 0.0024),
    ]
    for (let i = HORN_INDEX + 2; i <= LIMB_STEPS; i++) out.push(setLimbStation(makeStation(), REST, i, sign, t))
    out.push(
        setLimbStation(makeStation(), REST, LIMB_STEPS, sign, t, 0.003, 0.85),
        setLimbStation(makeStation(), REST, LIMB_STEPS, sign, t, 0.0055, 0.55),
        setLimbStation(makeStation(), REST, LIMB_STEPS, sign, t, HORN_CAP, 0.12),
    )
    return out
}

/** Brass band wrapping the limb where it leaves the riser. */
function bandStations(sign: number): LoftStation[] {
    const i = BAND_INDEX
    return [
        setLimbStation(makeStation(), REST, i - 1, sign, -0.0003),
        setLimbStation(makeStation(), REST, i - 1, sign, 0.0019),
        setLimbStation(makeStation(), REST, i, sign, 0.0021),
        setLimbStation(makeStation(), REST, i + 1, sign, 0.0019),
        setLimbStation(makeStation(), REST, i + 1, sign, -0.0003),
    ]
}

/** Closed loop of string seated in the tip groove. */
function loopGeometry(sign: number): THREE.BufferGeometry {
    const st = setLimbStation(makeStation(), REST, GROOVE_INDEX, sign, HORN_THICKNESS + STRING_RADIUS)
    const pts: THREE.Vector3[] = []
    const ex = 2 / st.e
    for (let j = 0; j < 32; j++) {
        const a = (j / 32) * Math.PI * 2
        const c = Math.cos(a)
        const s = Math.sin(a)
        pts.push(
            st.p
                .clone()
                .addScaledVector(st.b, st.hx * Math.sign(c) * Math.pow(Math.abs(c), ex))
                .addScaledVector(st.n, st.hz * Math.sign(s) * Math.pow(Math.abs(s), ex)),
        )
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 48, STRING_RADIUS * 1.15, 6, true)
}

// ---------------------------------------------------------------------------
// Riser: lofted along +Y through keyed cross-sections, smoothstep-interpolated
// so keys never overshoot. The sight window (x0 jumps to the right of the
// arrow) is cut above the shelf on the archer-visible -X side; the grip
// swells toward the archer's palm (+Z).

interface RiserKey {
    y: number
    cx: number
    hx: number
    cz: number
    hz: number
    e: number
}

function key(y: number, x0: number, x1: number, cz: number, hz: number, e = 3.2): RiserKey {
    return { y, cx: (x0 + x1) / 2, hx: (x1 - x0) / 2, cz, hz, e }
}

/** Key matching (just inside) the limb section at the riser's end. */
function endKey(sign: number): RiserKey {
    let i = 0
    while (FADE_Y + REST.y[i] < RISER_END_Y) i++
    const u = i / LIMB_STEPS
    return {
        y: sign * RISER_END_Y,
        cx: 0,
        hx: limbHalfWidth(u) * 0.9,
        cz: REST.z[i],
        hz: limbHalfThickness(u) * 0.8,
        e: LIMB_E,
    }
}

const RISER_KEYS: RiserKey[] = [
    endKey(-1),
    key(-0.165, -0.019, 0.019, 0.004, 0.0125),
    key(-0.13, -0.0195, 0.0195, 0, 0.017),
    key(-0.1, -0.019, 0.019, 0.003, 0.02, 2.8),
    key(-0.075, -0.019, 0.019, 0.009, 0.024, 2.6),
    key(-0.04, -0.0205, 0.0205, 0.013, 0.027, 2.6),
    key(-0.005, -0.019, 0.019, 0.009, 0.024, 2.6),
    key(0.02, -0.019, 0.019, 0.004, 0.021, 2.8),
    key(0.0335, -0.0195, 0.021, 0, 0.02), // arrow shelf
    key(0.035, 0.0115, 0.022, 0, 0.02), // sight window
    key(0.06, 0.0125, 0.022, 0, 0.02),
    key(0.09, 0.0115, 0.022, 0, 0.02),
    key(0.115, -0.02, 0.021, 0, 0.019),
    key(0.145, -0.02, 0.02, 0.002, 0.016),
    key(0.175, -0.019, 0.019, 0.005, 0.0115),
    endKey(1),
]

function riserAt(y: number): RiserKey {
    let k = 0
    while (k < RISER_KEYS.length - 2 && RISER_KEYS[k + 1].y < y) k++
    const a = RISER_KEYS[k]
    const b = RISER_KEYS[k + 1]
    const t = smoothstep(a.y, b.y, y)
    const lerp = THREE.MathUtils.lerp
    return {
        y,
        cx: lerp(a.cx, b.cx, t),
        hx: lerp(a.hx, b.hx, t),
        cz: lerp(a.cz, b.cz, t),
        hz: lerp(a.hz, b.hz, t),
        e: lerp(a.e, b.e, t),
    }
}

function riserStation(y: number, grow: number, de = 0): LoftStation {
    const r = riserAt(y)
    const st = makeStation()
    st.p.set(0, y, 0)
    st.cx = r.cx
    st.cz = r.cz
    st.hx = r.hx + grow
    st.hz = r.hz + grow
    st.e = r.e + de
    return st
}

function riserGeometry(): THREE.BufferGeometry {
    const stations: LoftStation[] = []
    const sub = 5
    for (let k = 0; k < RISER_KEYS.length - 1; k++) {
        for (let s = 0; s < sub; s++) {
            const y = THREE.MathUtils.lerp(RISER_KEYS[k].y, RISER_KEYS[k + 1].y, s / sub)
            stations.push(riserStation(y, 0))
        }
    }
    stations.push(riserStation(RISER_KEYS[RISER_KEYS.length - 1].y, 0))
    return createLoft(stations, 24)
}

/** A sleeve over the riser between y0 and y1, thickened by `grow(t)` for t in 0..1. */
function riserSleeve(y0: number, y1: number, steps: number, grow: (t: number) => number, de = 0): THREE.BufferGeometry {
    const stations: LoftStation[] = []
    for (let s = 0; s <= steps; s++) {
        const t = s / steps
        stations.push(riserStation(THREE.MathUtils.lerp(y0, y1, t), grow(t), de))
    }
    return createLoft(stations, 24)
}

/** Raised ring band with a rounded profile (cord bindings, inlay rings). */
function riserRing(y: number, width: number, height: number): THREE.BufferGeometry {
    return riserSleeve(y - width / 2, y + width / 2, 8, (t) => 0.0002 + height * Math.sqrt(Math.sin(Math.PI * t)), -0.4)
}

/** Brass medallions inlaid on both side faces, above and below the grip. */
function medallionGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = []
    for (const y of [0.163, -0.152]) {
        const r = riserAt(y)
        for (const side of [-1, 1]) {
            const face = r.cx + side * r.hx
            const disk = new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 24)
            disk.rotateZ(Math.PI / 2)
            disk.translate(face + side * 0.0008, y, r.cz)
            const ring = new THREE.TorusGeometry(0.0072, 0.0011, 8, 24)
            ring.rotateY(Math.PI / 2)
            ring.translate(face + side * 0.0028, y, r.cz)
            const boss = new THREE.SphereGeometry(0.0036, 14, 10)
            boss.scale(0.55, 1, 1)
            boss.translate(face + side * 0.0028, y, r.cz)
            parts.push(disk.toNonIndexed(), ring.toNonIndexed(), boss.toNonIndexed())
        }
    }
    for (const p of parts) p.deleteAttribute('uv')
    return mergeGeometries(parts)
}

// ---------------------------------------------------------------------------
// Shared assets: textures, materials and every static geometry. Display bows
// and the player's bow all use one set (see sharedResource).

class BowAssets {
    readonly woodTex = createBowWoodTexture()
    readonly leatherTex = createLeatherWrapTexture()
    readonly stringTex = createStringTexture()

    readonly wood = addRimLight(
        new THREE.MeshPhysicalMaterial({
            color: WOOD_COLOR,
            map: this.woodTex,
            bumpMap: this.woodTex,
            bumpScale: 0.4,
            roughness: 0.42,
            clearcoat: 0.55,
            clearcoatRoughness: 0.28,
        }),
        0.14,
    )
    readonly accentWood = new THREE.MeshPhysicalMaterial({
        color: ACCENT_WOOD_COLOR,
        map: this.woodTex,
        roughness: 0.4,
        clearcoat: 0.6,
        clearcoatRoughness: 0.25,
    })
    readonly horn = addRimLight(
        new THREE.MeshPhysicalMaterial({
            color: HORN_COLOR,
            map: this.woodTex,
            roughness: 0.3,
            clearcoat: 0.8,
            clearcoatRoughness: 0.15,
        }),
        0.12,
    )
    readonly leather = addRimLight(
        new THREE.MeshStandardMaterial({
            map: this.leatherTex,
            bumpMap: this.leatherTex,
            bumpScale: 1.5,
            roughness: 0.72,
        }),
        0.1,
    )
    readonly brass = new THREE.MeshStandardMaterial({ color: BRASS_COLOR, metalness: 1, roughness: 0.3 })
    readonly string = new THREE.MeshStandardMaterial({ vertexColors: true, map: this.stringTex, roughness: 0.65 })
    readonly cord = new THREE.MeshStandardMaterial({ color: CORD_COLOR, map: this.stringTex, roughness: 0.7 })

    readonly riserGeo = riserGeometry()
    readonly leatherGeo = riserSleeve(-0.088, 0.02, 40, (t) => 0.0004 + 0.0018 * smoothstep(0, 0.06, t) * smoothstep(1, 0.94, t), -0.3)
    readonly cordGeo = mergeGeometries([riserRing(0.0235, 0.006, 0.0028), riserRing(-0.0915, 0.006, 0.0028)])
    readonly accentGeo = mergeGeometries([riserRing(0.122, 0.0045, 0.001), riserRing(-0.118, 0.0045, 0.001)])
    readonly medallionGeo = medallionGeometry()
    readonly nockPointGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.0065, 12)
    // Per-limb attachments, built in the rest pose; indexed [upper, lower].
    readonly hornGeo = [1, -1].map((s) => createLoft(hornStations(s), LIMB_RADIAL))
    readonly bandGeo = [1, -1].map((s) => createLoft(bandStations(s), LIMB_RADIAL))
    readonly loopGeo = [1, -1].map(loopGeometry)

    dispose(): void {
        const geos = [
            this.riserGeo,
            this.leatherGeo,
            this.cordGeo,
            this.accentGeo,
            this.medallionGeo,
            this.nockPointGeo,
            ...this.hornGeo,
            ...this.bandGeo,
            ...this.loopGeo,
        ]
        for (const g of geos) g.dispose()
        for (const m of [this.wood, this.accentWood, this.horn, this.leather, this.brass, this.string, this.cord]) m.dispose()
        this.woodTex.dispose()
        this.leatherTex.dispose()
        this.stringTex.dispose()
    }
}

const sharedAssets = sharedResource(() => new BowAssets())

const _m = new THREE.Matrix4()
const _r = new THREE.Matrix4()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _dir = new THREE.Vector3()
const CYLINDER_AXIS = new THREE.Vector3(0, 1, 0)

/**
 * A carved honey-wood recurve: lofted riser with a sight window, arrow shelf,
 * leather grip, cord bindings, dark inlay rings and brass medallions; limbs
 * with a true recurve, brass fade bands and glossy horn tips; and a served
 * string that wraps the recurve bellies and the tip grooves.
 *
 * The limbs flex with draw: each limb is a planar chain re-solved for the
 * current bend, the limb lofts are re-posed on the CPU, rigid attachments
 * (horn, band, loop) follow their anchor station, and the string is rebuilt
 * to lie tangent on the limb bellies. `release()` hands the bend to a damped
 * spring for a cartoony twang; call `update(dt)` every frame to run it.
 *
 * Frame: bow-local -Z points at the target, +Z back at the archer.
 */
export class Bow {
    readonly group = new THREE.Group()
    private chain = makeChain()
    private limbStations: LoftStation[][]
    private limbGeos: THREE.BufferGeometry[]
    private attachments: { mesh: THREE.Mesh; index: number; sign: number }[] = []
    private stringGeo: THREE.BufferGeometry
    private nockPoint: THREE.Mesh
    private nockedArrow: ArrowModel
    private nock = new THREE.Vector3()
    private bend = 0
    private bendVelocity = 0
    private springing = false
    private appliedBend = NaN

    constructor() {
        const a = sharedAssets.acquire()

        this.group.add(
            new THREE.Mesh(a.riserGeo, a.wood),
            new THREE.Mesh(a.leatherGeo, a.leather),
            new THREE.Mesh(a.cordGeo, a.cord),
            new THREE.Mesh(a.accentGeo, a.accentWood),
            new THREE.Mesh(a.medallionGeo, a.brass),
        )

        this.limbStations = [1, -1].map(() => Array.from({ length: LIMB_STEPS + 3 }, makeStation))
        this.limbGeos = [1, -1].map((sign, k) => {
            poseLimb(this.limbStations[k], REST, sign)
            const geo = createLoft(this.limbStations[k], LIMB_RADIAL)
            this.group.add(new THREE.Mesh(geo, a.wood))
            return geo
        })

        ;[1, -1].forEach((sign, k) => {
            this.attach(new THREE.Mesh(a.hornGeo[k], a.horn), HORN_INDEX, sign)
            this.attach(new THREE.Mesh(a.bandGeo[k], a.brass), BAND_INDEX, sign)
            this.attach(new THREE.Mesh(a.loopGeo[k], a.cord), GROOVE_INDEX, sign)
        })

        this.stringGeo = createStringGeometry()
        this.group.add(new THREE.Mesh(this.stringGeo, a.string))
        this.nockPoint = new THREE.Mesh(a.nockPointGeo, a.brass)
        this.group.add(this.nockPoint)

        this.nockedArrow = new ArrowModel()
        this.nockedArrow.group.scale.setScalar(NOCKED_ARROW_SCALE)
        this.nockedArrow.group.visible = false
        this.group.add(this.nockedArrow.group)

        this.applyBend()
    }

    /** Set draw amount in [0, 1]; 0 snaps the bow straight back to rest. */
    setDraw(amount: number): void {
        const a = Math.max(0, Math.min(1, amount))
        this.springing = false
        this.bendVelocity = 0
        this.bend = a
        this.nockedArrow.group.visible = a > 0
        this.applyBend()
    }

    /** Loose the arrow: hide it and let the limbs spring back with a wobble. */
    release(): void {
        this.nockedArrow.group.visible = false
        this.springing = this.bend !== 0
    }

    update(dt: number): void {
        if (!this.springing) return
        const w = Math.PI * 2 * SPRING_FREQ
        let t = dt
        while (t > 1e-6) {
            const h = Math.min(SPRING_STEP, t)
            t -= h
            this.bendVelocity += (-w * w * this.bend - 2 * SPRING_DAMPING * w * this.bendVelocity) * h
            this.bend += this.bendVelocity * h
        }
        if (Math.abs(this.bend) < 1e-4 && Math.abs(this.bendVelocity) < 1e-3) {
            this.bend = 0
            this.bendVelocity = 0
            this.springing = false
        }
        this.applyBend()
    }

    private attach(mesh: THREE.Mesh, index: number, sign: number): void {
        mesh.matrixAutoUpdate = false
        this.group.add(mesh)
        this.attachments.push({ mesh, index, sign })
    }

    private applyBend(): void {
        if (this.bend === this.appliedBend) return
        this.appliedBend = this.bend
        const b = this.bend >= 0 ? this.bend : this.bend * OVERSHOOT_SCALE

        solveChain(b, LIMB_DS, this.chain)
        ;[1, -1].forEach((sign, k) => {
            poseLimb(this.limbStations[k], this.chain, sign)
            updateLoft(this.limbGeos[k], this.limbStations[k], LIMB_RADIAL)
        })

        // Rigid attachments: rotate about X by the anchor's change in angle and
        // carry its rest position to its current one.
        for (const { mesh, index, sign } of this.attachments) {
            _a.set(0, sign * (FADE_Y + REST.y[index]), REST.z[index])
            _b.set(0, sign * (FADE_Y + this.chain.y[index]), this.chain.z[index])
            _r.makeRotationX(sign * (this.chain.phi[index] - REST.phi[index]))
            mesh.matrix.makeTranslation(_b.x, _b.y, _b.z).multiply(_r).multiply(_m.makeTranslation(-_a.x, -_a.y, -_a.z))
            mesh.matrixWorldNeedsUpdate = true
        }

        const nockZ = STRING_REST_OFFSET + (STRING_FULL_DRAW - STRING_REST_OFFSET) * b
        this.nock.set(0, NOCK_Y, nockZ)
        const upper = stringHalf(this.chain, this.nock, 1)
        const lower = stringHalf(this.chain, this.nock, -1)
        writeString(this.stringGeo, upper, lower)

        // Brass nocking point just above the arrow, along the upper string.
        _dir.copy(upper[1]).sub(this.nock).normalize()
        this.nockPoint.position.copy(this.nock).addScaledVector(_dir, 0.0135)
        this.nockPoint.quaternion.setFromUnitVectors(CYLINDER_AXIS, _dir)

        this.nockedArrow.group.position.copy(this.nock)
    }

    dispose(): void {
        for (const g of this.limbGeos) g.dispose()
        this.stringGeo.dispose()
        this.nockedArrow.dispose()
        sharedAssets.release()
    }
}

// ---------------------------------------------------------------------------
// String

/** Belly-surface point the string rests on at limb station i (horn-aware). */
function bellyPoint(chain: Chain, i: number, sign: number, out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(chain.phi[i])
    const s = Math.sin(chain.phi[i])
    const lift = limbHalfThickness(i / LIMB_STEPS) + (i >= HORN_INDEX ? HORN_THICKNESS : 0) + STRING_RADIUS
    return out.set(0, sign * (FADE_Y + chain.y[i]) - sign * s * lift, chain.z[i] + c * lift)
}

const STRAIGHT_PTS = 8
const HALF_PTS = STRAIGHT_PTS + STRING_WRAP_PTS
const STRING_PTS = HALF_PTS * 2 - 1

/**
 * One half of the string, from the nock out to the tip groove: a straight run
 * to the point where it meets the limb tangentially, then along the recurve
 * belly to the groove. The contact point is the belly sample the line from the
 * nock reaches with the steepest slope toward the archer, so everything
 * between lies on the far side of the string. Returns HALF_PTS points.
 */
function stringHalf(chain: Chain, nock: THREE.Vector3, sign: number): THREE.Vector3[] {
    const belly: THREE.Vector3[] = []
    for (let i = 0; i <= GROOVE_INDEX; i++) belly.push(bellyPoint(chain, i, sign, new THREE.Vector3()))

    let contact = GROOVE_INDEX
    let best = -Infinity
    for (let i = 0; i <= GROOVE_INDEX; i++) {
        const dy = Math.abs(belly[i].y - nock.y)
        if (dy < 0.05) continue
        const slope = (belly[i].z - nock.z) / dy
        if (slope > best) {
            best = slope
            contact = i
        }
    }

    // Wrap section, resampled evenly by arc length.
    const wrap = belly.slice(contact)
    const cum = [0]
    for (let i = 1; i < wrap.length; i++) cum.push(cum[i - 1] + wrap[i].distanceTo(wrap[i - 1]))
    const wrapLen = cum[cum.length - 1]

    const out: THREE.Vector3[] = []
    // Straight run: dense around the center serving's ends and where the end
    // serving begins if it reaches past the contact point.
    const len = nock.distanceTo(belly[contact])
    const endServe = Math.min(Math.max(END_SERVING - wrapLen, 0.01), len * 0.25)
    const dists = [0, CENTER_SERVING - 0.004, CENTER_SERVING + 0.004, len * 0.4, len * 0.7, len - endServe - 0.004, len - endServe + 0.004, len]
    for (const d of dists) out.push(nock.clone().lerp(belly[contact], d / len))

    let seg = 0
    for (let k = 1; k <= STRING_WRAP_PTS; k++) {
        const target = (k / STRING_WRAP_PTS) * wrapLen
        while (seg < wrap.length - 2 && cum[seg + 1] < target) seg++
        const span = cum[seg + 1] - cum[seg]
        const f = span > 1e-9 && wrap.length > 1 ? (target - cum[seg]) / span : 0
        out.push(wrap.length > 1 ? wrap[seg].clone().lerp(wrap[seg + 1], f) : wrap[0].clone())
    }
    return out
}

function createStringGeometry(): THREE.BufferGeometry {
    const ring = STRING_RING + 1
    const count = STRING_PTS * ring
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    const index: number[] = []
    for (let i = 0; i < STRING_PTS - 1; i++) {
        for (let j = 0; j < STRING_RING; j++) {
            const a = i * ring + j
            const b = a + ring
            index.push(a, b, a + 1, a + 1, b, b + 1)
        }
    }
    geo.setIndex(index)
    return geo
}

/**
 * Rebuild the string tube along groove → nock → groove. Every point lies in
 * the bow's YZ plane, so each ring is spanned by +X and the in-plane
 * perpendicular to the tangent: no frame twisting to worry about.
 */
function writeString(geo: THREE.BufferGeometry, upper: THREE.Vector3[], lower: THREE.Vector3[]): void {
    const pts = [...upper.slice().reverse(), ...lower.slice(1)]
    const pos = geo.attributes.position as THREE.BufferAttribute
    const nor = geo.attributes.normal as THREE.BufferAttribute
    const uv = geo.attributes.uv as THREE.BufferAttribute
    const col = geo.attributes.color as THREE.BufferAttribute

    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]))
    const total = cum[cum.length - 1]
    const nockAt = cum[HALF_PTS - 1]

    let ty = 1
    let tz = 0
    for (let i = 0; i < pts.length; i++) {
        const prev = pts[Math.max(0, i - 1)]
        const next = pts[Math.min(pts.length - 1, i + 1)]
        const dy = next.y - prev.y
        const dz = next.z - prev.z
        const l = Math.hypot(dy, dz)
        // Collapsed samples (string fully off the recurve) keep the last tangent.
        if (l > 1e-7) {
            ty = dy / l
            tz = dz / l
        }
        const served = Math.abs(cum[i] - nockAt) < CENTER_SERVING || cum[i] < END_SERVING || total - cum[i] < END_SERVING
        const r = served ? SERVING_RADIUS : STRING_RADIUS
        const c = served ? SERVING_COLOR : STRING_COLOR
        for (let j = 0; j <= STRING_RING; j++) {
            const a = (j / STRING_RING) * Math.PI * 2
            // Ring direction: cos(a)·X + sin(a)·(in-plane normal (0, -tz, ty)).
            const nx = Math.cos(a)
            const ny = -Math.sin(a) * tz
            const nz = Math.sin(a) * ty
            const k = i * (STRING_RING + 1) + j
            pos.setXYZ(k, pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r)
            nor.setXYZ(k, nx, ny, nz)
            uv.setXY(k, a * r, cum[i])
            col.setXYZ(k, c.r, c.g, c.b)
        }
    }
    pos.needsUpdate = true
    nor.needsUpdate = true
    uv.needsUpdate = true
    col.needsUpdate = true
    geo.computeBoundingSphere()
}
