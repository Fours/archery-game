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

    constructor(position: THREE.Vector3, score: number) {
        this.object = new THREE.Group()
        this.object.position.copy(position)

        this.sharedGeometry = new THREE.BoxGeometry(1, 1, 1)
        this.spawnParticles()

        this.scoreSprite = makeScoreSprite(score)
        this.scoreSprite.position.set(0, 0.7, 0)
        this.scoreBaseY = this.scoreSprite.position.y
        this.object.add(this.scoreSprite)
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

function makeScoreSprite(score: number): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')

    ctx.font = 'bold 84px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 10
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)'
    ctx.fillStyle = '#ffd84a'
    const text = `+${score}`
    ctx.strokeText(text, 128, 64)
    ctx.fillText(text, 128, 64)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(1.7, 0.85, 1)
    return sprite
}
