import * as THREE from 'three'
import { Barrels } from './Barrels'
import { Booth } from './Booth'
import { CornerBows } from './CornerBows'
import { Flowers } from './Flowers'
import { createGrassTexture, setWorldUVs } from './materials'
import { FrontRailing } from './FrontRailing'
import { KitScenery } from './KitScenery'
import { Plants } from './Plants'
import { Sky, SKY_HORIZON } from './Sky'
import { Trees } from './Trees'
import type { WindTime } from './wind'

// Late-afternoon key light: warm, low enough to rake in under the booth roof
// from behind the player.
const SUN_COLOR = 0xffd9a0
const SUN_INTENSITY = 3.2
const SUN_POSITION = new THREE.Vector3(22, 26, 34)
// Shadow frustum is fit tightly around the booth so the 2048² map stays crisp.
const SHADOW_EXTENT = 24
const ENV_INTENSITY = 0.9
const GROUND_SIZE = 500
const GRASS_TILE_METERS = 6

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
    private kitScenery: KitScenery
    private plants: Plants
    private trees: Trees
    private sky: Sky
    private grassTexture: THREE.Texture
    private ground: THREE.Mesh
    // Shared clock for every wind-swayed material (trees, grass, flowers).
    private windTime: WindTime = { value: 0 }

    constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
        this.scene = scene
        this.group = new THREE.Group()

        this.sky = new Sky(renderer)
        this.group.add(this.sky.group)
        scene.environment = this.sky.environment
        scene.environmentIntensity = ENV_INTENSITY
        scene.fog = new THREE.Fog(SKY_HORIZON, 40, 260)

        // Weak bounce fill — the env map now carries most of the ambient.
        const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x6b5a3a, 0.35)
        this.group.add(hemi)

        const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY)
        sun.position.copy(SUN_POSITION)
        sun.target.position.set(0, 0, -8)
        sun.castShadow = true
        sun.shadow.mapSize.set(2048, 2048)
        sun.shadow.camera.left = -SHADOW_EXTENT
        sun.shadow.camera.right = SHADOW_EXTENT
        sun.shadow.camera.top = SHADOW_EXTENT
        sun.shadow.camera.bottom = -SHADOW_EXTENT
        sun.shadow.camera.near = 1
        sun.shadow.camera.far = 120
        sun.shadow.bias = -0.0004
        sun.shadow.normalBias = 0.03
        sun.shadow.radius = 3
        this.group.add(sun)
        this.group.add(sun.target)

        this.grassTexture = createGrassTexture(GRASS_TILE_METERS)
        const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE)
        setWorldUVs(groundGeo)
        this.ground = new THREE.Mesh(
            groundGeo,
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

        this.trees = new Trees(this.windTime)
        this.group.add(this.trees.group)

        this.flowers = new Flowers(this.windTime)
        this.group.add(this.flowers.group)

        this.plants = new Plants(this.windTime)
        this.group.add(this.plants.group)

        this.kitScenery = new KitScenery()
        this.group.add(this.kitScenery.group)

        scene.add(this.group)
    }

    /** Ambient animation (wind); runs every frame, paused or not. */
    update(dt: number): void {
        this.windTime.value += dt
    }

    /** Seconds on the shared wind clock. */
    get windClock(): number {
        return this.windTime.value
    }

    dispose(): void {
        this.scene.remove(this.group)
        this.scene.environment = null
        this.sky.dispose()
        this.barrels.dispose()
        this.booth.dispose()
        this.cornerBows.dispose()
        this.frontRailing.dispose()
        this.kitScenery.dispose()
        this.flowers.dispose()
        this.plants.dispose()
        this.trees.dispose()
        this.ground.geometry.dispose()
        ;(this.ground.material as THREE.Material).dispose()
        this.grassTexture.dispose()
    }
}
