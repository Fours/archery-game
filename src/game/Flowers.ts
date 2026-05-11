import * as THREE from 'three'
import { BACK_Z, FRONT_Z, HALF_WIDTH } from './Booth'

const STEM_HEIGHT = 0.08
const PETAL_RADIUS = 0.04
const PETAL_THICKNESS = 0.005
const CENTER_RADIUS = 0.012

const STEM_COLOR = 0x4a8c2a
const CENTER_COLOR = 0xf4c52a
const WHITE = 0xfafafa
const PINK = 0xf2c4d6
const PALE_BLUE = 0xc9d4ff
const PALE_YELLOW = 0xf9e7a8

const INSIDE_COUNT = 30
const OUTSIDE_COUNT = 80
const PLAYER_EXCLUSION_RADIUS = 0.8

// Outer-area scatter rectangle, in world coords. Player stands at (0, _, 0)
// and looks down −Z, so this covers a wide patch in front of, beside, and
// behind the player without overlapping the booth interior.
const OUTSIDE_X_MIN = -9
const OUTSIDE_X_MAX = 9
const OUTSIDE_Z_MIN = -1.5
const OUTSIDE_Z_MAX = 9

type ScatterRegion = {
    count: number
    xMin: number
    xMax: number
    zMin: number
    zMax: number
    exclude?: (x: number, z: number) => boolean
}

/**
 * Decorative wildflowers scattered on the grass — both inside the booth and
 * in a wide patch around the player. All flowers share three geometries and
 * five materials (one stem + one center + four petal colors), so total GPU
 * resource cost is tiny regardless of flower count. ~85% white blooms with
 * rare pink/blue/yellow accents.
 */
export class Flowers {
    readonly group: THREE.Group

    private stemGeo: THREE.BufferGeometry
    private petalGeo: THREE.BufferGeometry
    private centerGeo: THREE.BufferGeometry

    private stemMat: THREE.Material
    private centerMat: THREE.Material
    private whiteMat: THREE.Material
    private pinkMat: THREE.Material
    private blueMat: THREE.Material
    private yellowMat: THREE.Material

    constructor() {
        this.group = new THREE.Group()

        this.stemGeo = new THREE.CylinderGeometry(0.004, 0.004, STEM_HEIGHT, 5)
        this.petalGeo = new THREE.CylinderGeometry(
            PETAL_RADIUS,
            PETAL_RADIUS,
            PETAL_THICKNESS,
            6,
        )
        this.centerGeo = new THREE.SphereGeometry(CENTER_RADIUS, 8, 6)

        this.stemMat = new THREE.MeshStandardMaterial({ color: STEM_COLOR, roughness: 0.9 })
        this.centerMat = new THREE.MeshStandardMaterial({ color: CENTER_COLOR, roughness: 0.7 })
        this.whiteMat = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.85 })
        this.pinkMat = new THREE.MeshStandardMaterial({ color: PINK, roughness: 0.85 })
        this.blueMat = new THREE.MeshStandardMaterial({ color: PALE_BLUE, roughness: 0.85 })
        this.yellowMat = new THREE.MeshStandardMaterial({ color: PALE_YELLOW, roughness: 0.85 })

        this.scatter({
            count: INSIDE_COUNT,
            xMin: -HALF_WIDTH + 0.3,
            xMax: HALF_WIDTH - 0.3,
            zMin: BACK_Z + 0.3,
            zMax: FRONT_Z - 0.1,
        })

        this.scatter({
            count: OUTSIDE_COUNT,
            xMin: OUTSIDE_X_MIN,
            xMax: OUTSIDE_X_MAX,
            zMin: OUTSIDE_Z_MIN,
            zMax: OUTSIDE_Z_MAX,
            exclude: (x, z) =>
                x * x + z * z < PLAYER_EXCLUSION_RADIUS * PLAYER_EXCLUSION_RADIUS,
        })
    }

    private scatter(region: ScatterRegion): void {
        const maxTries = region.count * 10
        let placed = 0
        let tries = 0
        while (placed < region.count && tries < maxTries) {
            tries++
            const x = THREE.MathUtils.lerp(region.xMin, region.xMax, Math.random())
            const z = THREE.MathUtils.lerp(region.zMin, region.zMax, Math.random())
            if (region.exclude?.(x, z)) continue
            this.group.add(this.makeFlower(x, z))
            placed++
        }
    }

    private makeFlower(x: number, z: number): THREE.Group {
        const flower = new THREE.Group()
        flower.position.set(x, 0, z)
        flower.rotation.y = Math.random() * Math.PI * 2
        flower.scale.setScalar(1.4 + Math.random() * 1.2)

        const stem = new THREE.Mesh(this.stemGeo, this.stemMat)
        stem.position.y = STEM_HEIGHT / 2
        flower.add(stem)

        const petals = new THREE.Mesh(this.petalGeo, this.pickPetalMat())
        petals.position.y = STEM_HEIGHT
        // Tilt the bloom slightly so flowers don't all face perfectly upward.
        petals.rotation.x = (Math.random() - 0.5) * 0.3
        petals.rotation.z = (Math.random() - 0.5) * 0.3
        flower.add(petals)

        const center = new THREE.Mesh(this.centerGeo, this.centerMat)
        center.position.y = STEM_HEIGHT + PETAL_THICKNESS / 2
        flower.add(center)

        return flower
    }

    private pickPetalMat(): THREE.Material {
        const r = Math.random()
        if (r < 0.85) return this.whiteMat
        if (r < 0.9) return this.pinkMat
        if (r < 0.95) return this.blueMat
        return this.yellowMat
    }

    dispose(): void {
        this.stemGeo.dispose()
        this.petalGeo.dispose()
        this.centerGeo.dispose()
        this.stemMat.dispose()
        this.centerMat.dispose()
        this.whiteMat.dispose()
        this.pinkMat.dispose()
        this.blueMat.dispose()
        this.yellowMat.dispose()
    }
}
