import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { COUNTER_SURFACE_Y } from './Booth'

// One GLB bundling every KayKit model we use (CC0, Kay Lousberg — see
// public/models/LICENSE-KayKit-Medieval-Hexagon.txt). Each model is a
// top-level node named after its source file, sitting at the origin with its
// base at y = 0. All share one material + one 1024² palette atlas. Rebuild
// the bundle with Blender (see CLAUDE.md) when adding models.
const MODEL_URL = '/models/kaykit_props.glb'

// KayKit is authored for a small hex board; these bring it to world meters.
const PROP_SCALE = 3.2

const KIT_ROUGHNESS = 0.8

interface Placement {
    model: string
    x: number
    y?: number
    z: number
    scale: number
    /** Yaw in radians. Omitted → turn the model's front (+Z) toward the player. */
    rotY?: number
}

const PLACEMENTS: Placement[] = [
    // On the counter, left of center: the booth's own arrow supply.
    { model: 'bucket_arrows', x: -2.7, y: COUNTER_SURFACE_Y, z: -2.25, scale: 2.6, rotY: 0.4 },

    // Outside front-left: stacked crates and a sack beside the barrels.
    { model: 'crate_A_big', x: -6.6, z: 0.9, scale: PROP_SCALE, rotY: 0.3 },
    { model: 'crate_A_big', x: -6.55, y: 0.67, z: 0.9, scale: PROP_SCALE, rotY: -0.2 },
    { model: 'crate_A_small', x: -7.5, z: 1.4, scale: PROP_SCALE, rotY: 0.7 },
    { model: 'sack', x: -6.0, z: 1.7, scale: PROP_SCALE, rotY: 1.2 },

    // Outside front-right: produce crates, wheelbarrow, and a weapon rack.
    { model: 'crate_open', x: 5.7, z: 0.8, scale: PROP_SCALE, rotY: -0.5 },
    { model: 'crate_long_A', x: 6.2, z: 2.3, scale: PROP_SCALE, rotY: 0.4 },
    { model: 'wheelbarrow', x: 7.6, z: 1.2, scale: PROP_SCALE, rotY: -0.9 },
    { model: 'weaponrack', x: 8.4, z: -0.6, scale: 4 },
]

/**
 * Third-party KayKit props dressing the booth: arrows on the counter and
 * crates, produce, a wheelbarrow, and a weapon rack outside. Loads asynchronously — the group is
 * empty until the GLB arrives. If disposed before then, the late-arriving
 * resources are released immediately (React StrictMode mounts twice in dev).
 */
export class KitScenery {
    readonly group: THREE.Group
    private library: THREE.Object3D | null = null
    private disposed = false

    constructor() {
        this.group = new THREE.Group()
        new GLTFLoader()
            .loadAsync(MODEL_URL)
            .then((gltf) => {
                if (this.disposed) {
                    disposeLibrary(gltf.scene)
                    return
                }
                this.library = gltf.scene
                this.build(gltf.scene)
            })
            .catch((err: unknown) => console.error(`Failed to load ${MODEL_URL}`, err))
    }

    private build(library: THREE.Object3D): void {
        let kitMaterial: THREE.MeshStandardMaterial | null = null
        library.traverse((obj) => {
            const mesh = obj as THREE.Mesh
            if (mesh.isMesh && !kitMaterial) kitMaterial = mesh.material as THREE.MeshStandardMaterial
        })
        if (!kitMaterial) return
        const mat: THREE.MeshStandardMaterial = kitMaterial
        // KayKit ships at roughness 0.5, which reads plasticky under our sun.
        mat.roughness = KIT_ROUGHNESS
        if (mat.map) mat.map.anisotropy = 8

        for (const p of PLACEMENTS) {
            const inst = this.instance(p.model)
            if (!inst) continue
            inst.position.set(p.x, p.y ?? 0, p.z)
            inst.scale.setScalar(p.scale)
            inst.rotation.y = p.rotY ?? Math.atan2(-p.x, -p.z)
            inst.traverse((o) => {
                o.castShadow = true
                o.receiveShadow = true
            })
            this.group.add(inst)
        }
    }

    /** Clone a named model; clones share the library's geometry and material. */
    private instance(name: string): THREE.Object3D | null {
        const src = this.library?.getObjectByName(name)
        if (!src) {
            console.warn(`KitScenery: model "${name}" not in ${MODEL_URL}`)
            return null
        }
        return src.clone()
    }

    dispose(): void {
        this.disposed = true
        if (this.library) disposeLibrary(this.library)
        this.library = null
    }
}

function disposeLibrary(root: THREE.Object3D): void {
    const materials = new Set<THREE.Material>()
    root.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) materials.add(m)
    })
    for (const m of materials) {
        ;(m as THREE.MeshStandardMaterial).map?.dispose()
        m.dispose()
    }
}
