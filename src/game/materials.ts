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
 * Rewrite a geometry's UVs as a box projection in its local space, one UV unit
 * per meter. Each vertex projects along the axis its normal points down most:
 * ±X faces map (z, y), ±Y faces map (x, z), ±Z faces map (x, y). Lets a single
 * tiling texture keep a constant texel density across meshes of very different
 * sizes (a 14 m wall and a 0.2 m post share the same plank width), and works
 * for any shape — boxes, rounded boxes, extrusions, planes. Assumes the mesh
 * itself is unscaled; otherwise density scales with it.
 */
export function setWorldUVs(geo: THREE.BufferGeometry): void {
    const pos = geo.attributes.position as THREE.BufferAttribute
    const normal = geo.attributes.normal as THREE.BufferAttribute
    const uv = geo.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
        const ax = Math.abs(normal.getX(i))
        const ay = Math.abs(normal.getY(i))
        const az = Math.abs(normal.getZ(i))
        if (ax >= ay && ax >= az) {
            uv.setXY(i, pos.getZ(i), pos.getY(i))
        } else if (ay >= az) {
            uv.setXY(i, pos.getX(i), pos.getZ(i))
        } else {
            uv.setXY(i, pos.getX(i), pos.getY(i))
        }
    }
    uv.needsUpdate = true
}

function makeCanvas(size: number, height = size): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = height
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
 * material's `color`. One tile is 2 m wide by 4 m tall, holding eight 25 cm
 * plank columns; each column is a run of boards of random length (butt joints
 * staggered column to column), and every board gets its own tone, grain and
 * knots, so the tiling repeat is hard to spot. Pair with setWorldUVs.
 */
export function createWoodTexture(): THREE.CanvasTexture {
    // Taller than wide so boards can run long; same 512 px/m both ways.
    const tileWidthM = 2
    const tileHeightM = 4
    const pxPerMeter = 512
    const width = tileWidthM * pxPerMeter
    const size = tileHeightM * pxPerMeter
    const planks = 8
    const pw = width / planks
    const [canvas, ctx] = makeCanvas(width, size)

    for (let p = 0; p < planks; p++) {
        const x0 = p * pw

        // Board boundaries down the column, measured from a random start; the
        // last board runs to start + size, i.e. wraps into the first.
        const start = Math.random() * size
        const joints: number[] = []
        let y = 0
        while (y < size) {
            joints.push(y)
            y += pxPerMeter * (1.5 + Math.random() * 2)
        }
        // Drop a final sliver too short to read as a board.
        if (size - joints[joints.length - 1] < pxPerMeter * 0.8 && joints.length > 1) joints.pop()

        // Paint the column once on its own strip, then blit it in at `start`
        // and wrapped one tile up. Painting the wrapped board twice would roll
        // two different random tones and leave a fake joint at the tile edge.
        const [col, colCtx] = makeCanvas(pw, size)
        for (let j = 0; j < joints.length; j++) {
            const y0 = joints[j]
            const y1 = j + 1 < joints.length ? joints[j + 1] : size
            colCtx.save()
            colCtx.beginPath()
            colCtx.rect(0, y0, pw, y1 - y0)
            colCtx.clip()
            drawPlankBoard(colCtx, 0, y0, pw, y1 - y0)
            colCtx.restore()

            // Butt joint: a dark gap with a faint highlighted edge.
            colCtx.fillStyle = 'rgba(40, 25, 12, 0.6)'
            colCtx.fillRect(0, y0 - 1.5, pw, 3)
            colCtx.fillStyle = 'rgba(255, 245, 225, 0.2)'
            colCtx.fillRect(0, y0 + 1.5, pw, 1)
        }
        // The first joint sits at the strip's top edge; repeat its dark gap
        // at the bottom so both halves of it survive the wrap.
        colCtx.fillStyle = 'rgba(40, 25, 12, 0.6)'
        colCtx.fillRect(0, size - 1.5, pw, 1.5)
        ctx.drawImage(col, x0, start)
        ctx.drawImage(col, x0, start - size)

        // Seam between planks: dark groove with a light bevel catching light.
        ctx.fillStyle = 'rgba(35, 20, 8, 0.75)'
        ctx.fillRect(x0, 0, 4, size)
        ctx.fillStyle = 'rgba(255, 245, 225, 0.35)'
        ctx.fillRect(x0 + 4, 0, 2, size)
    }

    const tex = finishTexture(canvas, tileWidthM)
    tex.repeat.set(1 / tileWidthM, 1 / tileHeightM)
    return tex
}

/** One board of a plank column: base tone, end-to-end shading, grain, knots. */
function drawPlankBoard(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    w: number,
    h: number,
): void {
    // Per-board brightness and warmth, so neighbouring boards read as
    // different pieces of wood rather than one stripe.
    const b = 190 + Math.random() * 60
    const warm = 0.88 + Math.random() * 0.1
    ctx.fillStyle = `rgb(${b}, ${b * (warm + 0.06)}, ${b * warm})`
    ctx.fillRect(x0, y0, w, h)

    // Gentle shading along the board's length (weathering / sap streaks).
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h)
    const a1 = Math.random() * 0.12
    const a2 = Math.random() * 0.12
    g.addColorStop(0, `rgba(90, 55, 25, ${a1})`)
    g.addColorStop(0.5, 'rgba(0, 0, 0, 0)')
    g.addColorStop(1, `rgba(90, 55, 25, ${a2})`)
    ctx.fillStyle = g
    ctx.fillRect(x0, y0, w, h)

    // Grain: long wobbly streaks; count and waviness vary per board.
    const streaks = 14 + Math.floor(Math.random() * 16)
    const wobble = 0.5 + Math.random() * 1.5
    for (let s = 0; s < streaks; s++) {
        const gx = x0 + 6 + Math.random() * (w - 12)
        const amp = (1 + Math.random() * 3) * wobble
        const freq = 0.006 + Math.random() * 0.02
        const phase = Math.random() * Math.PI * 2
        ctx.strokeStyle = `rgba(70, 45, 25, ${0.05 + Math.random() * 0.14})`
        ctx.lineWidth = 1 + Math.random() * 2.5
        ctx.beginPath()
        for (let y = 0; y <= h; y += 8) {
            const x = gx + Math.sin((y0 + y) * freq + phase) * amp
            if (y === 0) ctx.moveTo(x, y0 + y)
            else ctx.lineTo(x, y0 + y)
        }
        ctx.stroke()
    }

    // Knots: some boards are clear, some have one or two.
    const knots = Math.random() < 0.45 ? 0 : Math.random() < 0.7 ? 1 : 2
    for (let k = 0; k < knots; k++) {
        const kx = x0 + w * (0.25 + Math.random() * 0.5)
        const ky = y0 + Math.random() * h
        const rx = 4 + Math.random() * 5
        const ry = 8 + Math.random() * 8
        ctx.fillStyle = 'rgba(70, 40, 20, 0.25)'
        ctx.beginPath()
        ctx.ellipse(kx, ky, rx, ry, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(50, 28, 12, 0.3)'
        ctx.beginPath()
        ctx.ellipse(kx, ky, rx * 0.4, ry * 0.4, 0, 0, Math.PI * 2)
        ctx.fill()
    }
}

/**
 * Near-white barrel staves for a LatheGeometry side (U = around, V = up, both
 * 0..1): one tile wraps the whole circumference once with `staves` boards,
 * each with its own tone and grain, separated by dark seams. The ends darken
 * where hands and ground have grimed the wood. Tinted by material `color`.
 */
export function createStaveTexture(staves: number): THREE.CanvasTexture {
    const width = 1024
    const height = 512
    const sw = width / staves
    const [canvas, ctx] = makeCanvas(width, height)

    for (let s = 0; s < staves; s++) {
        const x0 = s * sw
        ctx.save()
        ctx.beginPath()
        ctx.rect(x0, 0, sw, height)
        ctx.clip()
        drawPlankBoard(ctx, x0, 0, sw, height)
        ctx.restore()

        // Seam: dark joint with a thin highlight on the next stave's edge.
        ctx.fillStyle = 'rgba(30, 16, 6, 0.85)'
        ctx.fillRect(x0, 0, 3, height)
        ctx.fillStyle = 'rgba(255, 240, 215, 0.25)'
        ctx.fillRect(x0 + 3, 0, 2, height)
    }

    const grime = ctx.createLinearGradient(0, 0, 0, height)
    grime.addColorStop(0, 'rgba(50, 30, 15, 0.45)')
    grime.addColorStop(0.12, 'rgba(50, 30, 15, 0)')
    grime.addColorStop(0.88, 'rgba(50, 30, 15, 0)')
    grime.addColorStop(1, 'rgba(50, 30, 15, 0.45)')
    ctx.fillStyle = grime
    ctx.fillRect(0, 0, width, height)

    const tex = finishTexture(canvas, 1)
    tex.wrapT = THREE.ClampToEdgeWrapping
    return tex
}

/**
 * Near-white barrel head for a CircleGeometry (UVs span the disk's bounding
 * square): four boards across with dark seams, darkening toward the rim
 * where the head sits in the staves' groove. Tinted by material `color`.
 */
export function createBarrelHeadTexture(): THREE.CanvasTexture {
    const size = 512
    const boards = 4
    const bw = size / boards
    const [canvas, ctx] = makeCanvas(size)

    for (let b = 0; b < boards; b++) {
        const x0 = b * bw
        ctx.save()
        ctx.beginPath()
        ctx.rect(x0, 0, bw, size)
        ctx.clip()
        drawPlankBoard(ctx, x0, 0, bw, size)
        ctx.restore()
        ctx.fillStyle = 'rgba(30, 16, 6, 0.8)'
        ctx.fillRect(x0, 0, 3, size)
    }

    const rim = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size / 2)
    rim.addColorStop(0, 'rgba(40, 22, 10, 0)')
    rim.addColorStop(0.85, 'rgba(40, 22, 10, 0.35)')
    rim.addColorStop(1, 'rgba(40, 22, 10, 0.75)')
    ctx.fillStyle = rim
    ctx.fillRect(0, 0, size, size)

    return finishTexture(canvas, 1)
}

/**
 * Near-white solid hardwood board with grain running along U (no plank seams),
 * for a single long counter-top rail. Wavy grain lines plus a few "cathedral"
 * arches of flat-sawn figure; tinted by material `color`. Every wave uses an
 * integer number of periods across the tile so it wraps seamlessly. One tile =
 * 1 m; pair with setWorldUVs so the grain follows X on top and front faces.
 */
export function createBoardTexture(): THREE.CanvasTexture {
    const size = 512
    const [canvas, ctx] = makeCanvas(size)
    const tau = Math.PI * 2

    ctx.fillStyle = 'rgb(232, 222, 210)'
    ctx.fillRect(0, 0, size, size)

    // Broad soft color bands give the board depth before the fine grain.
    for (let i = 0; i < 10; i++) {
        const y = Math.random() * size
        const h = 20 + Math.random() * 60
        const g = ctx.createLinearGradient(0, y - h, 0, y + h)
        const a = 0.08 + Math.random() * 0.12
        const tone = Math.random() < 0.5 ? `rgba(120, 80, 45, ${a})` : `rgba(255, 248, 235, ${a})`
        g.addColorStop(0, 'rgba(0, 0, 0, 0)')
        g.addColorStop(0.5, tone)
        g.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = g
        for (const dy of [-size, 0, size]) ctx.fillRect(0, y - h + dy, size, h * 2)
    }

    const strokeWave = (y0: number, amp: number, k: number, phase: number): void => {
        for (const dy of [-size, 0, size]) {
            ctx.beginPath()
            for (let x = 0; x <= size; x += 4) {
                const y = y0 + dy + Math.sin((x / size) * tau * k + phase) * amp
                if (x === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
            }
            ctx.stroke()
        }
    }

    // Fine straight grain.
    for (let i = 0; i < 140; i++) {
        ctx.strokeStyle = `rgba(80, 48, 22, ${0.08 + Math.random() * 0.2})`
        ctx.lineWidth = 0.8 + Math.random() * 2.2
        strokeWave(Math.random() * size, 1 + Math.random() * 4, 1 + Math.floor(Math.random() * 3), Math.random() * tau)
    }

    // Cathedral figure: nested arches pointing along +U, the signature look of
    // a flat-sawn plank. Drawn twice, offset by a full tile, to wrap in U.
    for (let c = 0; c < 2; c++) {
        const cx = Math.random() * size
        const cy = size * (0.25 + c * 0.5) + (Math.random() - 0.5) * 60
        for (let r = 0; r < 7; r++) {
            const halfH = 10 + r * 9
            const len = 70 + r * 26
            ctx.strokeStyle = `rgba(85, 50, 22, ${0.3 - r * 0.025})`
            ctx.lineWidth = 2 + Math.random() * 1.5
            for (const dx of [-size, 0, size]) {
                ctx.beginPath()
                for (let t = -1; t <= 1.0001; t += 0.05) {
                    // Parabolic arch: apex at (cx + len, cy), legs trailing back.
                    const x = cx + dx + len * (1 - t * t)
                    const y = cy + t * halfH
                    if (t === -1) ctx.moveTo(x - 160, y)
                    ctx.lineTo(x, y)
                }
                ctx.lineTo(cx + dx - 160, cy + halfH)
                ctx.stroke()
            }
        }
    }

    // Pores: tiny dark dashes along the grain.
    for (let i = 0; i < 1800; i++) {
        ctx.fillStyle = `rgba(60, 35, 15, ${0.08 + Math.random() * 0.12})`
        ctx.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 5, 1)
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
 * Non-repeating version of the fabric mask for the roof: one canvas covers the
 * whole `widthM` × `depthM` roof (centered on x = 0, starting at z = `minZ`),
 * so the blotches never tile. Expects UVs in world meters (setWorldUVs on
 * geometry positioned in world space), and clamps instead of wrapping.
 */
export function createAwningTexture(widthM: number, depthM: number, minZ: number): THREE.CanvasTexture {
    const pxPerMeter = 96
    const w = Math.ceil(widthM * pxPerMeter)
    const h = Math.ceil(depthM * pxPerMeter)
    const [canvas, ctx] = makeCanvas(w, h)

    ctx.fillStyle = 'rgb(238, 236, 230)'
    ctx.fillRect(0, 0, w, h)

    // Blotches at several scales so there's no single dominant spot size.
    const area = widthM * depthM
    const blotch = (count: number, minR: number, maxR: number) => {
        for (let i = 0; i < count; i++) {
            const x = Math.random() * w
            const y = Math.random() * h
            const r = (minR + Math.random() * (maxR - minR)) * pxPerMeter
            const light = Math.random() < 0.5
            const g = ctx.createRadialGradient(x, y, 0, x, y, r)
            g.addColorStop(0, light ? 'rgba(255, 255, 255, 0.12)' : 'rgba(120, 100, 90, 0.05)')
            g.addColorStop(1, 'rgba(0, 0, 0, 0)')
            ctx.fillStyle = g
            ctx.fillRect(x - r, y - r, r * 2, r * 2)
        }
    }
    blotch(Math.round(area * 0.6), 0.6, 1.6)
    blotch(Math.round(area * 4), 0.15, 0.5)
    blotch(Math.round(area * 12), 0.05, 0.15)

    // Weave: alternating faint threads in both directions.
    for (let i = 0; i < h; i += 2) {
        ctx.fillStyle = `rgba(0, 0, 0, ${0.025 + Math.random() * 0.02})`
        ctx.fillRect(0, i, w, 1)
    }
    for (let i = 0; i < w; i += 2) {
        ctx.fillStyle = `rgba(0, 0, 0, ${0.025 + Math.random() * 0.02})`
        ctx.fillRect(i, 0, 1, h)
    }

    const speckles = Math.round(w * h * 0.03)
    for (let i = 0; i < speckles; i++) {
        const v = Math.random() < 0.5 ? 0 : 255
        ctx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.05)`
        ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1)
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.repeat.set(1 / widthM, 1 / depthM)
    tex.offset.set(0.5, -minZ / depthM)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = ANISOTROPY
    return tex
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
