import * as THREE from 'three'
import * as synth from './synth'

// Mixer levels (linear gain). Buffers are peak-normalized, so these set loudness.
const MASTER_GAIN = 0.8
const LEVEL = {
    nock: 0.22,
    twang: 0.6,
    whoosh: 0.35,
    targetThunk: 0.9,
    burst: 0.5,
    chime: 0.32,
    groundThud: 0.75,
    disabled: 0.3,
    tick: 0.28,
    roundOver: 0.3,
    chirp: 0.12,
    creak: 0.22,
}
// Per-play variation so repeated sounds don't sound machine-gunned.
const PITCH_JITTER = 0.05 // ± fraction of playbackRate
const GAIN_JITTER = 0.15 // ± fraction of gain
// Distance falloff for positional one-shots (PannerNode 'inverse' model).
const REF_DISTANCE = 3
const ROLLOFF = 0.5
// Wind bed: low rumble + leaf rustle, both swelling with the ground gust.
const WIND_RUMBLE_GAIN = [0.012, 0.055] // [calm, gust]
const WIND_RUSTLE_GAIN = [0.0, 0.012]
const WIND_CUTOFF_HZ = [260, 700]
// Seconds between bird phrases.
const BIRD_INTERVAL = [1.5, 6]
// Score band → semitones above the chime's base pitch (A5).
const BAND_SEMITONES: Record<number, number> = { 10: 0, 25: 3, 50: 7, 100: 12 }
const ARPEGGIO = [0, 4, 7] // extra notes added per multiplier step
const MUTE_KEY = 'archery-blitz-muted'

type OneShot = keyof typeof SOUND_FILLS
type PlayOptions = {
    gain?: number
    rate?: number
    /** World position; enables 3D panning + distance falloff. */
    at?: THREE.Vector3
    rolloff?: number
    /** Stereo pan (−1..1) for non-positional sounds. */
    pan?: number
    /** Seconds from now. */
    delay?: number
    jitter?: boolean
}

// Each entry is a list of variants; one is picked at random per play.
const SOUND_FILLS = {
    nock: [{ seconds: 0.06, fill: synth.nock }],
    twang: [
        { seconds: 0.9, fill: synth.twang(92) },
        { seconds: 0.9, fill: synth.twang(98) },
    ],
    whoosh: [{ seconds: 0.6, fill: synth.whoosh }],
    targetThunk: [
        { seconds: 0.35, fill: synth.targetThunk },
        { seconds: 0.35, fill: synth.targetThunk },
        { seconds: 0.35, fill: synth.targetThunk },
    ],
    burst: [{ seconds: 0.7, fill: synth.burst }],
    chime: [{ seconds: 1.4, fill: synth.chime }],
    groundThud: [
        { seconds: 0.3, fill: synth.groundThud },
        { seconds: 0.3, fill: synth.groundThud },
    ],
    disabled: [{ seconds: 0.55, fill: synth.disabled }],
    tick: [{ seconds: 0.09, fill: synth.tick }],
    chirp: [synth.chirp(), synth.chirp(), synth.chirp(), synth.chirp(), synth.chirp()],
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)
const lerp = (range: number[], u: number) => range[0] + (range[1] - range[0]) * u

/**
 * All game audio, on one Web Audio graph:
 *   one-shots → sfx bus ┐
 *   wind, birds → ambience bus ┼→ master → compressor → speakers
 *   draw creak → sfx bus ┘
 * Sounds are synthesized into buffers at construction (see synth.ts). The
 * context starts suspended until `unlock()` runs inside a user gesture.
 */
export class AudioManager {
    private ctx: AudioContext
    private master: GainNode
    private sfx: GainNode
    private ambience: GainNode
    private buffers: Record<OneShot, AudioBuffer[]>

    private creakGain: GainNode
    private creakSource: AudioBufferSourceNode
    private windRumbleGain: GainNode
    private windRumbleFilter: BiquadFilterNode
    private windRustleGain: GainNode
    private loops: AudioBufferSourceNode[] = []

    private birdTimer = rand(BIRD_INTERVAL[0], BIRD_INTERVAL[1])
    private lastDraw = 0
    private _muted: boolean

    private forward = new THREE.Vector3()
    private up = new THREE.Vector3()
    private pos = new THREE.Vector3()

    constructor() {
        this.ctx = new AudioContext({ latencyHint: 'interactive' })
        this._muted = readMuted()

        const compressor = this.ctx.createDynamicsCompressor()
        compressor.threshold.value = -14
        compressor.knee.value = 10
        compressor.ratio.value = 4
        compressor.attack.value = 0.003
        compressor.release.value = 0.2
        compressor.connect(this.ctx.destination)

        this.master = this.ctx.createGain()
        this.master.gain.value = this._muted ? 0 : MASTER_GAIN
        this.master.connect(compressor)
        this.sfx = this.ctx.createGain()
        this.sfx.connect(this.master)
        this.ambience = this.ctx.createGain()
        this.ambience.connect(this.master)

        const buffers = {} as Record<OneShot, AudioBuffer[]>
        for (const name of Object.keys(SOUND_FILLS) as OneShot[]) {
            buffers[name] = SOUND_FILLS[name].map((v) => synth.render(this.ctx, v.seconds, v.fill))
        }
        this.buffers = buffers

        // Draw creak: a looping stick-slip buffer whose gain follows the draw.
        this.creakGain = this.ctx.createGain()
        this.creakGain.gain.value = 0
        this.creakGain.connect(this.sfx)
        this.creakSource = this.startLoop(synth.render(this.ctx, 1.6, synth.creak), this.creakGain)

        // Wind: the same white-noise loop feeds a low rumble and a high rustle.
        const noise = synth.render(this.ctx, 4, synth.whiteNoise, false)
        this.windRumbleFilter = this.ctx.createBiquadFilter()
        this.windRumbleFilter.type = 'lowpass'
        this.windRumbleFilter.Q.value = 0.5
        const rumbleShelf = this.ctx.createBiquadFilter()
        rumbleShelf.type = 'lowpass'
        rumbleShelf.frequency.value = 900
        this.windRumbleGain = this.ctx.createGain()
        this.windRumbleGain.gain.value = 0
        this.windRumbleFilter.connect(rumbleShelf).connect(this.windRumbleGain).connect(this.ambience)
        this.startLoop(noise, this.windRumbleFilter)

        const rustleFilter = this.ctx.createBiquadFilter()
        rustleFilter.type = 'bandpass'
        rustleFilter.frequency.value = 3200
        rustleFilter.Q.value = 0.8
        this.windRustleGain = this.ctx.createGain()
        this.windRustleGain.gain.value = 0
        rustleFilter.connect(this.windRustleGain).connect(this.ambience)
        // Offset start so rumble and rustle aren't the same samples.
        this.startLoop(noise, rustleFilter, 2)
    }

    get muted(): boolean {
        return this._muted
    }

    /** Resume the context. Browsers only allow this inside a user gesture (click / key). */
    unlock(): void {
        if (this.ctx.state === 'suspended') void this.ctx.resume()
    }

    toggleMute(): boolean {
        this._muted = !this._muted
        try {
            localStorage.setItem(MUTE_KEY, this._muted ? '1' : '0')
        } catch {
            // Storage blocked (private mode etc.) — mute still works for this session.
        }
        this.master.gain.setTargetAtTime(this._muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.02)
        return this._muted
    }

    /** Called every frame. Moves the listener with the camera and drives ambience. */
    update(dt: number, camera: THREE.Camera, windGust: number): void {
        const l = this.ctx.listener
        camera.getWorldPosition(this.pos)
        camera.getWorldDirection(this.forward)
        this.up.set(0, 1, 0).applyQuaternion(camera.quaternion)
        if (l.positionX) {
            l.positionX.value = this.pos.x
            l.positionY.value = this.pos.y
            l.positionZ.value = this.pos.z
            l.forwardX.value = this.forward.x
            l.forwardY.value = this.forward.y
            l.forwardZ.value = this.forward.z
            l.upX.value = this.up.x
            l.upY.value = this.up.y
            l.upZ.value = this.up.z
        } else {
            // Older Safari only has the deprecated setters.
            l.setPosition(this.pos.x, this.pos.y, this.pos.z)
            l.setOrientation(this.forward.x, this.forward.y, this.forward.z, this.up.x, this.up.y, this.up.z)
        }

        const now = this.ctx.currentTime
        const g = THREE.MathUtils.clamp((windGust - 0.1) / 0.9, 0, 1)
        this.windRumbleGain.gain.setTargetAtTime(lerp(WIND_RUMBLE_GAIN, g), now, 0.3)
        this.windRumbleFilter.frequency.setTargetAtTime(lerp(WIND_CUTOFF_HZ, g), now, 0.3)
        this.windRustleGain.gain.setTargetAtTime(lerp(WIND_RUSTLE_GAIN, g * g), now, 0.3)

        if (this.ctx.state !== 'running') return
        this.birdTimer -= dt
        if (this.birdTimer <= 0) {
            this.birdTimer = rand(BIRD_INTERVAL[0], BIRD_INTERVAL[1])
            this.playBird()
        }
    }

    /** Draw amount 0..1 each frame; creaks only while the limbs are actually moving. */
    setDraw(amount: number): void {
        const moving = amount > this.lastDraw + 1e-4
        this.lastDraw = amount
        const now = this.ctx.currentTime
        const target = moving ? LEVEL.creak * (0.4 + 0.6 * amount) : 0
        this.creakGain.gain.setTargetAtTime(target, now, moving ? 0.04 : 0.015)
        this.creakSource.playbackRate.setTargetAtTime(0.85 + 0.35 * amount, now, 0.05)
    }

    drawStart(): void {
        this.play('nock', { gain: LEVEL.nock, pan: 0.25 })
    }

    release(strength: number): void {
        this.lastDraw = 0
        this.creakGain.gain.cancelScheduledValues(this.ctx.currentTime)
        this.creakGain.gain.setValueAtTime(0, this.ctx.currentTime)
        this.play('twang', { gain: LEVEL.twang * (0.4 + 0.6 * strength), rate: 0.95 + 0.1 * strength, pan: 0.25 })
        this.play('whoosh', { gain: LEVEL.whoosh * (0.3 + 0.7 * strength), rate: 0.85 + 0.3 * strength, delay: 0.02 })
    }

    targetHit(at: THREE.Vector3, score: number, multiplier: number, disabled: boolean): void {
        this.play('targetThunk', { gain: LEVEL.targetThunk, at })
        this.play('burst', { gain: LEVEL.burst, at, delay: 0.03 })
        const base = BAND_SEMITONES[score] ?? 0
        for (let i = 0; i < Math.min(multiplier, ARPEGGIO.length); i++) {
            this.play('chime', {
                gain: LEVEL.chime,
                rate: 2 ** ((base + ARPEGGIO[i]) / 12),
                at,
                rolloff: 0.1,
                delay: 0.05 + i * 0.08,
                jitter: false,
            })
        }
        if (disabled) this.play('disabled', { gain: LEVEL.disabled, at, rolloff: 0.1, delay: 0.35, jitter: false })
    }

    groundHit(at: THREE.Vector3): void {
        this.play('groundThud', { gain: LEVEL.groundThud, at })
    }

    /** Countdown tick; the last five seconds are higher and louder. */
    tick(secondsLeft: number): void {
        const final = secondsLeft <= 5
        this.play('tick', { gain: LEVEL.tick * (final ? 1.5 : 1), rate: final ? 1.26 : 1, jitter: false })
    }

    roundOver(): void {
        this.lastDraw = 0
        this.creakGain.gain.setValueAtTime(0, this.ctx.currentTime)
        // Rising C-major-ish arpeggio on the chime, last note held a little louder.
        const notes = [-9, -5, -2, 3]
        notes.forEach((semi, i) => {
            const last = i === notes.length - 1
            this.play('chime', {
                gain: LEVEL.roundOver * (last ? 1.3 : 1),
                rate: 2 ** (semi / 12),
                delay: 0.1 + i * 0.13,
                jitter: false,
            })
        })
    }

    dispose(): void {
        for (const src of this.loops) {
            try {
                src.stop()
            } catch {
                // Already stopped.
            }
        }
        this.loops = []
        void this.ctx.close()
    }

    private playBird(): void {
        const angle = rand(-Math.PI, Math.PI)
        const dist = rand(15, 40)
        const at = new THREE.Vector3(Math.sin(angle) * dist, rand(5, 12), -Math.cos(angle) * dist)
        const gain = LEVEL.chirp * rand(0.5, 1.2)
        // Sometimes a bird repeats its phrase.
        const repeats = Math.random() < 0.35 ? 2 : 1
        const variant = Math.floor(Math.random() * this.buffers.chirp.length)
        for (let i = 0; i < repeats; i++) {
            this.play('chirp', { gain, at, rolloff: 0.3, delay: i * rand(0.5, 0.8), variant, bus: this.ambience })
        }
    }

    private play(name: OneShot, opts: PlayOptions & { variant?: number; bus?: AudioNode } = {}): void {
        if (this.ctx.state !== 'running') return
        const variants = this.buffers[name]
        const buffer = variants[opts.variant ?? Math.floor(Math.random() * variants.length)]
        const jitter = opts.jitter ?? true

        const src = this.ctx.createBufferSource()
        src.buffer = buffer
        src.playbackRate.value = (opts.rate ?? 1) * (jitter ? 1 + rand(-PITCH_JITTER, PITCH_JITTER) : 1)

        const gain = this.ctx.createGain()
        gain.gain.value = (opts.gain ?? 1) * (jitter ? 1 + rand(-GAIN_JITTER, GAIN_JITTER) : 1)
        src.connect(gain)

        let out: AudioNode = gain
        if (opts.at) {
            const panner = this.ctx.createPanner()
            panner.panningModel = 'equalpower'
            panner.distanceModel = 'inverse'
            panner.refDistance = REF_DISTANCE
            panner.rolloffFactor = opts.rolloff ?? ROLLOFF
            panner.positionX.value = opts.at.x
            panner.positionY.value = opts.at.y
            panner.positionZ.value = opts.at.z
            out = out.connect(panner)
        } else if (opts.pan) {
            const panner = this.ctx.createStereoPanner()
            panner.pan.value = opts.pan
            out = out.connect(panner)
        }
        out.connect(opts.bus ?? this.sfx)
        src.start(this.ctx.currentTime + (opts.delay ?? 0))
    }

    private startLoop(buffer: AudioBuffer, destination: AudioNode, offset = 0): AudioBufferSourceNode {
        const src = this.ctx.createBufferSource()
        src.buffer = buffer
        src.loop = true
        src.connect(destination)
        src.start(0, offset)
        this.loops.push(src)
        return src
    }
}

function readMuted(): boolean {
    try {
        return localStorage.getItem(MUTE_KEY) === '1'
    } catch {
        return false
    }
}
