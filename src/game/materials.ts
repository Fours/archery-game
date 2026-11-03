import * as THREE from 'three'

// Rim light: a fresnel term added to emissive so rounded silhouettes pick up a
// soft bright edge — the "lit from behind" sheen of animated-film shading.
// Opt-in per material (see addRimLight); on flat surfaces like the ground it
// would wash out everything viewed at a grazing angle.
const RIM_STRENGTH = 0.22
const RIM_POWER = 3.0
// How far the rim color moves from the surface's own albedo toward white.
const RIM_WHITE_MIX = 0.35

// All procedural textures are authored at this anisotropy; three clamps to the
// GPU's max. Matters most for the ground, which is almost always seen edge-on.
const ANISOTROPY = 8

/**
 * Patch a standard material so it adds a view-dependent rim highlight. Returns
 * the same material for chaining. Safe to call on materials shared by many
 * meshes — the patch lives in the compiled program, keyed by strength.
 */
export function addRimLight<T extends THREE.MeshStandardMaterial>(
    material: T,
    strength: number = RIM_STRENGTH,
): T {
    material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            /* glsl */ `#include <emissivemap_fragment>
            {
                float rimFresnel = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), ${RIM_POWER.toFixed(2)});
                totalEmissiveRadiance += mix(diffuseColor.rgb, vec3(1.0), ${RIM_WHITE_MIX.toFixed(2)})
                    * rimFresnel * ${strength.toFixed(3)};
            }`,
        )
    }
    material.customProgramCacheKey = () => `rim-${strength}`
    return material
}

/**
 * Rewrite a BoxGeometry's UVs so one UV unit equals one world meter on every
 * face. Lets a single tiling texture keep a constant texel density across
 * boxes of very different sizes (a 14 m wall and a 0.2 m post share the same
 * plank width). Face order matches BoxGeometry: +x, −x, +y, −y, +z, −z.
 */
export function setBoxWorldUVs(geo: THREE.BoxGeometry): void {
    const { width, height, depth, widthSegments, heightSegments, depthSegments } = geo.parameters
    const faces: { count: number; u: number; v: number }[] = [
        { count: (depthSegments + 1) * (heightSegments + 1), u: depth, v: height },
        { count: (depthSegments + 1) * (heightSegments + 1), u: depth, v: height },
        { count: (widthSegments + 1) * (depthSegments + 1), u: width, v: depth },
        { count: (widthSegments + 1) * (depthSegments + 1), u: width, v: depth },
        { count: (widthSegments + 1) * (heightSegments + 1), u: width, v: height },
        { count: (widthSegments + 1) * (heightSegments + 1), u: width, v: height },
    ]
    const uv = geo.attributes.uv as THREE.BufferAttribute
    let i = 0
    for (const face of faces) {
        for (let k = 0; k < face.count; k++, i++) {
            uv.setXY(i, uv.getX(i) * face.u, uv.getY(i) * face.v)
        }
    }
    uv.needsUpdate = true
}

/** Scale a PlaneGeometry's 0..1 UVs to world meters, matching setBoxWorldUVs. */
export function setPlaneWorldUVs(geo: THREE.PlaneGeometry): void {
    const { width, height } = geo.parameters
    const uv = geo.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * width, uv.getY(i) * height)
    }
    uv.needsUpdate = true
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    return [canvas, ctx]
}

function finishTexture(canvas: HTMLCanvasElement, metersPerTile: number): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(1 / metersPerTile, 1 / metersPerTile)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = ANISOTROPY
    return tex
}

/** Draw a soft radial blotch, wrapped across tile edges so the texture stays seamless. */
function softBlotch(
    ctx: CanvasRenderingContext2D,
    size: number,
    x: number,
    y: number,
    r: number,
    color: string,
): void {
    for (const dx of [-size, 0, size]) {
        for (const dy of [-size, 0, size]) {
            const cx = x + dx
            const cy = y + dy
            if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size) continue
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
            g.addColorStop(0, color)
            g.addColorStop(1, 'rgba(0, 0, 0, 0)')
            ctx.fillStyle = g
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
        }
    }
}

/**
 * Near-white painted wood planks running along V, meant to be tinted by the
 * material's `color`. One tile is 1 m wide holding four 25 cm planks; pair
 * with setBoxWorldUVs.
 */
export function createWoodTexture(): THREE.CanvasTexture {
    const size = 512
    const planks = 4
    const pw = size / planks
    const [canvas, ctx] = makeCanvas(size)

    for (let p = 0; p < planks; p++) {
        const x0 = p * pw
        const b = 205 + Math.random() * 45
        ctx.fillStyle = `rgb(${b}, ${b * 0.96}, ${b * 0.92})`
        ctx.fillRect(x0, 0, pw, size)

        // Grain: long wobbly streaks, slightly darker than the plank.
        for (let s = 0; s < 22; s++) {
            const gx = x0 + 6 + Math.random() * (pw - 12)
            const amp = 1 + Math.random() * 3
            const freq = 0.01 + Math.random() * 0.02
            const phase = Math.random() * Math.PI * 2
            ctx.strokeStyle = `rgba(70, 45, 25, ${0.06 + Math.random() * 0.12})`
            ctx.lineWidth = 1 + Math.random() * 2.5
            ctx.beginPath()
            for (let y = 0; y <= size; y += 8) {
                const x = gx + Math.sin(y * freq + phase) * amp
                if (y === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
            }
            ctx.stroke()
        }

        // Occasional knot.
        if (Math.random() < 0.25) {
            const kx = x0 + pw * (0.3 + Math.random() * 0.4)
            const ky = Math.random() * size
            ctx.fillStyle = 'rgba(70, 40, 20, 0.22)'
            ctx.beginPath()
            ctx.ellipse(kx, ky, 5 + Math.random() * 4, 9 + Math.random() * 6, 0, 0, Math.PI * 2)
            ctx.fill()
        }

        // Butt joint where two boards meet end to end.
        const jy = Math.random() * size
        ctx.fillStyle = 'rgba(40, 25, 12, 0.55)'
        ctx.fillRect(x0, jy, pw, 3)

        // Seam between planks: dark groove with a light bevel catching light.
        ctx.fillStyle = 'rgba(35, 20, 8, 0.75)'
        ctx.fillRect(x0, 0, 4, size)
        ctx.fillStyle = 'rgba(255, 245, 225, 0.35)'
        ctx.fillRect(x0 + 4, 0, 2, size)
    }

    return finishTexture(canvas, 1.0)
}

/**
 * Near-white woven canvas for the striped awning: fine weave, speckle, and
 * soft painterly blotches. Tinted by material color; one tile = 0.6 m.
 */
export function createFabricTexture(): THREE.CanvasTexture {
    const size = 256
    const [canvas, ctx] = makeCanvas(size)

    ctx.fillStyle = 'rgb(238, 236, 230)'
    ctx.fillRect(0, 0, size, size)

    for (let i = 0; i < 18; i++) {
        const light = Math.random() < 0.5
        softBlotch(
            ctx,
            size,
            Math.random() * size,
            Math.random() * size,
            30 + Math.random() * 60,
            light ? 'rgba(255, 255, 255, 0.12)' : 'rgba(120, 100, 90, 0.04)',
        )
    }

    // Weave: alternating faint threads in both directions.
    for (let i = 0; i < size; i += 2) {
        ctx.fillStyle = `rgba(0, 0, 0, ${0.025 + Math.random() * 0.02})`
        ctx.fillRect(0, i, size, 1)
        ctx.fillRect(i, 0, 1, size)
    }

    for (let i = 0; i < 2500; i++) {
        const v = Math.random() < 0.5 ? 0 : 255
        ctx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.05)`
        ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1)
    }

    return finishTexture(canvas, 0.6)
}

/**
 * Painterly lawn: large soft light/dark patches under short directional blade
 * strokes. Fully colored (not a tint mask). `metersPerTile` sets world scale.
 */
export function createGrassTexture(metersPerTile: number): THREE.CanvasTexture {
    const size = 512
    const [canvas, ctx] = makeCanvas(size)

    ctx.fillStyle = '#5c9a38'
    ctx.fillRect(0, 0, size, size)

    // Broad patches give the lawn a hand-painted, uneven look at distance.
    const patchColors = [
        'rgba(130, 185, 65, 0.45)',
        'rgba(165, 200, 80, 0.35)',
        'rgba(40, 90, 35, 0.35)',
        'rgba(90, 130, 40, 0.30)',
    ]
    for (let i = 0; i < 40; i++) {
        softBlotch(
            ctx,
            size,
            Math.random() * size,
            Math.random() * size,
            40 + Math.random() * 110,
            patchColors[i % patchColors.length],
        )
    }

    // Blade strokes: short, mostly upright, light tips over darker bases.
    for (let i = 0; i < 9000; i++) {
        const x = Math.random() * size
        const y = Math.random() * size
        const len = 3 + Math.random() * 6
        const lean = (Math.random() - 0.5) * 3
        const light = Math.random() < 0.55
        const g = light ? 150 + Math.random() * 70 : 80 + Math.random() * 40
        const r = light ? 90 + Math.random() * 50 : 40 + Math.random() * 25
        const b = light ? 45 + Math.random() * 30 : 25 + Math.random() * 20
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.35 + Math.random() * 0.4})`
        ctx.lineWidth = 1 + Math.random()
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + lean, y - len)
        ctx.stroke()
    }

    return finishTexture(canvas, metersPerTile)
}
