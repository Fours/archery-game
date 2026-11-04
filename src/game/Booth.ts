import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createAwningTexture, createFabricTexture, createGrimyPanelTexture, createGrimyRailTexture, createWoodTexture, setWorldUVs } from './materials'

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
// Upper face of the rail. Kept where the original 7 cm slab put it so the
// bow/counter clearance invariant (see CLAUDE.md) is unchanged.
const COUNTER_SURFACE_Y = COUNTER_TOP_Y + 0.035
const COUNTER_DEPTH = 0.55
const COUNTER_TOP_THICK = 0.1
// Counter top overhangs the front panel toward the player (flush with the
// front posts) so its rounded front edge reads as a chunky bar top.
const COUNTER_LIP = 0.1
// Cove molding tucked under the lip, against the front panel.
const COUNTER_MOLDING = 0.035

// Bevel radii: no edge in a cartoon world should be razor sharp.
const POST_BEVEL = 0.035
const COUNTER_BEVEL = 0.04
const VALANCE_THICK = 0.03
const VALANCE_BEVEL = 0.008
const ROPE_RADIUS = 0.008
const ROPE_COLOR = 0x4a3826

const VALANCE_HEIGHT = 0.75
const VALANCE_STRIPES = 24

const FLAGPOLE_HEIGHT = 2.5

const RED = 0xc8332c
const WHITE = 0xf2efe6
const BLUE = 0x2b4f8c
const YELLOW = 0xf0d447
const WOOD = 0x8f5c34
const DARK_WOOD = 0x5c3a1f
// Varnished hardwood for the counter rail: warmer and richer than the walls.
const RAIL_WOOD = 0xa86a3c

const BUNTING_COLORS = [RED, WHITE, BLUE, YELLOW]

/**
 * A 19th-century-style fairground booth. The player stands just outside the
 * front edge (at world z ≈ 0); targets live inside between FRONT_Z and BACK_Z.
 * All decorative geometry is added under `group`; dispose() frees everything.
 */
export class Booth {
    readonly group: THREE.Group
    private woodTex: THREE.Texture
    private fabricTex: THREE.Texture
    private awningTex: THREE.Texture | null = null
    // Grimy counter textures, fitted per surface; built in addCounter.
    private railGrimeTex: THREE.Texture | null = null
    private panelGrimeTex: THREE.Texture | null = null

    constructor() {
        this.group = new THREE.Group()

        // Both textures are near-white tint masks shared by the light/dark
        // variants; box geometries get world-meter UVs so density stays uniform.
        this.woodTex = createWoodTexture()
        this.fabricTex = createFabricTexture()

        const woodMat = new THREE.MeshStandardMaterial({
            color: WOOD,
            map: this.woodTex,
            roughness: 0.85,
        })
        const darkWoodMat = new THREE.MeshStandardMaterial({
            color: DARK_WOOD,
            map: this.woodTex,
            roughness: 0.85,
        })
        const redMat = new THREE.MeshStandardMaterial({
            color: RED,
            map: this.fabricTex,
            roughness: 0.9,
        })
        const whiteMat = new THREE.MeshStandardMaterial({
            color: WHITE,
            map: this.fabricTex,
            roughness: 0.9,
        })
        const housingMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.45,
            metalness: 0.7,
        })
        const bulbMat = new THREE.MeshStandardMaterial({
            color: 0xfff2cc,
            emissive: 0xffd97a,
            emissiveIntensity: 3.5,
            roughness: 0.4,
        })

        this.addPosts(darkWoodMat)
        this.addWalls(woodMat)
        this.addCounter(darkWoodMat)
        this.addRoof()
        this.addValance(redMat, whiteMat)
        this.addFlagpoles(darkWoodMat)
        this.addAllBunting()
        this.addInteriorBunting()
        this.addCornerLights(housingMat, bulbMat)
    }

    private addPosts(mat: THREE.Material): void {
        const geo = new RoundedBoxGeometry(POST_THICK, ROOF_Y, POST_THICK, 3, POST_BEVEL)
        setWorldUVs(geo)
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
        setWorldUVs(sideGeo)
        for (const x of [-HALF_WIDTH, HALF_WIDTH]) {
            const wall = new THREE.Mesh(sideGeo, mat)
            wall.position.set(x, WALL_HEIGHT / 2, (FRONT_Z + BACK_Z) / 2)
            wall.castShadow = true
            wall.receiveShadow = true
            this.group.add(wall)
        }
        const backGeo = new THREE.BoxGeometry(HALF_WIDTH * 2 - POST_THICK, WALL_HEIGHT, WALL_THICK)
        setWorldUVs(backGeo)
        const back = new THREE.Mesh(backGeo, mat)
        back.position.set(0, WALL_HEIGHT / 2, BACK_Z)
        back.receiveShadow = true
        this.group.add(back)
    }

    private addCounter(darkMat: THREE.Material): void {
        const innerWidth = HALF_WIDTH * 2 - POST_THICK

        // A single thick board spanning post to post. setWorldUVs maps U to X
        // on its top and front faces, so the board texture's grain runs left/right.
        const topDepth = COUNTER_DEPTH + COUNTER_LIP

        // The rail top and front panel are the surfaces the player stares at, so
        // they get their own non-tiling grimy masks fitted to each surface (dirt
        // at real positions, no repeat) instead of the showroom-clean wood. The
        // rail keeps only a trace of clearcoat so the varnish reads worn.
        this.railGrimeTex = createGrimyRailTexture(innerWidth, topDepth)
        this.panelGrimeTex = createGrimyPanelTexture(innerWidth, COUNTER_TOP_Y)
        const railMat = new THREE.MeshPhysicalMaterial({
            color: RAIL_WOOD,
            map: this.railGrimeTex,
            roughness: 0.74,
            clearcoat: 0.08,
            clearcoatRoughness: 0.7,
        })
        const panelMat = new THREE.MeshStandardMaterial({
            color: DARK_WOOD,
            map: this.panelGrimeTex,
            roughness: 0.9,
        })

        const topGeo = new RoundedBoxGeometry(
            innerWidth,
            COUNTER_TOP_THICK,
            topDepth,
            4,
            COUNTER_BEVEL,
        )
        setWorldUVs(topGeo)
        const top = new THREE.Mesh(topGeo, railMat)
        top.position.set(
            0,
            COUNTER_SURFACE_Y - COUNTER_TOP_THICK / 2,
            FRONT_Z + COUNTER_LIP - topDepth / 2,
        )
        top.castShadow = true
        top.receiveShadow = true
        this.group.add(top)

        const panelThick = 0.05
        const frontGeo = new THREE.BoxGeometry(innerWidth, COUNTER_TOP_Y, panelThick)
        setWorldUVs(frontGeo)
        const front = new THREE.Mesh(frontGeo, panelMat)
        front.position.set(0, COUNTER_TOP_Y / 2, FRONT_Z + panelThick / 2)
        front.receiveShadow = true
        this.group.add(front)

        // Quarter-round molding in the corner under the lip, softening the step
        // from rail to panel. Profile is in (z, y) with the corner at (0, M).
        const moldingShape = new THREE.Shape()
        moldingShape.moveTo(0, 0)
        moldingShape.lineTo(0, COUNTER_MOLDING)
        moldingShape.lineTo(COUNTER_MOLDING, COUNTER_MOLDING)
        moldingShape.absarc(0, COUNTER_MOLDING, COUNTER_MOLDING, 0, -Math.PI / 2, true)
        const moldingGeo = new THREE.ExtrudeGeometry(moldingShape, {
            depth: innerWidth,
            bevelEnabled: false,
            curveSegments: 8,
        })
        // Extrusion runs along +Z; turn it to run along X (profile x → world +Z,
        // toward the player), then center it.
        moldingGeo.rotateY(-Math.PI / 2)
        moldingGeo.translate(innerWidth / 2, 0, 0)
        setWorldUVs(moldingGeo)
        const molding = new THREE.Mesh(moldingGeo, darkMat)
        molding.position.set(
            0,
            COUNTER_SURFACE_Y - COUNTER_TOP_THICK - COUNTER_MOLDING,
            FRONT_Z + panelThick,
        )
        molding.receiveShadow = true
        this.group.add(molding)
    }

    private addRoof(): void {
        // Red/white candy stripes running front-to-back, aligned with the valance below.
        const sideLen = Math.abs(BACK_Z - FRONT_Z)
        const overhang = 0.25
        const totalWidth = HALF_WIDTH * 2 + overhang
        const totalDepth = sideLen + overhang
        const centerZ = (FRONT_Z + BACK_Z) / 2
        const stripeWidth = totalWidth / VALANCE_STRIPES

        // One texture spans the whole roof (no tiling), and each stripe gets
        // its own geometry with UVs taken from its world position, so every
        // stripe shows a different slice of it.
        this.awningTex = createAwningTexture(totalWidth, totalDepth, centerZ - totalDepth / 2)
        const redMat = new THREE.MeshStandardMaterial({ color: RED, map: this.awningTex, roughness: 0.9 })
        const whiteMat = new THREE.MeshStandardMaterial({ color: WHITE, map: this.awningTex, roughness: 0.9 })

        for (let i = 0; i < VALANCE_STRIPES; i++) {
            const x = -totalWidth / 2 + (i + 0.5) * stripeWidth
            const stripeGeo = new THREE.BoxGeometry(stripeWidth, 0.08, totalDepth)
            stripeGeo.translate(x, 0, centerZ)
            setWorldUVs(stripeGeo)
            stripeGeo.translate(-x, 0, -centerZ)
            const stripe = new THREE.Mesh(stripeGeo, i % 2 === 0 ? redMat : whiteMat)
            stripe.position.set(x, ROOF_Y, centerZ)
            stripe.castShadow = true
            stripe.receiveShadow = true
            this.group.add(stripe)
        }
    }

    private addValance(redMat: THREE.Material, whiteMat: THREE.Material): void {
        // Vertical red/white candy stripes hanging from the front roof edge, each
        // ending in a half-round scallop. Shape origin is the stripe's top center.
        const overhang = 0.25
        const totalWidth = HALF_WIDTH * 2 + overhang
        const stripeWidth = totalWidth / VALANCE_STRIPES
        const r = stripeWidth / 2
        const shape = new THREE.Shape()
        shape.moveTo(-r, 0)
        shape.lineTo(r, 0)
        shape.lineTo(r, -(VALANCE_HEIGHT - r))
        shape.absarc(0, -(VALANCE_HEIGHT - r), r, 0, Math.PI, true)
        shape.closePath()
        const stripeGeo = new THREE.ExtrudeGeometry(shape, {
            depth: VALANCE_THICK,
            bevelEnabled: true,
            bevelThickness: VALANCE_BEVEL,
            bevelSize: VALANCE_BEVEL,
            bevelSegments: 2,
            curveSegments: 12,
        })
        stripeGeo.translate(0, 0, -VALANCE_THICK / 2)
        setWorldUVs(stripeGeo)
        for (let i = 0; i < VALANCE_STRIPES; i++) {
            const x = -totalWidth / 2 + (i + 0.5) * stripeWidth
            const stripe = new THREE.Mesh(stripeGeo, i % 2 === 0 ? redMat : whiteMat)
            stripe.position.set(x, ROOF_Y - 0.04, FRONT_Z + 0.04)
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
            const spot = new THREE.SpotLight(0xffe4a0, 12, 24, Math.PI / 4.5, 0.6, 1.0)
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
        // Material.dispose() doesn't free maps, so release the shared textures here.
        this.woodTex.dispose()
        this.fabricTex.dispose()
        this.awningTex?.dispose()
        this.railGrimeTex?.dispose()
        this.panelGrimeTex?.dispose()
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

    // Twine rope: a thin tube through the flag points rather than a 1 px Line,
    // so it has real thickness, catches light, and shows up in AO.
    const ropeGeo = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points),
        segs * 6,
        ROPE_RADIUS,
        5,
        false,
    )
    const rope = new THREE.Mesh(
        ropeGeo,
        new THREE.MeshStandardMaterial({ color: ROPE_COLOR, roughness: 0.95 }),
    )
    parent.add(rope)

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
