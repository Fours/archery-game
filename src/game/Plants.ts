import * as THREE from 'three'
import { scatterBoothInterior, scatterField } from './groundScatter'

const LEAF_WIDTH = 0.04
const LEAF_HEIGHT = 0.12
const LEAF_TILT = Math.PI / 7

const LEAF_COLOR = 0x4a7c2a

const INSIDE_COUNT = 30
// Plants per m² near the player; thins with distance (see groundScatter).
const FIELD_DENSITY = 0.42

/**
 * Decorative ground sprouts. Each plant is two triangle leaves sharing a
 * base at the ground, splayed in opposite directions to form a V. Every leaf
 * is an instance of one `InstancedMesh`, so the whole field is a single draw
 * call. Scatter regions and densities mirror Flowers so the two layers appear
 * at comparable density.
 */
export class Plants {
    readonly group: THREE.Group

    private leafGeo: THREE.BufferGeometry
    private leafMat: THREE.Material
    private leaves: THREE.InstancedMesh

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
        // Both windings, with every normal pointing straight up: the leaves
        // shade like the grass they grow from instead of going black whenever
        // a face turns away from the sun (which DoubleSide's flipped normals do).
        this.leafGeo.setIndex([0, 1, 2, 0, 2, 1])
        this.leafGeo.setAttribute(
            'normal',
            new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
        )

        this.leafMat = new THREE.MeshStandardMaterial({
            color: LEAF_COLOR,
            roughness: 0.9,
        })

        const points = [...scatterBoothInterior(INSIDE_COUNT), ...scatterField(FIELD_DENSITY)]
        const leaves = new THREE.InstancedMesh(this.leafGeo, this.leafMat, points.length * 2)
        const plant = new THREE.Matrix4()
        const leaf = new THREE.Matrix4()
        const pos = new THREE.Vector3()
        const quat = new THREE.Quaternion()
        const euler = new THREE.Euler()
        const scale = new THREE.Vector3()
        points.forEach((p, i) => {
            pos.set(p.x, 0, p.z)
            quat.setFromEuler(euler.set(0, Math.random() * Math.PI * 2, 0))
            scale.setScalar((1.4 + Math.random() * 1.2) * p.distanceScale)
            plant.compose(pos, quat, scale)

            // Two triangles splayed in opposite directions, with slight per-plant
            // tilt variation so they don't all look stamped from the same mold.
            leaf.makeRotationZ(LEAF_TILT * (0.7 + Math.random() * 0.6))
            leaves.setMatrixAt(i * 2, leaf.premultiply(plant))
            leaf.makeRotationZ(-LEAF_TILT * (0.7 + Math.random() * 0.6))
            leaves.setMatrixAt(i * 2 + 1, leaf.premultiply(plant))
        })
        leaves.computeBoundingSphere()
        this.leaves = leaves
        this.group.add(leaves)
    }

    dispose(): void {
        this.leafGeo.dispose()
        this.leafMat.dispose()
        this.leaves.dispose()
    }
}
