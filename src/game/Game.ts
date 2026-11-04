import * as THREE from 'three'
import { Arrow } from './Arrow'
import { Bow } from './Bow'
import { HitEffect } from './HitEffect'
import { Level } from './Level'
import { LEVELS } from './levels'
import { PostFX } from './PostFX'
import { World } from './World'

const EYE_HEIGHT = 1.7
const MAX_DRAW_TIME = 2.0
const MIN_ARROW_SPEED = 18
const MAX_ARROW_SPEED = 65
const MOUSE_SENSITIVITY = 0.0022
const MAX_PITCH = Math.PI / 2 - 0.001
export const ROUND_DURATION = 120
const EXPOSURE = 1.15

type LockListener = (locked: boolean) => void
type ScoreListener = (score: number) => void
type GameOverListener = (gameOver: boolean) => void
type TimeListener = (timeLeft: number) => void

export class Game {
    private container: HTMLElement
    private onLockChange: LockListener
    private onScoreChange: ScoreListener
    private onGameOver: GameOverListener
    private onTimeChange: TimeListener

    private renderer: THREE.WebGLRenderer
    private postfx: PostFX
    private scene: THREE.Scene
    private camera: THREE.PerspectiveCamera
    private bow: Bow
    private world: World
    private level: Level
    private levelIndex = 0
    private arrows: Arrow[] = []
    private effects: HitEffect[] = []

    private locked = false
    private euler = new THREE.Euler(0, 0, 0, 'YXZ')

    private spaceHeld = false
    private drawing = false
    private drawTime = 0

    private score = 0
    private gameOver = false
    private timeLeft = ROUND_DURATION
    private lastEmittedTime = Math.ceil(ROUND_DURATION)

    private running = true
    private frameId = 0
    private lastTime = 0

    constructor(
        container: HTMLElement,
        onLockChange: LockListener,
        onScoreChange: ScoreListener,
        onGameOver: GameOverListener,
        onTimeChange: TimeListener,
    ) {
        this.container = container
        this.onLockChange = onLockChange
        this.onScoreChange = onScoreChange
        this.onGameOver = onGameOver
        this.onTimeChange = onTimeChange

        // MSAA happens inside PostFX's render target, so the default framebuffer skips it.
        this.renderer = new THREE.WebGLRenderer({ antialias: false })
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        this.renderer.setSize(window.innerWidth, window.innerHeight)
        this.renderer.shadowMap.enabled = true
        this.renderer.shadowMap.type = THREE.PCFShadowMap
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping
        this.renderer.toneMappingExposure = EXPOSURE
        container.appendChild(this.renderer.domElement)

        this.scene = new THREE.Scene()

        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.03,
            500,
        )
        this.camera.position.set(0, EYE_HEIGHT, 0)
        this.scene.add(this.camera)

        this.world = new World(this.scene, this.renderer)

        this.level = new Level(LEVELS[this.levelIndex])
        this.scene.add(this.level.group)

        this.bow = new Bow()
        this.bow.group.position.set(0.28, -0.18, -0.55)
        this.camera.add(this.bow.group)

        this.postfx = new PostFX(this.renderer, this.scene, this.camera)

        window.addEventListener('resize', this.onResize)
        window.addEventListener('keydown', this.onKeyDown)
        window.addEventListener('keyup', this.onKeyUp)
        document.addEventListener('pointerlockchange', this.onPointerLockChange)
        document.addEventListener('mousemove', this.onMouseMove)

        this.lastTime = performance.now()
        this.frameId = requestAnimationFrame(this.animate)
    }

    /** Swap in the level at `index`: tear down the current level's targets/rows/flags
     *  and clear every arrow and hit effect so nothing carries over. */
    private loadLevel(index: number): void {
        this.clearArrowsAndEffects()
        this.scene.remove(this.level.group)
        this.level.dispose()

        this.levelIndex = index
        this.level = new Level(LEVELS[index])
        this.scene.add(this.level.group)
    }

    private clearArrowsAndEffects(): void {
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
    }

    requestLock(): void {
        if (this.gameOver) return
        if (!this.locked) {
            this.renderer.domElement.requestPointerLock()
        }
    }

    /** Reset the round: rebuild the current level, zero the score, resume play. */
    restart(): void {
        this.loadLevel(this.levelIndex)

        this.score = 0
        this.onScoreChange(0)
        this.timeLeft = ROUND_DURATION
        this.lastEmittedTime = Math.ceil(ROUND_DURATION)
        this.onTimeChange(this.lastEmittedTime)
        this.gameOver = false
        this.onGameOver(false)
        // Avoid a large dt spike on the first frame back.
        this.lastTime = performance.now()
    }

    private triggerGameOver(): void {
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
        this.level.dispose()
        this.world.dispose()
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
        this.postfx.dispose()
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
        this.bow.release()
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
        const bestHit = this.level.findHit(arrow.prevTip, arrow.tip)

        const fy = arrow.prevTip.y
        const ty = arrow.tip.y
        // A tip already below ground (a steep downward shot spawns it there) sticks at t = 0.
        const groundT = ty >= 0 ? Infinity : fy >= 0 ? fy / (fy - ty) : 0

        if (bestHit && bestHit.t <= groundT) {
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
        this.postfx.setSize(window.innerWidth, window.innerHeight)
    }

    private animate = (): void => {
        if (!this.running) return
        this.frameId = requestAnimationFrame(this.animate)

        const now = performance.now()
        const dt = Math.min(0.05, (now - this.lastTime) / 1000)
        this.lastTime = now

        this.world.update(dt)
        this.bow.update(dt)

        if (!this.gameOver) {
            if (this.locked) {
                this.timeLeft = Math.max(0, this.timeLeft - dt)
                const displayTime = Math.ceil(this.timeLeft)
                if (displayTime !== this.lastEmittedTime) {
                    this.lastEmittedTime = displayTime
                    this.onTimeChange(displayTime)
                }
            }

            if (this.drawing) {
                this.drawTime = Math.min(this.drawTime + dt, MAX_DRAW_TIME)
                this.bow.setDraw(this.drawTime / MAX_DRAW_TIME)
            }

            // Advance moving targets first so arrow hit-tests use this frame's positions.
            this.level.update(dt)

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

            if (this.timeLeft <= 0 || this.level.isComplete) {
                this.triggerGameOver()
            }
        }

        this.postfx.render()
    }
}
