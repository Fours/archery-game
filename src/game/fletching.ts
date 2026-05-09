import * as THREE from 'three'

const FLETCH_LENGTH = 0.11
const FLETCH_HEIGHT = 0.032
const SHAFT_OFFSET = 0.012
const TRAILING_EDGE_Z = -0.02

/**
 * Build a Group containing 3 feather vanes spaced 120° around the shaft, sitting
 * just forward of the arrow tail (z = TRAILING_EDGE_Z) and extending toward the tip
 * along -Z. Caller adds this as a child of an arrow mesh whose tail is at z=0.
 */
export function createFletching(color = 0xd13a3a): THREE.Group {
    const shape = new THREE.Shape()
    shape.moveTo(0, 0)
    shape.quadraticCurveTo(
        FLETCH_LENGTH * 0.3, FLETCH_HEIGHT * 1.15,
        FLETCH_LENGTH * 0.6, FLETCH_HEIGHT * 0.9,
    )
    shape.quadraticCurveTo(
        FLETCH_LENGTH * 0.9, FLETCH_HEIGHT * 0.4,
        FLETCH_LENGTH, 0,
    )
    shape.closePath()

    // Per-instance geom + mat so Arrow.dispose() can free them without affecting siblings.
    const geom = new THREE.ShapeGeometry(shape, 12)
    const mat = new THREE.MeshStandardMaterial({
        color,
        side: THREE.DoubleSide,
        roughness: 0.85,
    })

    const group = new THREE.Group()
    for (let i = 0; i < 3; i++) {
        const rotator = new THREE.Group()
        rotator.rotation.z = (i / 3) * Math.PI * 2
        const vane = new THREE.Mesh(geom, mat)
        // ShapeGeometry lives in the XY plane; rotating around Y by 90° maps shape's
        // X axis (length) to arrow -Z (forward along shaft) while keeping shape Y radial.
        vane.rotation.y = Math.PI / 2
        vane.position.set(0, SHAFT_OFFSET, TRAILING_EDGE_Z)
        rotator.add(vane)
        group.add(rotator)
    }
    return group
}
