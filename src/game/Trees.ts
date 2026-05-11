import * as THREE from 'three'

const TRUNK_HEIGHT = 3.5
const TRUNK_RADIUS_BOTTOM = 0.22
const TRUNK_RADIUS_TOP = 0.12
const TRUNK_SEGMENTS = 12

const TRUNK_COLOR = 0x4a2c14
const FOLIAGE_LIGHT = 0x5fa84f
const FOLIAGE_DARK = 0x3a7d3a

// Foliage blob layout in tree-local coords. y_offset is relative to the top
// of the trunk; the cluster is intentionally asymmetric so a rotation
// produces a visibly different silhouette.
//
// [x, y_offset_above_trunk, z, radius]
const FOLIAGE_BLOBS: [number, number, number, number][] = [
    [ 0.0,  1.0,  0.0, 1.40], // central main canopy
    [ 1.1,  0.5,  0.5, 0.75], // right front
    [-1.0,  0.6,  0.4, 0.80], // left front
    [ 0.6,  0.7, -0.8, 0.70], // right back
    [-0.8,  0.4, -0.7, 0.75], // left back
    [ 0.2,  1.6, -0.3, 0.60], // top back
    [-0.3,  1.5,  0.4, 0.55], // top front
    [ 0.0, -0.3,  0.7, 0.50], // low front, like a dangling branch
]

interface TreeSpec {
    x: number
    z: number
    /** Rotation about world Z applied before translation — tilts the tree. */
    rotationZ?: number
    /** Uniform scale, default 1. */
    scale?: number
}

// Foreground + background woods. Background positions sit at |x| > 8 or z > 4
// so they aren't hidden behind the booth's solid side walls; one tall tree
// goes deep behind the booth so its scaled-up canopy pokes over the roof.
const TREES: TreeSpec[] = [
    // Outer left corner, beside the front-left barrels.
    { x: -7.0, z: -2.0 },
    // Outer right corner. Rotated about Z so the asymmetric canopy reads
    // distinctly from the left tree. Negative angle leans the top toward
    // +X (outward from the booth) so the foliage doesn't clip into the
    // booth's interior.
    { x: 7.0, z: -2.0, rotationZ: -Math.PI / 8 },

    // Background woods — left of player.
    { x: -14, z: -1,  scale: 1.5 },
    { x: -18, z:  4,  scale: 2.5 },
    { x: -12, z:  8,  scale: 1.8 },
    { x: -22, z: 14,  scale: 3.0 },
    { x: -25, z:  2,  scale: 2.0 },

    // Background woods — right of player.
    { x:  14, z: -1,  scale: 1.4 },
    { x:  19, z:  5,  scale: 2.7 },
    { x:  12, z: 10,  scale: 1.0 },
    { x:  22, z: 14,  scale: 2.8 },
    { x:  26, z:  3,  scale: 1.9 },

    // Background woods — behind player.
    { x:  -7, z: 14,  scale: 1.6 },
    { x:   5, z: 12,  scale: 1.3 },
    { x: -12, z: 22,  scale: 2.4 },
    { x:   9, z: 22,  scale: 1.1 },
    { x:   0, z: 19,  scale: 2.5 },
    { x:  -4, z: 28,  scale: 2.2 },
]

/**
 * Stylized scenery trees: a tapered trunk topped with a cluster of varying
 * green foliage spheres. The cluster is asymmetric so rotating one tree
 * about Z noticeably changes its silhouette. All trees share one trunk
 * geometry, one unit-sphere foliage geometry, and two foliage materials
 * (light/dark green) alternated across blobs for visual variety.
 */
export class Trees {
    readonly group: THREE.Group
    private trunkGeo: THREE.BufferGeometry
    private foliageGeo: THREE.BufferGeometry
    private trunkMat: THREE.Material
    private foliageLightMat: THREE.Material
    private foliageDarkMat: THREE.Material

    constructor() {
        this.group = new THREE.Group()

        this.trunkGeo = new THREE.CylinderGeometry(
            TRUNK_RADIUS_TOP,
            TRUNK_RADIUS_BOTTOM,
            TRUNK_HEIGHT,
            TRUNK_SEGMENTS,
        )
        // Unit sphere — each blob mesh sets its own scale.setScalar(r).
        this.foliageGeo = new THREE.SphereGeometry(1, 10, 8)

        this.trunkMat = new THREE.MeshStandardMaterial({
            color: TRUNK_COLOR,
            roughness: 0.9,
        })
        this.foliageLightMat = new THREE.MeshStandardMaterial({
            color: FOLIAGE_LIGHT,
            roughness: 0.85,
        })
        this.foliageDarkMat = new THREE.MeshStandardMaterial({
            color: FOLIAGE_DARK,
            roughness: 0.85,
        })

        for (const tree of TREES) {
            this.group.add(this.makeTree(tree))
        }
    }

    private makeTree(spec: TreeSpec): THREE.Group {
        const tree = new THREE.Group()
        tree.position.set(spec.x, 0, spec.z)
        if (spec.rotationZ !== undefined) {
            tree.rotation.z = spec.rotationZ
        }
        if (spec.scale !== undefined) {
            // T*R*S in three.js: scale is applied first (in local), so the base
            // of the trunk stays at the tree group's origin regardless of scale.
            tree.scale.setScalar(spec.scale)
        }

        // Trunk: cylinder along +Y. position.y = TRUNK_HEIGHT/2 puts the base
        // at the tree-group's origin (y=0). With the optional rotation.z, the
        // trunk leans from this same base point.
        const trunk = new THREE.Mesh(this.trunkGeo, this.trunkMat)
        trunk.position.y = TRUNK_HEIGHT / 2
        trunk.castShadow = true
        trunk.receiveShadow = true
        tree.add(trunk)

        // Foliage blobs at the top of the trunk. Alternate materials so the
        // canopy reads as light/dark green clusters rather than a uniform mass.
        for (let i = 0; i < FOLIAGE_BLOBS.length; i++) {
            const [x, oy, z, r] = FOLIAGE_BLOBS[i]
            const mat = i % 2 === 0 ? this.foliageLightMat : this.foliageDarkMat
            const blob = new THREE.Mesh(this.foliageGeo, mat)
            blob.position.set(x, TRUNK_HEIGHT + oy, z)
            blob.scale.setScalar(r)
            blob.castShadow = true
            tree.add(blob)
        }

        return tree
    }

    dispose(): void {
        this.trunkGeo.dispose()
        this.foliageGeo.dispose()
        this.trunkMat.dispose()
        this.foliageLightMat.dispose()
        this.foliageDarkMat.dispose()
    }
}
