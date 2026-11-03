import * as THREE from 'three'
import { Barrels } from './Barrels'
import { Booth } from './Booth'
import { CornerBows } from './CornerBows'
import { Flowers } from './Flowers'
import { FrontRailing } from './FrontRailing'
import { Plants } from './Plants'
import { Trees } from './Trees'

const SKY_COLOR = 0x87ceeb

/**
 * The static environment shared by every level: sky/fog, lights, the grass
 * ground, the booth, and all surrounding scenery. Built once per `Game` and
 * never rebuilt when levels change.
 *
 * Unlike the scenery classes it owns, `World` attaches itself to the scene in
 * its constructor because sky color and fog live on the `Scene`, not a group.
 */
export class World {
    readonly group: THREE.Group
    private scene: THREE.Scene
    private barrels: Barrels
    private booth: Booth
    private cornerBows: CornerBows
    private flowers: Flowers
    private frontRailing: FrontRailing
    private plants: Plants
    private trees: Trees
    private grassTexture: THREE.Texture
    private ground: THREE.Mesh

    constructor(scene: THREE.Scene) {
        this.scene = scene
        this.group = new THREE.Group()

        scene.background = new THREE.Color(SKY_COLOR)
        scene.fog = new THREE.Fog(SKY_COLOR, 90, 280)

        const hemi = new THREE.HemisphereLight(0xb1e1ff, 0x4a6e3c, 0.65)
        this.group.add(hemi)

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
        this.group.add(sun)

        this.grassTexture = createGrassTexture()
        this.ground = new THREE.Mesh(
            new THREE.PlaneGeometry(500, 500),
            new THREE.MeshStandardMaterial({ map: this.grassTexture, roughness: 1 }),
        )
        this.ground.rotation.x = -Math.PI / 2
        this.ground.receiveShadow = true
        this.group.add(this.ground)

        this.booth = new Booth()
        this.group.add(this.booth.group)

        this.cornerBows = new CornerBows()
        this.group.add(this.cornerBows.group)

        this.frontRailing = new FrontRailing()
        this.group.add(this.frontRailing.group)

        this.barrels = new Barrels()
        this.group.add(this.barrels.group)

        this.trees = new Trees()
        this.group.add(this.trees.group)

        this.flowers = new Flowers()
        this.group.add(this.flowers.group)

        this.plants = new Plants()
        this.group.add(this.plants.group)

        scene.add(this.group)
    }

    dispose(): void {
        this.scene.remove(this.group)
        this.barrels.dispose()
        this.booth.dispose()
        this.cornerBows.dispose()
        this.frontRailing.dispose()
        this.flowers.dispose()
        this.plants.dispose()
        this.trees.dispose()
        this.ground.geometry.dispose()
        ;(this.ground.material as THREE.Material).dispose()
        this.grassTexture.dispose()
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
