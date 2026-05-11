import * as THREE from 'three'

// Booth footprint. The player stands at z = 0; the booth opens toward +Z.
// FRONT_Z is the front facade (counter and front posts), BACK_Z is the back wall.
export const HALF_WIDTH = 5.0
export const FRONT_Z = -2.0
export const BACK_Z = -16.0
export const ROOF_Y = 5.0

const POST_THICK = 0.2
const WALL_THICK = 0.06
const WALL_HEIGHT = ROOF_Y - 0.05

const COUNTER_TOP_Y = 0.95
const COUNTER_DEPTH = 0.55
const COUNTER_TOP_THICK = 0.07

const VALANCE_HEIGHT = 0.75
const VALANCE_STRIPES = 24

const FLAGPOLE_HEIGHT = 2.5

const RED = 0xc8332c
const WHITE = 0xf2efe6
const BLUE = 0x2b4f8c
const YELLOW = 0xf0d447
const WOOD = 0x6b4423
const DARK_WOOD = 0x3d2812

const BUNTING_COLORS = [RED, WHITE, BLUE, YELLOW]

/**
 * A 19th-century-style fairground booth. The player stands just outside the
 * front edge (at world z ≈ 0); targets live inside between FRONT_Z and BACK_Z.
 * All decorative geometry is added under `group`; dispose() frees everything.
 */
export class Booth {
    readonly group: THREE.Group

    constructor() {
        this.group = new THREE.Group()

        const woodMat = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.9 })
        const darkWoodMat = new THREE.MeshStandardMaterial({ color: DARK_WOOD, roughness: 0.9 })
        const redMat = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.85 })
        const whiteMat = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.85 })
        const housingMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.45,
            metalness: 0.7,
        })
        const bulbMat = new THREE.MeshStandardMaterial({
            color: 0xfff2cc,
            emissive: 0xffd97a,
            emissiveIntensity: 1.6,
            roughness: 0.4,
        })

        this.addPosts(darkWoodMat)
        this.addWalls(woodMat)
        this.addCounter(woodMat, darkWoodMat)
        this.addRoof(redMat, whiteMat)
        this.addValance(redMat, whiteMat)
        this.addFlagpoles(darkWoodMat)
        this.addAllBunting()
        this.addInteriorBunting()
        this.addCornerLights(housingMat, bulbMat)
    }

    private addPosts(mat: THREE.Material): void {
        const geo = new THREE.BoxGeometry(POST_THICK, ROOF_Y, POST_THICK)
        const corners: [number, number][] = [
            [-HALF_WIDTH, FRONT_Z],
            [HALF_WIDTH, FRONT_Z],
            [-HALF_WIDTH, BACK_Z],
            [HALF_WIDTH, BACK_Z],
        ]
        for (const [x, z] of corners) {
            const post = new THREE.Mesh(geo, mat)
            post.position.set(x, ROOF_Y / 2, z)
            post.castShadow = true
            post.receiveShadow = true
            this.group.add(post)
        }
    }

    private addWalls(mat: THREE.Material): void {
        const sideLen = Math.abs(BACK_Z - FRONT_Z) - POST_THICK
        const sideGeo = new THREE.BoxGeometry(WALL_THICK, WALL_HEIGHT, sideLen)
        for (const x of [-HALF_WIDTH, HALF_WIDTH]) {
            const wall = new THREE.Mesh(sideGeo, mat)
            wall.position.set(x, WALL_HEIGHT / 2, (FRONT_Z + BACK_Z) / 2)
            wall.castShadow = true
            wall.receiveShadow = true
            this.group.add(wall)
        }
        const backGeo = new THREE.BoxGeometry(HALF_WIDTH * 2 - POST_THICK, WALL_HEIGHT, WALL_THICK)
        const back = new THREE.Mesh(backGeo, mat)
        back.position.set(0, WALL_HEIGHT / 2, BACK_Z)
        back.receiveShadow = true
        this.group.add(back)
    }

    private addCounter(woodMat: THREE.Material, darkMat: THREE.Material): void {
        const innerWidth = HALF_WIDTH * 2 - POST_THICK

        const topGeo = new THREE.BoxGeometry(innerWidth, COUNTER_TOP_THICK, COUNTER_DEPTH)
        const top = new THREE.Mesh(topGeo, woodMat)
        top.position.set(0, COUNTER_TOP_Y, FRONT_Z - COUNTER_DEPTH / 2)
        top.castShadow = true
        top.receiveShadow = true
        this.group.add(top)

        const frontGeo = new THREE.BoxGeometry(innerWidth, COUNTER_TOP_Y, 0.05)
        const front = new THREE.Mesh(frontGeo, darkMat)
        front.position.set(0, COUNTER_TOP_Y / 2, FRONT_Z + 0.025)
        front.receiveShadow = true
        this.group.add(front)
    }

    private addRoof(redMat: THREE.Material, whiteMat: THREE.Material): void {
        // Red/white candy stripes running front-to-back, aligned with the valance below.
        const sideLen = Math.abs(BACK_Z - FRONT_Z)
        const overhang = 0.25
        const totalWidth = HALF_WIDTH * 2 + overhang
        const totalDepth = sideLen + overhang
        const stripeWidth = totalWidth / VALANCE_STRIPES
        const stripeGeo = new THREE.BoxGeometry(stripeWidth, 0.08, totalDepth)
        for (let i = 0; i < VALANCE_STRIPES; i++) {
            const x = -totalWidth / 2 + (i + 0.5) * stripeWidth
            const stripe = new THREE.Mesh(stripeGeo, i % 2 === 0 ? redMat : whiteMat)
            stripe.position.set(x, ROOF_Y, (FRONT_Z + BACK_Z) / 2)
            stripe.castShadow = true
            stripe.receiveShadow = true
            this.group.add(stripe)
        }
    }

    private addValance(redMat: THREE.Material, whiteMat: THREE.Material): void {
        // Vertical red/white candy stripes hanging from the front roof edge.
        const overhang = 0.25
        const totalWidth = HALF_WIDTH * 2 + overhang
        const stripeWidth = totalWidth / VALANCE_STRIPES
        const stripeGeo = new THREE.BoxGeometry(stripeWidth, VALANCE_HEIGHT, 0.04)
        for (let i = 0; i < VALANCE_STRIPES; i++) {
            const x = -totalWidth / 2 + (i + 0.5) * stripeWidth
            const stripe = new THREE.Mesh(stripeGeo, i % 2 === 0 ? redMat : whiteMat)
            stripe.position.set(x, ROOF_Y - VALANCE_HEIGHT / 2 - 0.04, FRONT_Z + 0.04)
            stripe.castShadow = true
            this.group.add(stripe)
        }
    }

    private addFlagpoles(woodMat: THREE.Material): void {
        const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, FLAGPOLE_HEIGHT, 8)
        const pennantColors = [RED, BLUE]
        const corners: [number, number, number][] = [
            [-HALF_WIDTH, FRONT_Z, pennantColors[0]],
            [HALF_WIDTH, FRONT_Z, pennantColors[1]],
        ]
        for (const [x, z, color] of corners) {
            const pole = new THREE.Mesh(poleGeo, woodMat)
            pole.position.set(x, ROOF_Y + FLAGPOLE_HEIGHT / 2, z)
            pole.castShadow = true
            this.group.add(pole)

            const pennant = makePennant(color)
            // Pennants stream toward -Z (deeper into the booth) so they're visible from the front.
            pennant.position.set(x, ROOF_Y + FLAGPOLE_HEIGHT - 0.05, z)
            pennant.rotation.y = Math.PI / 2
            this.group.add(pennant)
        }
    }

    private addInteriorBunting(): void {
        // One continuous flag garland strung along the left, back, and right
        // interior walls. Anchors hug just inside the wall surfaces (offset
        // by `inset` to avoid z-fighting with wall geometry); each segment
        // between consecutive anchors swoops with parabolic sag.
        const inset = 0.05
        const yTop = ROOF_Y - 0.25
        const sag = 0.7
        const flagsPerSwag = 11

        const minX = -HALF_WIDTH + inset
        const maxX = HALF_WIDTH - inset
        const innerBackZ = BACK_Z + inset
        const span = BACK_Z - FRONT_Z
        const sideZ1 = FRONT_Z + span / 3
        const sideZ2 = FRONT_Z + (2 * span) / 3

        // Walk left-front → back-left corner → across back wall → back-right
        // corner → right-front. Corners are single shared anchors so the
        // garland reads as one continuous string.
        const anchors: THREE.Vector3[] = [
            new THREE.Vector3(minX, yTop, FRONT_Z),
            new THREE.Vector3(minX, yTop, sideZ1),
            new THREE.Vector3(minX, yTop, sideZ2),
            new THREE.Vector3(minX, yTop, innerBackZ),
            new THREE.Vector3(0, yTop, innerBackZ),
            new THREE.Vector3(maxX, yTop, innerBackZ),
            new THREE.Vector3(maxX, yTop, sideZ2),
            new THREE.Vector3(maxX, yTop, sideZ1),
            new THREE.Vector3(maxX, yTop, FRONT_Z),
        ]

        for (let i = 0; i < anchors.length - 1; i++) {
            addBunting(this.group, anchors[i], anchors[i + 1], flagsPerSwag, sag)
        }
    }

    private addCornerLights(housingMat: THREE.Material, bulbMat: THREE.Material): void {
        // Four flared spotlight fixtures mounted at the inside top corners,
        // all aimed at a shared point near the booth's interior center so the
        // beams cross-illuminate the targets.
        const insetX = 0.4
        const insetZ = 0.4
        const dropY = 0.4
        const aim = new THREE.Vector3(0, 1.2, (FRONT_Z + BACK_Z) / 2)

        const sharedTarget = new THREE.Object3D()
        sharedTarget.position.copy(aim)
        this.group.add(sharedTarget)

        const housingGeo = new THREE.CylinderGeometry(0.05, 0.11, 0.18, 12)
        const bulbGeo = new THREE.SphereGeometry(0.07, 12, 8)

        const corners: [number, number][] = [
            [-HALF_WIDTH + insetX, FRONT_Z - insetZ],
            [HALF_WIDTH - insetX, FRONT_Z - insetZ],
            [-HALF_WIDTH + insetX, BACK_Z + insetZ],
            [HALF_WIDTH - insetX, BACK_Z + insetZ],
        ]

        for (const [x, z] of corners) {
            const fixture = new THREE.Group()
            fixture.position.set(x, ROOF_Y - dropY, z)
            // After lookAt, fixture-local -Z points at `aim`.
            fixture.lookAt(aim)

            // rotation.x = π/2 maps the cylinder's wide -Y end to fixture-local -Z,
            // so the flared opening faces the target.
            const housing = new THREE.Mesh(housingGeo, housingMat)
            housing.rotation.x = Math.PI / 2
            housing.position.z = -0.09
            housing.castShadow = true
            fixture.add(housing)

            const bulb = new THREE.Mesh(bulbGeo, bulbMat)
            bulb.position.z = -0.16
            fixture.add(bulb)

            this.group.add(fixture)

            // SpotLight is a sibling rather than a child so its target reference
            // doesn't fight the fixture's lookAt orientation. Shadow casting is
            // off — the directional sun already provides the scene's shadows.
            const spot = new THREE.SpotLight(0xffe4a0, 8, 22, Math.PI / 5, 0.5, 1.0)
            spot.position.set(x, ROOF_Y - dropY, z)
            spot.target = sharedTarget
            this.group.add(spot)
        }
    }

    private addAllBunting(): void {
        // Front swag across the booth opening.
        addBunting(
            this.group,
            new THREE.Vector3(-HALF_WIDTH, ROOF_Y + 0.1, FRONT_Z),
            new THREE.Vector3(HALF_WIDTH, ROOF_Y + 0.1, FRONT_Z),
            14,
            0.45,
        )
        // A second swag from each front flagpole down to the back corner of the booth,
        // giving the canopy a festooned silhouette from the side.
        addBunting(
            this.group,
            new THREE.Vector3(-HALF_WIDTH, ROOF_Y + FLAGPOLE_HEIGHT - 0.2, FRONT_Z),
            new THREE.Vector3(-HALF_WIDTH, ROOF_Y + 0.1, BACK_Z),
            16,
            0.6,
        )
        addBunting(
            this.group,
            new THREE.Vector3(HALF_WIDTH, ROOF_Y + FLAGPOLE_HEIGHT - 0.2, FRONT_Z),
            new THREE.Vector3(HALF_WIDTH, ROOF_Y + 0.1, BACK_Z),
            16,
            0.6,
        )
    }

    dispose(): void {
        this.group.traverse((obj) => {
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
    }
}

function makePennant(color: number): THREE.Mesh {
    const shape = new THREE.Shape()
    shape.moveTo(0, 0.18)
    shape.lineTo(0, -0.18)
    shape.lineTo(0.55, 0)
    shape.closePath()
    const geo = new THREE.ShapeGeometry(shape)
    const mat = new THREE.MeshStandardMaterial({
        color,
        side: THREE.DoubleSide,
        roughness: 0.8,
    })
    return new THREE.Mesh(geo, mat)
}

/**
 * Hang a string of triangular pennant flags between two points, with a parabolic sag.
 * The string itself is drawn as a thin Line; flags are flat triangles whose
 * triangular plane is rotated about Y to remain broadside to the string direction.
 */
function addBunting(
    parent: THREE.Group,
    a: THREE.Vector3,
    b: THREE.Vector3,
    flagCount: number,
    sag: number,
): void {
    const segs = flagCount + 1
    const points: THREE.Vector3[] = []
    for (let i = 0; i <= segs; i++) {
        const t = i / segs
        const p = a.clone().lerp(b, t)
        // Parabolic sag using sin(πt) — peaks halfway between endpoints.
        p.y -= Math.sin(Math.PI * t) * sag
        points.push(p)
    }

    const lineGeo = new THREE.BufferGeometry().setFromPoints(points)
    const line = new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({ color: 0x222222 }),
    )
    parent.add(line)

    // Orient each flag so its plane faces perpendicular to the string's XZ direction.
    const span = b.clone().sub(a)
    span.y = 0
    if (span.lengthSq() > 1e-6) span.normalize()
    const flagAngleY = Math.atan2(-span.z, span.x)

    const flagW = 0.15
    const flagH = 0.22
    for (let i = 1; i < points.length - 1; i++) {
        const shape = new THREE.Shape()
        shape.moveTo(-flagW / 2, 0)
        shape.lineTo(flagW / 2, 0)
        shape.lineTo(0, -flagH)
        shape.closePath()
        const geo = new THREE.ShapeGeometry(shape)
        const mat = new THREE.MeshStandardMaterial({
            color: BUNTING_COLORS[(i - 1) % BUNTING_COLORS.length],
            side: THREE.DoubleSide,
            roughness: 0.85,
        })
        const flag = new THREE.Mesh(geo, mat)
        flag.position.copy(points[i])
        flag.rotation.y = flagAngleY
        parent.add(flag)
    }
}
