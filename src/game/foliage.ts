import * as THREE from 'three'

// Procedural building blocks for the ground cover (grass tufts, flower stems,
// leaves and petals). Everything is vertex-colored with a dark-base → light-tip
// ramp — the same painted shading the tree canopy uses — and emits position,
// normal and color only, so pieces can be merged with mergeGeometries.

const UP = new THREE.Vector3(0, 1, 0)

export type BladeSpec = {
    /** Base position. */
    x: number
    z: number
    y?: number
    /** Direction the blade leans toward, radians about +Y (0 = +Z). */
    yaw: number
    /** Path length, meters. */
    length: number
    /** Width at the base, meters; tapers to a point. */
    width: number
    /** Lean from vertical at the base, radians. */
    lean: number
    /** Extra lean added toward the tip (∝ t²) — the droop. */
    curl: number
    segments: number
    /** Height of the center crease as a fraction of width (0 = flat). */
    fold: number
    baseColor: THREE.Color
    tipColor: THREE.Color
    /**
     * How far normals blend toward straight up (0..1). Grass uses a high value
     * so it shades like the lawn it grows from instead of going dark whenever
     * a blade turns away from the sun.
     */
    upNormal: number
}

/**
 * A tapered, creased blade bending along a planar curve: rows of three
 * vertices (left edge, raised crease, right edge) up the spine, closing in a
 * single tip vertex. Used for grass and for flower leaves.
 */
export function buildBlade(b: BladeSpec): THREE.BufferGeometry {
    const outward = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw))
    const side = new THREE.Vector3(Math.cos(b.yaw), 0, -Math.sin(b.yaw))
    const positions: number[] = []
    const normals: number[] = []
    const colors: number[] = []
    const indices: number[] = []

    const p = new THREE.Vector3(b.x, b.y ?? 0, b.z)
    const tangent = new THREE.Vector3()
    const n = new THREE.Vector3()
    const v = new THREE.Vector3()
    const color = new THREE.Color()
    const ds = b.length / b.segments

    const push = (pos: THREE.Vector3, normal: THREE.Vector3, t: number) => {
        positions.push(pos.x, pos.y, pos.z)
        normals.push(normal.x, normal.y, normal.z)
        color.lerpColors(b.baseColor, b.tipColor, THREE.MathUtils.smoothstep(t, 0, 1))
        colors.push(color.r, color.g, color.b)
    }

    for (let i = 0; i <= b.segments; i++) {
        const t = i / b.segments
        const angle = b.lean + b.curl * t * t
        tangent.copy(outward).multiplyScalar(Math.sin(angle)).addScaledVector(UP, Math.cos(angle))
        // Faces outward-and-up; blended toward world up for soft lighting.
        n.crossVectors(side, tangent).normalize().lerp(UP, b.upNormal).normalize()
        if (i === b.segments) {
            push(p, n, 1)
        } else {
            const w = b.width * Math.pow(1 - t, 0.7) * 0.5
            push(v.copy(p).addScaledVector(side, -w), n, t)
            push(v.copy(p).addScaledVector(n, b.fold * w * 2), n, t)
            push(v.copy(p).addScaledVector(side, w), n, t)
        }
        if (i > 0) {
            const a = (i - 1) * 3
            const c = i * 3
            if (i === b.segments) {
                indices.push(a, a + 1, c, a + 1, a + 2, c)
            } else {
                indices.push(a, a + 1, c, a + 1, c + 1, c, a + 1, a + 2, c + 1, a + 2, c + 2, c + 1)
            }
        }
        p.addScaledVector(tangent, ds)
    }

    return toGeometry(positions, normals, colors, indices)
}

export type PetalSpec = {
    /** Distance from the head's axis where the petal attaches. */
    inner: number
    length: number
    /** Maximum width, meters. */
    width: number
    /** Upward tilt at the base, radians. */
    cup: number
    /** Downward curl toward the tip, as a fraction of length. */
    droop: number
    /** How much the side edges lift, making a spoon shape (fraction of width). */
    spoon: number
    /** Rounded (1) vs pointed (0) tip. */
    round: number
    baseColor: THREE.Color
    tipColor: THREE.Color
}

/**
 * One petal lying along +X in the head's local frame (head axis = +Y), as a
 * small grid so it can cup and droop. Rotate copies around Y to make a bloom.
 */
export function buildPetal(s: PetalSpec, rotation: number): THREE.BufferGeometry {
    const along = 5
    const across = 4
    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const color = new THREE.Color()
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const rise = Math.tan(s.cup)

    for (let i = 0; i <= along; i++) {
        const u = i / along
        // Outline: flares from a narrow claw to full width at 60%, then closes
        // along an ellipse (round) or a straight taper (pointed). A round tip
        // keeps a little width on the last row so it reads blunt, not spiky.
        const k = Math.max(0, (u - 0.6) / 0.4)
        const shape = u <= 0.6
            ? 0.35 + 0.65 * Math.sin((u / 0.6) * Math.PI * 0.5)
            : Math.max(s.round * Math.sqrt(1 - k * k) + (1 - s.round) * (1 - k), 0.3 * s.round)
        const w = s.width * 0.5 * shape
        for (let j = 0; j <= across; j++) {
            const v = (j / across) * 2 - 1
            const x = s.inner + u * s.length
            const z = v * w
            const y = (rise * u - s.droop * u * u) * s.length + s.spoon * v * v * w * 2
            positions.push(x * cos + z * sin, y, -x * sin + z * cos)
            color.lerpColors(s.baseColor, s.tipColor, THREE.MathUtils.smoothstep(u, 0, 0.7))
            colors.push(color.r, color.g, color.b)
            if (i > 0 && j > 0) {
                const a = (i - 1) * (across + 1) + j - 1
                const c = i * (across + 1) + j - 1
                indices.push(a, c, a + 1, a + 1, c, c + 1)
            }
        }
    }

    const geo = toGeometry(positions, null, colors, indices)
    geo.computeVertexNormals()
    return geo
}

/**
 * Strip a geometry down to position/normal/color and paint it with a vertical
 * gradient from `bottom` (at its lowest point) to `top` (at its highest).
 */
export function paint(
    geo: THREE.BufferGeometry,
    bottom: THREE.Color,
    top: THREE.Color = bottom,
): THREE.BufferGeometry {
    for (const name of Object.keys(geo.attributes)) {
        if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name)
    }
    geo.computeBoundingBox()
    const { min, max } = geo.boundingBox!
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const color = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
        const t = max.y > min.y ? (pos.getY(i) - min.y) / (max.y - min.y) : 0
        color.lerpColors(bottom, top, t).toArray(colors, i * 3)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geo
}

function toGeometry(
    positions: number[],
    normals: number[] | null,
    colors: number[],
    indices: number[],
): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    if (normals) geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.setIndex(indices)
    return geo
}

/**
 * Double-sided materials flip the normal on back faces. Ground-cover normals
 * are authored to point up-ish on both sides, so keep them as authored.
 * Chains onto any existing onBeforeCompile.
 */
export function keepAuthoredNormals<T extends THREE.Material>(material: T): T {
    const previous = material.onBeforeCompile
    material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer)
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <normal_fragment_begin>',
            THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'),
        )
    }
    const previousKey = material.customProgramCacheKey.bind(material)
    material.customProgramCacheKey = () => `${previousKey()}-authored-normals`
    return material
}
