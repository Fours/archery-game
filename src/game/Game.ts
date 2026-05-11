import * as THREE from 'three'
import { Arrow } from './Arrow'
import { Barrels } from './Barrels'
import { Booth, HALF_WIDTH, ROOF_Y } from './Booth'
import { Bow } from './Bow'
import { CornerBows } from './CornerBows'
import { Flowers } from './Flowers'
import { FrontRailing } from './FrontRailing'
import { HitEffect } from './HitEffect'
import { Plants } from './Plants'
import { RowFlags } from './RowFlags'
import { Target } from './Target'
import { Trees } from './Trees'
import type { Tier } from './Target'
import { TargetRow } from './TargetRow'

const EYE_HEIGHT = 1.7
const MAX_DRAW_TIME = 2.0
const MIN_ARROW_SPEED = 18
const MAX_ARROW_SPEED = 65
const MOUSE_SENSITIVITY = 0.0022
const MAX_PITCH = Math.PI / 2 - 0.001

// Rows are arranged front→middle→back (closest to player first). The user spec:
//   - The furthest row sits at the booth's vertical middle.
//   - The nearer two rows sit above and below it.
//   - Adjacent rows move in opposite horizontal directions.
//   - Front = green ×1, middle = blue ×2, back = purple ×3 (handled by Tier).
const ROW_CONFIGS: {
    z: number
    y: number
    tier: Tier
    speed: number
    direction: 1 | -1
    startCenterX: number
}[] = [
    { z: -4.5,  y: 1.4,                                 tier: 'green',  speed: 2.0, direction:  1, startCenterX:  0.0 },
    { z: -7.5,  y: ROOF_Y - 1.6,                        tier: 'blue',   speed: 1.5, direction: -1, startCenterX: -1.0 },
    { z: -10.5, y: (1.4 + (ROOF_Y - 1.6)) / 2,          tier: 'purple', speed: 1.1, direction:  1, startCenterX:  1.0 },
]

const TARGETS_PER_ROW = 3
const ROW_TARGET_SPACING = 2.6
const ROW_EDGE_PADDING = 0.7 // keep targets away from side walls

type LockListener = (locked: boolean) => void
type ScoreListener = (score: number) => void
type GameOverListener = (gameOver: boolean) => void

export class Game {
    private container: HTMLElement
    private onLockChange: LockListener
    private onScoreChange: ScoreListener
    private onGameOver: GameOverListener

    private renderer: THREE.WebGLRenderer
    private scene: THREE.Scene
    private camera: THREE.PerspectiveCamera
    private bow: Bow
    private barrels: Barrels
    private booth: Booth
    private cornerBows: CornerBows
    private flowers: Flowers
    private frontRailing: FrontRailing
    private plants: Plants
    private rowFlags: RowFlags
    private trees: Trees
    private targetRows: TargetRow[] = []
    private allTargets: Target[] = []
    private arrows: Arrow[] = []
    private effects: HitEffect[] = []
    private grassTexture: THREE.Texture

    private locked = false
    private euler = new THREE.Euler(0, 0, 0, 'YXZ')

    private spaceHeld = false
    private drawing = false
    private drawTime = 0

    private score = 0
    private gameOver = false

    private running = true
    private frameId = 0
    private lastTime = 0

    constructor(
        container: HTMLElement,
        onLockChange: LockListener,
        onScoreChange: ScoreListener,
        onGameOver: GameOverListener,
    ) {
        this.container = container
        this.onLockChange = onLockChange
        this.onScoreChange = onScoreChange
        this.onGameOver = onGameOver

        this.renderer = new THREE.WebGLRenderer({ antialias: true })
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        this.renderer.setSize(window.innerWidth, window.innerHeight)
        this.renderer.shadowMap.enabled = true
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
        container.appendChild(this.renderer.domElement)

        this.scene = new THREE.Scene()
        this.scene.background = new THREE.Color(0x87ceeb)
        this.scene.fog = new THREE.Fog(0x87ceeb, 90, 280)

        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.03,
            500,
        )
        this.camera.position.set(0, EYE_HEIGHT, 0)
        this.scene.add(this.camera)

        const hemi = new THREE.HemisphereLight(0xb1e1ff, 0x4a6e3c, 0.65)
        this.scene.add(hemi)

        const sun = new THREE.DirectionalLight(0xfff2cc, 1.25)
        sun.position.set(40, 60, 30)
        sun.castShadow = true
        sun.shadow.mapSize.set(1024, 1024)
        // Shadow frustum widened to cover the larger booth footprint.
        sun.shadow.camera.left = -60
        sun.shadow.camera.right = 60
        sun.shadow.camera.top = 60
        sun.shadow.camera.bottom = -60
        sun.shadow.camera.near = 1
        sun.shadow.camera.far = 220
        this.scene.add(sun)

        this.grassTexture = createGrassTexture()
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(500, 500),
            new THREE.MeshStandardMaterial({ map: this.grassTexture, roughness: 1 }),
        )
        ground.rotation.x = -Math.PI / 2
        ground.receiveShadow = true
        this.scene.add(ground)

        this.booth = new Booth()
        this.scene.add(this.booth.group)

        this.cornerBows = new CornerBows()
        this.scene.add(this.cornerBows.group)

        this.frontRailing = new FrontRailing()
        this.scene.add(this.frontRailing.group)

        this.barrels = new Barrels()
        this.scene.add(this.barrels.group)

        this.trees = new Trees()
        this.scene.add(this.trees.group)

        this.flowers = new Flowers()
        this.scene.add(this.flowers.group)

        this.plants = new Plants()
        this.scene.add(this.plants.group)

        this.rowFlags = new RowFlags(
            ROW_CONFIGS.map((c) => ({ tier: c.tier, z: c.z, y: c.y })),
        )
        this.scene.add(this.rowFlags.group)

        this.buildTargetRows()

        this.bow = new Bow()
        this.bow.group.position.set(0.28, -0.18, -0.55)
        this.camera.add(this.bow.group)

        window.addEventListener('resize', this.onResize)
        window.addEventListener('keydown', this.onKeyDown)
        window.addEventListener('keyup', this.onKeyUp)
        document.addEventListener('pointerlockchange', this.onPointerLockChange)
        document.addEventListener('mousemove', this.onMouseMove)

        this.lastTime = performance.now()
        this.frameId = requestAnimationFrame(this.animate)
    }

    private buildTargetRows(): void {
        // Center the offsets around 0 so each row's center == row midpoint.
        const totalSpan = (TARGETS_PER_ROW - 1) * ROW_TARGET_SPACING
        const offsets: number[] = []
        for (let i = 0; i < TARGETS_PER_ROW; i++) {
            offsets.push(-totalSpan / 2 + i * ROW_TARGET_SPACING)
        }
        // Center-X bounds so even the outermost target stays inside the side walls.
        const maxOffset = Math.max(...offsets.map((v) => Math.abs(v)))
        const centerLimit = HALF_WIDTH - ROW_EDGE_PADDING - maxOffset

        for (const cfg of ROW_CONFIGS) {
            const targets: Target[] = []
            for (let i = 0; i < TARGETS_PER_ROW; i++) {
                const t = new Target(new THREE.Vector3(0, cfg.y, cfg.z), cfg.tier)
                this.scene.add(t.object)
                targets.push(t)
                this.allTargets.push(t)
            }
            const row = new TargetRow({
                targets,
                offsets,
                y: cfg.y,
                z: cfg.z,
                speed: cfg.speed,
                direction: cfg.direction,
                bounds: { min: -centerLimit, max: centerLimit },
                startCenterX: clamp(cfg.startCenterX, -centerLimit, centerLimit),
                tier: cfg.tier,
                halfWidth: HALF_WIDTH,
            })
            this.scene.add(row.barsGroup)
            this.targetRows.push(row)
        }

    }

    requestLock(): void {
        if (this.gameOver) return
        if (!this.locked) {
            this.renderer.domElement.requestPointerLock()
        }
    }

    /** Reset the round: clear arrows/effects, restore targets, zero the score, resume play. */
    restart(): void {
        for (const arrow of this.arrows) {
            this.scene.remove(arrow.object)
            arrow.dispose()
        }
        this.arrows = []
        for (const effect of this.effects) {
            this.scene.remove(effect.object)
            effect.dispose()
        }
        this.effects = []
        for (const target of this.allTargets) target.reset()

        this.score = 0
        this.onScoreChange(0)
        this.gameOver = false
        this.onGameOver(false)
        // Avoid a large dt spike on the first frame back.
        this.lastTime = performance.now()
    }

    dispose(): void {
        this.running = false
        cancelAnimationFrame(this.frameId)

        window.removeEventListener('resize', this.onResize)
        window.removeEventListener('keydown', this.onKeyDown)
        window.removeEventListener('keyup', this.onKeyUp)
        document.removeEventListener('pointerlockchange', this.onPointerLockChange)
        document.removeEventListener('mousemove', this.onMouseMove)

        if (document.pointerLockElement === this.renderer.domElement) {
            document.exitPointerLock()
        }

        for (const arrow of this.arrows) arrow.dispose()
        this.arrows = []
        for (const effect of this.effects) effect.dispose()
        this.effects = []
        for (const target of this.allTargets) target.dispose()
        this.allTargets = []
        for (const row of this.targetRows) row.dispose()
        this.targetRows = []
        this.barrels.dispose()
        this.booth.dispose()
        this.cornerBows.dispose()
        this.frontRailing.dispose()
        this.flowers.dispose()
        this.plants.dispose()
        this.rowFlags.dispose()
        this.trees.dispose()
        this.bow.dispose()

        this.scene.traverse((obj) => {
            const mesh = obj as THREE.Mesh
            if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
                mesh.geometry.dispose()
            }
            const mat = mesh.material
            if (Array.isArray(mat)) {
                mat.forEach((m) => m.dispose())
            } else if (mat && typeof (mat as THREE.Material).dispose === 'function') {
                ;(mat as THREE.Material).dispose()
            }
        })
        this.grassTexture.dispose()
        this.renderer.dispose()

        const canvas = this.renderer.domElement
        if (canvas.parentNode === this.container) {
            this.container.removeChild(canvas)
        }
    }

    private onPointerLockChange = (): void => {
        this.locked = document.pointerLockElement === this.renderer.domElement
        this.onLockChange(this.locked)
        if (!this.locked) {
            // Cancel any draw in progress when the user frees the cursor.
            this.spaceHeld = false
            this.drawing = false
            this.drawTime = 0
            this.bow.setDraw(0)
        }
    }

    private onMouseMove = (e: MouseEvent): void => {
        if (!this.locked) return
        this.euler.setFromQuaternion(this.camera.quaternion)
        this.euler.y -= e.movementX * MOUSE_SENSITIVITY
        this.euler.x -= e.movementY * MOUSE_SENSITIVITY
        if (this.euler.x > MAX_PITCH) this.euler.x = MAX_PITCH
        if (this.euler.x < -MAX_PITCH) this.euler.x = -MAX_PITCH
        this.camera.quaternion.setFromEuler(this.euler)
    }

    private onKeyDown = (e: KeyboardEvent): void => {
        if (e.code === 'Space' && this.locked && !this.spaceHeld) {
            this.spaceHeld = true
            this.drawing = true
            this.drawTime = 0
            e.preventDefault()
        }
    }

    private onKeyUp = (e: KeyboardEvent): void => {
        if (e.code !== 'Space') return
        e.preventDefault()
        this.spaceHeld = false
        if (!this.drawing) return

        const strength = Math.min(this.drawTime / MAX_DRAW_TIME, 1)
        this.fireArrow(strength)

        this.drawing = false
        this.drawTime = 0
        this.bow.setDraw(0)
    }

    private fireArrow(strength: number): void {
        const direction = new THREE.Vector3()
        this.camera.getWorldDirection(direction)

        // Spawn just in front of the camera, nudged toward the bow's visual position
        // so the arrow appears to leave the bow rather than the eye.
        const right = new THREE.Vector3().crossVectors(direction, this.camera.up).normalize()
        const origin = this.camera.position
            .clone()
            .addScaledVector(direction, 0.55)
            .addScaledVector(right, 0.12)
            .addScaledVector(this.camera.up, -0.08)

        const speed = MIN_ARROW_SPEED + strength * (MAX_ARROW_SPEED - MIN_ARROW_SPEED)

        const arrow = new Arrow()
        arrow.launch(origin, direction, speed)
        this.scene.add(arrow.object)
        this.arrows.push(arrow)
    }

    /** Resolve a moving arrow against targets and the ground plane.
     *  Returns 'target' if the arrow was consumed by a target hit (caller should
     *  remove it from the scene), 'ground' if it stuck to the ground, or null. */
    private resolveArrowCollisions(arrow: Arrow): 'target' | 'ground' | null {
        // Find the earliest target hit along this frame's segment, if any.
        let bestT = Infinity
        let bestHit:
            | { point: THREE.Vector3; score: number; multiplier: number; target: Target }
            | null = null
        for (const target of this.allTargets) {
            const hit = target.testHit(arrow.prevPosition, arrow.object.position)
            if (hit && hit.t < bestT) {
                bestT = hit.t
                bestHit = { point: hit.point, score: hit.score, multiplier: hit.multiplier, target }
            }
        }

        const fy = arrow.prevPosition.y
        const ty = arrow.object.position.y
        const groundT = fy >= 0 && ty < 0 ? fy / (fy - ty) : Infinity

        if (bestHit && bestT <= groundT) {
            bestHit.target.onHit()
            const effect = new HitEffect(bestHit.point, bestHit.score, bestHit.multiplier)
            this.scene.add(effect.object)
            this.effects.push(effect)
            this.score += bestHit.score
            this.onScoreChange(this.score)
            return 'target'
        }
        if (groundT < Infinity) {
            arrow.stickToGround()
            return 'ground'
        }
        return null
    }

    private onResize = (): void => {
        this.camera.aspect = window.innerWidth / window.innerHeight
        this.camera.updateProjectionMatrix()
        this.renderer.setSize(window.innerWidth, window.innerHeight)
    }

    private animate = (): void => {
        if (!this.running) return
        this.frameId = requestAnimationFrame(this.animate)

        const now = performance.now()
        const dt = Math.min(0.05, (now - this.lastTime) / 1000)
        this.lastTime = now

        if (!this.gameOver) {
            if (this.drawing) {
                this.drawTime = Math.min(this.drawTime + dt, MAX_DRAW_TIME)
                this.bow.setDraw(this.drawTime / MAX_DRAW_TIME)
            }

            // Advance moving targets first so arrow hit-tests use this frame's positions.
            for (const row of this.targetRows) row.update(dt)
            for (const target of this.allTargets) target.update(dt)

            const consumed: Arrow[] = []
            for (const arrow of this.arrows) {
                if (arrow.isStuck) continue
                arrow.update(dt)
                if (this.resolveArrowCollisions(arrow) === 'target') {
                    consumed.push(arrow)
                }
            }
            if (consumed.length > 0) {
                const consumedSet = new Set(consumed)
                for (const a of consumed) {
                    this.scene.remove(a.object)
                    a.dispose()
                }
                this.arrows = this.arrows.filter((a) => !consumedSet.has(a))
            }

            // Advance hit effects, removing any that have expired this frame.
            if (this.effects.length > 0) {
                const survivors: HitEffect[] = []
                for (const eff of this.effects) {
                    if (eff.update(dt)) {
                        survivors.push(eff)
                    } else {
                        this.scene.remove(eff.object)
                        eff.dispose()
                    }
                }
                this.effects = survivors
            }

            if (this.allTargets.every((t) => t.isDisabled)) {
                this.gameOver = true
                // Cancel any in-flight draw and free the cursor so the overlay is clickable.
                this.spaceHeld = false
                this.drawing = false
                this.drawTime = 0
                this.bow.setDraw(0)
                if (document.pointerLockElement === this.renderer.domElement) {
                    document.exitPointerLock()
                }
                this.onGameOver(true)
            }
        }

        this.renderer.render(this.scene, this.camera)
    }
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v))
}

function createGrassTexture(): THREE.Texture {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')

    ctx.fillStyle = '#3a6e2a'
    ctx.fillRect(0, 0, size, size)

    for (let i = 0; i < 6000; i++) {
        const x = Math.random() * size
        const y = Math.random() * size
        const r = 60 + Math.floor(Math.random() * 30)
        const g = 110 + Math.floor(Math.random() * 70)
        const b = 40 + Math.floor(Math.random() * 30)
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
        ctx.fillRect(x, y, 1.5, 1.5)
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(60, 60)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
}
