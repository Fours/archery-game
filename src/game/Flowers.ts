import * as THREE from 'three'
import { scatterBoothInterior, scatterField, type GroundPoint } from './groundScatter'

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
// Flowers per m² near the player; thins with distance (see groundScatter).
const FIELD_DENSITY = 0.42

/**
 * Decorative wildflowers scattered on the grass — inside the booth and across
 * the whole field around it, thinning out into the fog. Each part is one
 * `InstancedMesh` (stem, center, and one per petal color), so the thousands of
 * flowers cost six draw calls. ~85% white blooms with rare pink/blue/yellow
 * accents.
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

        const points = [...scatterBoothInterior(INSIDE_COUNT), ...scatterField(FIELD_DENSITY)]
        this.build(points)
    }

    private build(points: GroundPoint[]): void {
        const stems: THREE.Matrix4[] = []
        const centers: THREE.Matrix4[] = []
        const petals = new Map<THREE.Material, THREE.Matrix4[]>()

        const flower = new THREE.Matrix4()
        const part = new THREE.Matrix4()
        const pos = new THREE.Vector3()
        const quat = new THREE.Quaternion()
        const euler = new THREE.Euler()
        const scale = new THREE.Vector3()
        const one = new THREE.Vector3(1, 1, 1)

        for (const p of points) {
            pos.set(p.x, 0, p.z)
            quat.setFromEuler(euler.set(0, Math.random() * Math.PI * 2, 0))
            scale.setScalar((1.4 + Math.random() * 1.2) * p.distanceScale)
            flower.compose(pos, quat, scale)

            part.makeTranslation(0, STEM_HEIGHT / 2, 0)
            stems.push(flower.clone().multiply(part))

            // Tilt the bloom slightly so flowers don't all face perfectly upward.
            euler.set((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3)
            part.compose(pos.set(0, STEM_HEIGHT, 0), quat.setFromEuler(euler), one)
            const mat = this.pickPetalMat()
            let list = petals.get(mat)
            if (!list) petals.set(mat, (list = []))
            list.push(flower.clone().multiply(part))

            part.makeTranslation(0, STEM_HEIGHT + PETAL_THICKNESS / 2, 0)
            centers.push(flower.clone().multiply(part))
        }

        this.addInstances(this.stemGeo, this.stemMat, stems)
        this.addInstances(this.centerGeo, this.centerMat, centers)
        for (const [mat, list] of petals) this.addInstances(this.petalGeo, mat, list)
    }

    private addInstances(
        geo: THREE.BufferGeometry,
        mat: THREE.Material,
        matrices: THREE.Matrix4[],
    ): void {
        const mesh = new THREE.InstancedMesh(geo, mat, matrices.length)
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
        mesh.computeBoundingSphere()
        this.group.add(mesh)
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
        for (const child of this.group.children) (child as THREE.InstancedMesh).dispose()
    }
}
