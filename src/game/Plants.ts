import * as THREE from 'three'
import { BACK_Z, FRONT_Z, HALF_WIDTH } from './Booth'

const LEAF_WIDTH = 0.04
const LEAF_HEIGHT = 0.12
const LEAF_TILT = Math.PI / 7

const LEAF_COLOR = 0x4a7c2a

const INSIDE_COUNT = 30
const OUTSIDE_COUNT = 80
const PLAYER_EXCLUSION_RADIUS = 0.8

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
 * Decorative ground sprouts. Each plant is two triangle leaves sharing a
 * base at the ground, splayed in opposite directions to form a V. All plants
 * share one geometry and one double-sided material so the GPU footprint is
 * negligible. Scatter regions and counts mirror Flowers so the two layers
 * appear at comparable density.
 */
export class Plants {
    readonly group: THREE.Group

    private leafGeo: THREE.BufferGeometry
    private leafMat: THREE.Material

    constructor() {
        this.group = new THREE.Group()

        // Triangle in XY plane: base on the ground, tip at top.
        this.leafGeo = new THREE.BufferGeometry()
        const verts = new Float32Array([
            -LEAF_WIDTH / 2, 0, 0,
             LEAF_WIDTH / 2, 0, 0,
             0, LEAF_HEIGHT, 0,
        ])
        this.leafGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
        this.leafGeo.setIndex([0, 1, 2])
        this.leafGeo.computeVertexNormals()

        this.leafMat = new THREE.MeshStandardMaterial({
            color: LEAF_COLOR,
            roughness: 0.9,
            side: THREE.DoubleSide,
        })

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
            this.group.add(this.makePlant(x, z))
            placed++
        }
    }

    private makePlant(x: number, z: number): THREE.Group {
        const plant = new THREE.Group()
        plant.position.set(x, 0, z)
        plant.rotation.y = Math.random() * Math.PI * 2
        plant.scale.setScalar(1.4 + Math.random() * 1.2)

        // Two triangles splayed in opposite directions, with slight per-plant
        // tilt variation so they don't all look stamped from the same mold.
        const tiltA = LEAF_TILT * (0.7 + Math.random() * 0.6)
        const tiltB = LEAF_TILT * (0.7 + Math.random() * 0.6)

        const leafA = new THREE.Mesh(this.leafGeo, this.leafMat)
        leafA.rotation.z = tiltA
        plant.add(leafA)

        const leafB = new THREE.Mesh(this.leafGeo, this.leafMat)
        leafB.rotation.z = -tiltB
        plant.add(leafB)

        return plant
    }

    dispose(): void {
        this.leafGeo.dispose()
        this.leafMat.dispose()
    }
}
