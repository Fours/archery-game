import * as THREE from 'three'

// Shared wind for everything that sways: trees, grass and flowers all read the
// same clock (owned by World) and push the same way, so gusts look like one
// wind moving through the clearing.
export const WIND_DIRECTION = new THREE.Vector2(1, 0.4).normalize() // world XZ

// Trees: slow whole-crown sway, phase offset by position so the forest doesn't
// sway in lockstep; a slow gust term swells and eases the motion.
const TREE_SWAY_SPEED = 0.9 // rad/s
const TREE_GUST_SPEED = 0.23 // rad/s
const FLUTTER_SPEED = 5.0 // rad/s

// Ground cover: quicker sway whose phase travels downwind, plus a slower gust
// envelope that also travels, so brighter "waves" roll across the meadow.
const GROUND_SWAY_SPEED = 2.1 // rad/s
const GROUND_SWAY_WAVENUMBER = 0.45 // rad per meter along the wind
const GROUND_GUST_SPEED = 0.7 // rad/s
const GROUND_GUST_WAVENUMBER = 0.12 // rad per meter along the wind

export type WindTime = { value: number }

export type WindProfile =
    | {
          kind: 'tree'
          /** Meters above the base (before scale) where bending starts. */
          swayStart: number
          /** World meters of sway per m² of height above swayStart. */
          swayAmount: number
          /** Leaf-card flutter along the normal, meters before scale. */
          flutter?: number
      }
    | {
          kind: 'ground'
          /** Local height (before scale) at which the bend reaches `amount`. */
          height: number
          /** Sway at `height`, in meters before instance scale. */
          amount: number
      }

const f = (x: number) => x.toFixed(4)

/** Vertex GLSL that displaces `transformed` (object-local) by the wind. */
function windGlsl(p: WindProfile): string {
    const bend =
        p.kind === 'tree'
            ? /* glsl */ `
        vec3 origin = windModel[3].xyz;
        float phase = dot(origin.xz, vec2(0.37, 0.23));
        float gust = 0.6 + 0.4 * sin(uWindTime * ${f(TREE_GUST_SPEED)} + phase * 0.5);
        float h = max(transformed.y - ${f(p.swayStart)}, 0.0);
        float bend = h * h * ${f(p.swayAmount)} * gust;
        float s = sin(uWindTime * ${f(TREE_SWAY_SPEED)} + phase)
            + 0.35 * sin(uWindTime * ${f(TREE_SWAY_SPEED * 2.3)} + phase * 1.7);
        float cross = 0.3 * sin(uWindTime * ${f(TREE_SWAY_SPEED * 0.7)} + phase * 2.1);`
            : /* glsl */ `
        vec3 origin = windModel[3].xyz;
        float along = dot(origin.xz, wind);
        float jitter = fract(sin(dot(origin.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float gust = 0.55 + 0.45 * sin(uWindTime * ${f(GROUND_GUST_SPEED)} - along * ${f(GROUND_GUST_WAVENUMBER)});
        float h = max(transformed.y, 0.0) / ${f(p.height)};
        float bend = h * h * ${f(p.amount)} * gust;
        float s = sin(uWindTime * ${f(GROUND_SWAY_SPEED)} - along * ${f(GROUND_SWAY_WAVENUMBER)} + jitter * 1.5)
            + 0.3 * sin(uWindTime * ${f(GROUND_SWAY_SPEED * 2.7)} + jitter * 6.283);
        float cross = 0.25 * sin(uWindTime * ${f(GROUND_SWAY_SPEED * 0.9)} + jitter * 6.283);`
    const flutter =
        p.kind === 'tree' && p.flutter
            ? /* glsl */ `
        transformed += normal * ${f(p.flutter)} * gust
            * sin(uWindTime * ${f(FLUTTER_SPEED)} + dot(position, vec3(3.1, 2.3, 4.7)));`
            : ''
    return /* glsl */ `
    {
        #ifdef USE_INSTANCING
        mat4 windModel = modelMatrix * instanceMatrix;
        #else
        mat4 windModel = modelMatrix;
        #endif
        vec2 wind = vec2(${f(WIND_DIRECTION.x)}, ${f(WIND_DIRECTION.y)});
        ${bend}
        // Leans downwind on average, with a little cross-wind wobble.
        vec2 push = wind * (0.5 + s) + vec2(-wind.y, wind.x) * cross;
        // World push into object-local space: transpose(mat3(model)) is
        // scale * R^T, so dividing by scale leaves R^T, and the model matrix
        // scales it back up — scaled-up objects sway proportionally.
        mat3 m = mat3(windModel);
        transformed += transpose(m) * vec3(push.x, 0.0, push.y) * (bend / length(m[0]));
        ${flutter}
    }`
}

/**
 * Chain the wind displacement onto a material's existing onBeforeCompile
 * (rim light etc.), so apply it after addRimLight. Works for plain meshes and
 * InstancedMeshes. Use it on shadow-depth materials too so shadows move.
 */
export function addWind<T extends THREE.Material>(material: T, time: WindTime, profile: WindProfile): T {
    const previous = material.onBeforeCompile
    material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer)
        shader.uniforms.uWindTime = time
        shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>\n${windGlsl(profile)}`,
        )
    }
    const previousKey = material.customProgramCacheKey.bind(material)
    material.customProgramCacheKey = () => `${previousKey()}-wind-${JSON.stringify(profile)}`
    return material
}

/** CPU mirror of the ground-cover gust envelope (0.1..1) at a world XZ point,
 *  so ambience can swell in step with the grass waves. */
export function groundGustAt(time: number, x = 0, z = 0): number {
    const along = x * WIND_DIRECTION.x + z * WIND_DIRECTION.y
    return 0.55 + 0.45 * Math.sin(time * GROUND_GUST_SPEED - along * GROUND_GUST_WAVENUMBER)
}
