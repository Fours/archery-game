import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { Pass } from 'three/addons/postprocessing/Pass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

// Ambient occlusion: contact darkening where objects meet — the single biggest
// "rendered film" cue. Radius is in world units.
const AO_RADIUS = 0.6
const AO_INTENSITY = 1.0
const AO_SAMPLES = 12
// AO is low-frequency and denoised, so computing it at half resolution is
// visually near-identical and roughly 4× cheaper — full-res GTAO at DPR 2
// dropped the game well below 60 fps.
const AO_RESOLUTION_SCALE = 0.5

// Bloom only catches true HDR highlights (bulbs, sun glints), not bright paint.
const BLOOM_STRENGTH = 0.25
const BLOOM_RADIUS = 0.2
const BLOOM_THRESHOLD = 2.0

// Final display-space grade.
const SATURATION = 1.12
const CONTRAST = 1.06
const VIGNETTE = 0.35
const LIFT = new THREE.Color(0.03, 0.02, 0.05) // cool shadows
const GAIN = new THREE.Color(1.03, 1.0, 0.95) // warm highlights

class ScaledGTAOPass extends GTAOPass {
    private hiddenSprites: THREE.Object3D[] = []

    setSize(width: number, height: number): void {
        super.setSize(
            Math.max(1, Math.floor(width * AO_RESOLUTION_SCALE)),
            Math.max(1, Math.floor(height * AO_RESOLUTION_SCALE)),
        )
    }

    // GTAOPass re-renders the scene with a normal-material override to build its
    // depth/normal buffer. It skips points and lines but not sprites, so a
    // HitEffect score sprite becomes a solid quad there and the AO pass darkens
    // it into a black box. Alpha-tested meshes (tree leaf cards) have the same
    // problem — the override drops their cutout — so they opt out by setting
    // `userData.skipAO`. Both are already in the color buffer from RenderPass,
    // so hiding them for this pass only removes them from AO.
    render(
        renderer: THREE.WebGLRenderer,
        writeBuffer: THREE.WebGLRenderTarget,
        readBuffer: THREE.WebGLRenderTarget,
        deltaTime: number,
        maskActive: boolean,
    ): void {
        this.scene.traverseVisible((obj) => {
            if ((obj as THREE.Sprite).isSprite || obj.userData.skipAO) this.hiddenSprites.push(obj)
        })
        for (const obj of this.hiddenSprites) obj.visible = false
        super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
        for (const obj of this.hiddenSprites) obj.visible = true
        this.hiddenSprites.length = 0
    }
}

const GradeShader = {
    name: 'GradeShader',
    uniforms: {
        tDiffuse: { value: null },
        saturation: { value: SATURATION },
        contrast: { value: CONTRAST },
        vignette: { value: VIGNETTE },
        lift: { value: new THREE.Vector3(LIFT.r, LIFT.g, LIFT.b) },
        gain: { value: new THREE.Vector3(GAIN.r, GAIN.g, GAIN.b) },
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float saturation;
        uniform float contrast;
        uniform float vignette;
        uniform vec3 lift;
        uniform vec3 gain;
        varying vec2 vUv;
        void main() {
            vec4 tex = texture2D(tDiffuse, vUv);
            vec3 col = tex.rgb;
            float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = mix(vec3(luma), col, saturation);
            col = (col - 0.5) * contrast + 0.5;
            col = col * gain + lift * (1.0 - col);
            float d = length(vUv - 0.5);
            col *= mix(1.0, smoothstep(0.85, 0.35, d), vignette);
            gl_FragColor = vec4(clamp(col, 0.0, 1.0), tex.a);
        }
    `,
}

/**
 * Post-processing chain: scene → GTAO → bloom → tone map + sRGB (OutputPass)
 * → color grade. Rendering goes through a 4× MSAA half-float target, so the
 * renderer's own `antialias` flag is irrelevant once this is in use.
 */
export class PostFX {
    private composer: EffectComposer
    private passes: Pass[]

    constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
        const size = renderer.getSize(new THREE.Vector2())
        const target = new THREE.WebGLRenderTarget(size.x, size.y, {
            type: THREE.HalfFloatType,
            samples: 4,
        })
        this.composer = new EffectComposer(renderer, target)
        this.composer.setPixelRatio(renderer.getPixelRatio())
        this.composer.setSize(size.x, size.y)

        const render = new RenderPass(scene, camera)

        const gtao = new ScaledGTAOPass(scene, camera, size.x, size.y)
        gtao.blendIntensity = AO_INTENSITY
        gtao.updateGtaoMaterial({
            radius: AO_RADIUS,
            distanceExponent: 1,
            thickness: 1,
            scale: 1,
            samples: AO_SAMPLES,
        })

        const bloom = new UnrealBloomPass(
            new THREE.Vector2(size.x, size.y),
            BLOOM_STRENGTH,
            BLOOM_RADIUS,
            BLOOM_THRESHOLD,
        )

        const output = new OutputPass()
        const grade = new ShaderPass(GradeShader)

        this.passes = [render, gtao, bloom, output, grade]
        for (const pass of this.passes) this.composer.addPass(pass)
    }

    render(): void {
        this.composer.render()
    }

    setSize(width: number, height: number): void {
        this.composer.setSize(width, height)
    }

    dispose(): void {
        for (const pass of this.passes) pass.dispose()
        this.composer.dispose()
    }
}
