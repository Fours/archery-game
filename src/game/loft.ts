import * as THREE from 'three'

/**
 * One cross-section of a loft: a superellipse centered at `p + b*cx + n*cz`,
 * with half-extents `hx` along `b` and `hz` along `n`. `e` is the
 * superellipse exponent: 2 is an ellipse, larger values square the corners
 * (≈3 reads as a rounded rectangle). `b` and `n` should be unit length and
 * perpendicular; the loft travels between successive `p`s.
 */
export interface LoftStation {
    p: THREE.Vector3
    b: THREE.Vector3
    n: THREE.Vector3
    hx: number
    hz: number
    cx: number
    cz: number
    e: number
}

export function makeStation(): LoftStation {
    return {
        p: new THREE.Vector3(),
        b: new THREE.Vector3(1, 0, 0),
        n: new THREE.Vector3(0, 0, 1),
        hx: 0,
        hz: 0,
        cx: 0,
        cz: 0,
        e: 2,
    }
}

/**
 * Sweep a superellipse through `stations` into an indexed mesh with
 * `radial` (a multiple of 4) segments around. Each ring has a duplicated seam
 * vertex so UVs can wrap; UVs are in meters (U around the ring, centered on
 * the +n face so grain converges symmetrically as the section narrows; V along
 * the path). Shrink the end stations toward zero to close the tube.
 */
export function createLoft(stations: LoftStation[], radial: number): THREE.BufferGeometry {
    const ring = radial + 1
    const count = stations.length * ring
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    writeLoftPositions(pos, stations, radial)

    // UVs from the build-time pose; a deforming loft keeps them fixed.
    const uv = new Float32Array(count * 2)
    let v = 0
    for (let i = 0; i < stations.length; i++) {
        if (i > 0) v += stations[i].p.distanceTo(stations[i - 1].p)
        const base = i * ring
        const cum = [0]
        for (let j = 1; j < ring; j++) {
            const a = (base + j) * 3
            const b = (base + j - 1) * 3
            cum.push(cum[j - 1] + Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]))
        }
        const center = cum[radial / 4]
        for (let j = 0; j < ring; j++) {
            uv[(base + j) * 2] = cum[j] - center
            uv[(base + j) * 2 + 1] = v
        }
    }

    // Wind triangles so faces point outward regardless of the stations'
    // handedness: outward needs the travel direction along b × n.
    const s0 = stations[0]
    const travel = stations[stations.length - 1].p.clone().sub(s0.p)
    const flip = new THREE.Vector3().crossVectors(s0.b, s0.n).dot(travel) < 0
    const index: number[] = []
    for (let i = 0; i < stations.length - 1; i++) {
        for (let j = 0; j < radial; j++) {
            const a = i * ring + j
            const b = a + ring
            if (flip) index.push(a, b, a + 1, a + 1, b, b + 1)
            else index.push(a, a + 1, b, a + 1, b + 1, b)
        }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(index)
    computeLoftNormals(geo, stations.length, radial)
    return geo
}

/** Re-pose a loft built by createLoft from stations with the same count. */
export function updateLoft(geo: THREE.BufferGeometry, stations: LoftStation[], radial: number): void {
    const attr = geo.attributes.position as THREE.BufferAttribute
    writeLoftPositions(attr.array as Float32Array, stations, radial)
    attr.needsUpdate = true
    computeLoftNormals(geo, stations.length, radial)
    geo.computeBoundingSphere()
}

function writeLoftPositions(out: Float32Array, stations: LoftStation[], radial: number): void {
    let k = 0
    for (const s of stations) {
        const ex = 2 / s.e
        for (let j = 0; j <= radial; j++) {
            const a = (j / radial) * Math.PI * 2
            const c = Math.cos(a)
            const sn = Math.sin(a)
            const u = s.cx + s.hx * Math.sign(c) * Math.pow(Math.abs(c), ex)
            const w = s.cz + s.hz * Math.sign(sn) * Math.pow(Math.abs(sn), ex)
            out[k++] = s.p.x + s.b.x * u + s.n.x * w
            out[k++] = s.p.y + s.b.y * u + s.n.y * w
            out[k++] = s.p.z + s.b.z * u + s.n.z * w
        }
    }
}

/** Smooth normals, then average each ring's duplicated seam pair so the seam doesn't show. */
function computeLoftNormals(geo: THREE.BufferGeometry, rings: number, radial: number): void {
    geo.computeVertexNormals()
    const n = geo.attributes.normal as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let i = 0; i < rings; i++) {
        const a = i * (radial + 1)
        const b = a + radial
        v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize()
        n.setXYZ(a, v.x, v.y, v.z)
        n.setXYZ(b, v.x, v.y, v.z)
    }
    n.needsUpdate = true
}
