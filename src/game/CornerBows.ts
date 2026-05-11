import * as THREE from 'three'
import { BACK_Z, HALF_WIDTH } from './Booth'
import { Bow } from './Bow'

const PROP_TILT = 0.3 // ~17° lean for the propped bow
const SCALE = 2

/**
 * One decorative bow propped beside the back-right corner barrel (added by
 * Barrels.ts at (HALF_WIDTH - 0.8, 0, BACK_Z + 0.8) = (4.2, 0, -15.2), with
 * a radius of 0.64 m at scale 2). The bow leans against the right wall just
 * forward of the barrel. Same Bow model the player carries, scaled up by
 * SCALE and instantiated at rest.
 *
 * Geometry note: the Bow's long axis is +Y with the upper tip at local
 * (0, BOW_HALF_HEIGHT, -0.06). The propped position below is derived so
 * the lower tip lands on y=0 and the upper tip touches the wall — any
 * offset that depends on the bow's geometry is multiplied by SCALE.
 */
export class CornerBows {
    readonly group: THREE.Group
    private bows: Bow[] = []

    constructor() {
        this.group = new THREE.Group()

        // Propped against the right wall, just FORWARD of the corner barrel.
        // Tilt about world Z by -PROP_TILT so +Y leans toward +X. z_g = -14.2
        // sits just in front of the barrel's forward edge (~-14.56).
        const side = new Bow()
        side.group.scale.setScalar(SCALE)
        side.group.rotation.z = -PROP_TILT
        side.group.position.set(HALF_WIDTH - 0.163 * SCALE, 0.525 * SCALE, BACK_Z + 1.8)
        this.group.add(side.group)
        this.bows.push(side)
    }

    dispose(): void {
        for (const bow of this.bows) bow.dispose()
    }
}
