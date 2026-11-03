import * as THREE from 'three'

// Sky palette (sRGB hex). Horizon doubles as the fog color so distant scenery
// melts into the haze instead of ending at a hard line.
export const SKY_ZENITH = 0x3f86d6
export const SKY_HORIZON = 0xf6e2c0
const SKY_GROUND = 0x5d6b3a

const DOME_RADIUS = 450

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
varying vec3 vDir;
void main() {
    float y = normalize(vDir).y;
    // Warm haze hugs the horizon, deepening to saturated blue overhead.
    vec3 col = y >= 0.0
        ? mix(horizon, zenith, pow(smoothstep(0.0, 0.85, y), 0.6))
        : mix(horizon, ground, smoothstep(0.0, 0.12, -y));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`

function makeDome(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            zenith: { value: new THREE.Color(SKY_ZENITH) },
            horizon: { value: new THREE.Color(SKY_HORIZON) },
            ground: { value: new THREE.Color(SKY_GROUND) },
        },
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
    })
    const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 32, 16), mat)
    dome.renderOrder = -1
    dome.frustumCulled = false
    return dome
}

/**
 * Gradient sky dome plus a matching prefiltered environment map. The env map
 * gives every PBR material soft sky-colored ambient + reflections, which is
 * what makes the booth interior read as "lit" even where the sun can't reach.
 */
export class Sky {
    readonly group: THREE.Group
    readonly environment: THREE.Texture
    private dome: THREE.Mesh

    constructor(renderer: THREE.WebGLRenderer) {
        this.group = new THREE.Group()
        this.dome = makeDome()
        this.group.add(this.dome)

        // Bake the env map from a throwaway scene holding its own copy of the dome.
        const envScene = new THREE.Scene()
        const envDome = makeDome()
        envScene.add(envDome)
        const pmrem = new THREE.PMREMGenerator(renderer)
        this.environment = pmrem.fromScene(envScene, 0.04).texture
        pmrem.dispose()
        envDome.geometry.dispose()
        ;(envDome.material as THREE.Material).dispose()
    }

    dispose(): void {
        this.dome.geometry.dispose()
        ;(this.dome.material as THREE.Material).dispose()
        this.environment.dispose()
    }
}
