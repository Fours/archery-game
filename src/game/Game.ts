import * as THREE from 'three'
import { Arrow } from './Arrow'
import { Bow } from './Bow'

const EYE_HEIGHT = 1.7
const MAX_DRAW_TIME = 2.0
const MIN_ARROW_SPEED = 18
const MAX_ARROW_SPEED = 65
const MOUSE_SENSITIVITY = 0.0022
const MAX_PITCH = Math.PI / 2 - 0.001

type LockListener = (locked: boolean) => void

export class Game {
    private container: HTMLElement
    private onLockChange: LockListener

    private renderer: THREE.WebGLRenderer
    private scene: THREE.Scene
    private camera: THREE.PerspectiveCamera
    private bow: Bow
    private arrows: Arrow[] = []
    private grassTexture: THREE.Texture

    private locked = false
    private euler = new THREE.Euler(0, 0, 0, 'YXZ')

    private spaceHeld = false
    private drawing = false
    private drawTime = 0

    private running = true
    private frameId = 0
    private lastTime = 0

    constructor(container: HTMLElement, onLockChange: LockListener) {
        this.container = container
        this.onLockChange = onLockChange

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
        sun.shadow.camera.left = -50
        sun.shadow.camera.right = 50
        sun.shadow.camera.top = 50
        sun.shadow.camera.bottom = -50
        sun.shadow.camera.near = 1
        sun.shadow.camera.far = 200
        this.scene.add(sun)

        this.grassTexture = createGrassTexture()
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(500, 500),
            new THREE.MeshStandardMaterial({ map: this.grassTexture, roughness: 1 }),
        )
        ground.rotation.x = -Math.PI / 2
        ground.receiveShadow = true
        this.scene.add(ground)

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

    requestLock(): void {
        if (!this.locked) {
            this.renderer.domElement.requestPointerLock()
        }
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

        if (this.drawing) {
            this.drawTime = Math.min(this.drawTime + dt, MAX_DRAW_TIME)
            this.bow.setDraw(this.drawTime / MAX_DRAW_TIME)
        }

        for (const arrow of this.arrows) arrow.update(dt)

        this.renderer.render(this.scene, this.camera)
    }
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
