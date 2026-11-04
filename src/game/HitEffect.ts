import * as THREE from 'three'

const PARTICLE_COUNT = 36
const PARTICLE_COLORS = [0xfff04a, 0xc8332c, 0xf2efe6, 0x2b4f8c, 0x6b4423, 0x3d2812]
const DURATION = 1.0
const GRAVITY = 9.8

interface Particle {
    mesh: THREE.Mesh
    velocity: THREE.Vector3
    spin: THREE.Vector3
    material: THREE.MeshStandardMaterial
}

/**
 * A short-lived world-space effect spawned at the moment of a target hit:
 * a burst of colored debris that flies outward (biased toward the player) and
 * a floating score readout. update(dt) returns false once expired.
 */
export class HitEffect {
    readonly object: THREE.Group
    private elapsed = 0
    private particles: Particle[] = []
    private sharedGeometry: THREE.BoxGeometry
    private scoreSprite: THREE.Sprite
    private scoreBaseY: number
    private multiplierSprite: THREE.Sprite | null = null
    private multiplierBaseY = 0

    constructor(position: THREE.Vector3, score: number, multiplier: number = 1) {
        this.object = new THREE.Group()
        this.object.position.copy(position)

        this.sharedGeometry = new THREE.BoxGeometry(1, 1, 1)
        this.spawnParticles()

        this.scoreSprite = makeScoreSprite(score)
        this.scoreSprite.position.set(0, 0.7, 0)
        this.scoreBaseY = this.scoreSprite.position.y
        this.object.add(this.scoreSprite)

        if (multiplier > 1) {
            this.multiplierSprite = makeMultiplierSprite(multiplier)
            this.multiplierBaseY = this.scoreBaseY + 0.55
            this.multiplierSprite.position.set(0, this.multiplierBaseY, 0)
            this.object.add(this.multiplierSprite)
        }
    }

    private spawnParticles(): void {
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const mat = new THREE.MeshStandardMaterial({
                color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
                transparent: true,
                roughness: 0.7,
            })
            const mesh = new THREE.Mesh(this.sharedGeometry, mat)
            const size = 0.07 + Math.random() * 0.08
            mesh.scale.setScalar(size)

            const speed = 4.5 + Math.random() * 5.5
            // Hemisphere biased into the +Z half-space so debris flies toward the
            // player; phi rises from horizontal so most particles also lift upward.
            const theta = Math.random() * Math.PI * 2
            const phi = Math.random() * Math.PI * 0.5
            const horizontal = Math.cos(phi)
            const velocity = new THREE.Vector3(
                Math.cos(theta) * horizontal * speed,
                Math.sin(phi) * speed * 1.4 + 1.8,
                Math.abs(Math.sin(theta)) * horizontal * speed * 0.8 + 1.5,
            )

            const spin = new THREE.Vector3(
                (Math.random() - 0.5) * 14,
                (Math.random() - 0.5) * 14,
                (Math.random() - 0.5) * 14,
            )

            this.object.add(mesh)
            this.particles.push({ mesh, velocity, spin, material: mat })
        }
    }

    update(dt: number): boolean {
        this.elapsed += dt
        if (this.elapsed >= DURATION) return false
        const t = this.elapsed / DURATION

        for (const p of this.particles) {
            p.velocity.y -= GRAVITY * dt
            p.mesh.position.addScaledVector(p.velocity, dt)
            p.mesh.rotation.x += p.spin.x * dt
            p.mesh.rotation.y += p.spin.y * dt
            p.mesh.rotation.z += p.spin.z * dt
            // Fade slightly faster than the full duration so debris is gone
            // before the new bullseye finishes its reload spin.
            p.material.opacity = Math.max(0, 1 - t * 1.4)
        }

        this.scoreSprite.position.y = this.scoreBaseY + t * 0.8
        const spriteMat = this.scoreSprite.material as THREE.SpriteMaterial
        // Hold full opacity briefly, then ease out by t².
        spriteMat.opacity = Math.max(0, 1 - t * t)
        const pop = 1 + Math.min(t * 5, 0.45)
        this.scoreSprite.scale.set(1.7 * pop, 0.85 * pop, 1)

        if (this.multiplierSprite) {
            this.multiplierSprite.position.y = this.multiplierBaseY + t * 0.8
            const mMat = this.multiplierSprite.material as THREE.SpriteMaterial
            mMat.opacity = Math.max(0, 1 - t * t)
            this.multiplierSprite.scale.set(1.1 * pop, 0.55 * pop, 1)
        }

        return true
    }

    dispose(): void {
        this.sharedGeometry.dispose()
        this.object.traverse((obj) => {
            const mat = (obj as THREE.Mesh | THREE.Sprite).material
            if (Array.isArray(mat)) {
                for (const m of mat) disposeMaterial(m)
            } else if (mat) {
                disposeMaterial(mat as THREE.Material)
            }
        })
    }
}

function disposeMaterial(mat: THREE.Material): void {
    const map = (mat as unknown as { map?: THREE.Texture }).map
    if (map && typeof map.dispose === 'function') map.dispose()
    mat.dispose()
}

/** Matches the HUD: Bungee numerals, gold gradient, dark-wood outline and drop shadow. */
const FONT_FAMILY = "'Bungee', Impact, system-ui, sans-serif"
const WOOD_DARK = '#1f0e07'
const CANVAS_W = 512
const CANVAS_H = 256

type TextStyle = { hi: string; mid: string; lo: string; glow: string }

const GOLD: TextStyle = { hi: '#fff4cf', mid: '#f0c75a', lo: '#b9832a', glow: 'rgba(240, 199, 90, 0.85)' }
/** Multiplier colors per tier, the same as the HUD's "+N ×M" popup. */
const MULTIPLIER_STYLE: Record<number, TextStyle> = {
    2: { hi: '#eef4ff', mid: '#8ab8ff', lo: '#2c6ee0', glow: 'rgba(44, 110, 224, 0.95)' },
    3: { hi: '#f7ecff', mid: '#d9a6ff', lo: '#8e3ad1', glow: 'rgba(142, 58, 209, 0.95)' },
}

// The HUD already uses Bungee, but make sure it's loaded before the first sprite is drawn.
void document.fonts?.load(`100px ${FONT_FAMILY}`)

function makeScoreSprite(score: number): THREE.Sprite {
    const sprite = makeTextSprite(`+${score}`, 130, GOLD)
    sprite.scale.set(1.7, 0.85, 1)
    return sprite
}

function makeMultiplierSprite(multiplier: number): THREE.Sprite {
    const sprite = makeTextSprite(`×${multiplier}`, 130, MULTIPLIER_STYLE[multiplier] ?? GOLD)
    sprite.scale.set(1.1, 0.55, 1)
    return sprite
}

function makeTextSprite(text: string, fontPx: number, style: TextStyle): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')

    // Shrink to fit so long scores never clip at the canvas edge (leaves room for the glow).
    let px = fontPx
    ctx.font = `${px}px ${FONT_FAMILY}`
    while (ctx.measureText(text).width > CANVAS_W - 80 && px > 40) {
        px -= 6
        ctx.font = `${px}px ${FONT_FAMILY}`
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    const x = CANVAS_W / 2
    const y = CANVAS_H / 2
    const outline = Math.max(6, px * 0.08)
    const drop = px * 0.07

    // Soft colored glow behind everything.
    ctx.save()
    ctx.shadowColor = style.glow
    ctx.shadowBlur = px * 0.25
    ctx.fillStyle = style.glow
    ctx.fillText(text, x, y)
    ctx.restore()

    // Hard dark drop shadow, then the dark outline.
    ctx.fillStyle = WOOD_DARK
    ctx.strokeStyle = WOOD_DARK
    ctx.lineWidth = outline
    ctx.strokeText(text, x, y + drop)
    ctx.fillText(text, x, y + drop)
    ctx.strokeText(text, x, y)

    // Vertical gradient fill, light at the top.
    const gradient = ctx.createLinearGradient(0, y - px * 0.5, 0, y + px * 0.5)
    gradient.addColorStop(0.1, style.hi)
    gradient.addColorStop(0.55, style.mid)
    gradient.addColorStop(0.95, style.lo)
    ctx.fillStyle = gradient
    ctx.fillText(text, x, y)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        // Skip ACES so the colors match the CSS HUD instead of washing out toward white.
        toneMapped: false,
    })
    return new THREE.Sprite(mat)
}
