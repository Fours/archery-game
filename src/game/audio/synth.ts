// Procedural sound effects, rendered once into AudioBuffers at startup.
//
// Every generator writes raw samples with plain math (oscillators, noise,
// a state-variable filter, Karplus-Strong), so there are no asset files and
// playback is just a cheap AudioBufferSourceNode. Buffers are peak-normalized;
// per-sound loudness is set by the mixer in AudioManager.

type Fill = (out: Float32Array, sr: number) => void

const TAU = Math.PI * 2
const PEAK = 0.9

export function render(ctx: BaseAudioContext, seconds: number, fill: Fill, normalize = true): AudioBuffer {
    const sr = ctx.sampleRate
    const buffer = ctx.createBuffer(1, Math.ceil(seconds * sr), sr)
    const data = buffer.getChannelData(0)
    fill(data, sr)
    if (normalize) {
        let peak = 0
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
        if (peak > 0) {
            const k = PEAK / peak
            for (let i = 0; i < data.length; i++) data[i] *= k
        }
    }
    fadeTail(data, sr)
    return buffer
}

/** 5 ms fade-out so a truncated decay never ends on a click. */
function fadeTail(data: Float32Array, sr: number): void {
    const n = Math.min(data.length, Math.floor(sr * 0.005))
    for (let i = 0; i < n; i++) data[data.length - 1 - i] *= i / n
}

const noise = () => Math.random() * 2 - 1
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)

/** Topology-preserving-transform state-variable filter (stable under fast cutoff sweeps). */
class SVF {
    lp = 0
    bp = 0
    hp = 0
    private ic1 = 0
    private ic2 = 0

    process(x: number, cutoff: number, q: number, sr: number): void {
        const g = Math.tan((Math.PI * Math.min(cutoff, sr * 0.45)) / sr)
        const k = 1 / q
        const a1 = 1 / (1 + g * (g + k))
        const a2 = g * a1
        const a3 = g * a2
        const v3 = x - this.ic2
        const v1 = a1 * this.ic1 + a2 * v3
        const v2 = this.ic2 + a2 * this.ic1 + a3 * v3
        this.ic1 = 2 * v1 - this.ic1
        this.ic2 = 2 * v2 - this.ic2
        this.lp = v2
        this.bp = v1
        this.hp = x - k * v1 - v2
    }
}

/** Sine whose frequency glides exponentially from f0 to f1 at `rate` (1/s). */
function glide(f0: number, f1: number, rate: number) {
    let phase = 0
    return (t: number, sr: number) => {
        const f = f1 + (f0 - f1) * Math.exp(-t * rate)
        phase += (TAU * f) / sr
        return Math.sin(phase)
    }
}

/** Arrow clicking onto the string as the draw begins. */
export const nock: Fill = (out, sr) => {
    const f = new SVF()
    for (let i = 0; i < out.length; i++) {
        const t = i / sr
        f.process(noise(), 3200, 2, sr)
        out[i] = f.bp * Math.exp(-t * 400) + 0.5 * Math.sin(TAU * 1100 * t) * Math.exp(-t * 160)
    }
}

/** Plucked bowstring (Karplus-Strong) + a low limb thump + a slap transient. */
export function twang(pitch: number): Fill {
    return (out, sr) => {
        const period = Math.round(sr / pitch)
        const line = new Float32Array(period)
        // Smoothed noise burst = a darker, thicker pluck than raw white noise.
        let prev = 0
        for (let i = 0; i < period; i++) {
            prev = 0.6 * prev + 0.4 * noise()
            line[i] = prev
        }
        const thump = glide(110, 48, 30)
        const slap = new SVF()
        let idx = 0
        for (let i = 0; i < out.length; i++) {
            const t = i / sr
            const a = line[idx]
            const b = line[(idx + 1) % period]
            line[idx] = 0.996 * 0.5 * (a + b)
            idx = (idx + 1) % period
            const string = Math.tanh(1.6 * a) * Math.exp(-t * 3.5)
            slap.process(noise(), 2200, 1.5, sr)
            out[i] =
                string +
                0.9 * thump(t, sr) * Math.exp(-t * 22) +
                0.6 * slap.bp * Math.exp(-t * 260)
        }
    }
}

/** Air rushing past as the arrow leaves: a bandpassed noise sweep falling in pitch. */
export const whoosh: Fill = (out, sr) => {
    const f = new SVF()
    const attack = 0.03
    for (let i = 0; i < out.length; i++) {
        const t = i / sr
        const env = t < attack ? t / attack : Math.exp(-(t - attack) * 6)
        f.process(noise(), 400 + 2600 * Math.exp(-t * 4), 1.3, sr)
        out[i] = f.bp * env
    }
}

/** Arrowhead punching into the wooden target: pitch-dropping body + wood modes + click. */
export const targetThunk: Fill = (out, sr) => {
    const body = glide(170, 80, 30)
    const modes = [
        { f: 440, a: 0.5, d: 40 },
        { f: 730, a: 0.35, d: 55 },
        { f: 1210, a: 0.25, d: 80 },
        { f: 1830, a: 0.15, d: 110 },
    ].map((m) => ({ ...m, f: m.f * rand(0.93, 1.07) }))
    for (let i = 0; i < out.length; i++) {
        const t = i / sr
        let s = body(t, sr) * Math.exp(-t * 20)
        for (const m of modes) s += m.a * Math.sin(TAU * m.f * t) * Math.exp(-t * m.d)
        s += 0.7 * noise() * Math.exp(-t * 600)
        out[i] = s
    }
}

/** The bullseye bursting apart: a falling low-passed noise blast with crackle. */
export const burst: Fill = (out, sr) => {
    const f = new SVF()
    const crackleF = new SVF()
    let crackle = 0
    for (let i = 0; i < out.length; i++) {
        const t = i / sr
        const env = t < 0.004 ? t / 0.004 : Math.exp(-t * 7)
        f.process(noise(), 200 + 5000 * Math.exp(-t * 9), 0.8, sr)
        if (Math.random() < 0.006 * Math.exp(-t * 5)) crackle = noise()
        crackle *= 0.93
        crackleF.process(crackle, 2500, 3, sr)
        out[i] = f.lp * env + 0.8 * crackleF.bp
    }
}

/** Bell-like score chime (inharmonic partials). Rendered at A5; vary pitch with playbackRate. */
export const chime: Fill = (out, sr) => {
    const partials = [
        { r: 1, a: 1, d: 3 },
        { r: 2.0, a: 0.45, d: 5 },
        { r: 3.0, a: 0.22, d: 7 },
        { r: 4.16, a: 0.16, d: 9 },
        { r: 5.43, a: 0.08, d: 13 },
    ]
    const base = 880
    for (let i = 0; i < out.length; i++) {
        const t = i / sr
        const attack = Math.min(1, t / 0.002)
        let s = 0
        for (const p of partials) s += p.a * Math.sin(TAU * base * p.r * t) * Math.exp(-t * p.d)
        out[i] = s * attack
    }
}
export const CHIME_BASE_HZ = 880

/** Arrow burying itself in the turf: a dull low thud with a little dirt grit. */
export const groundThud: Fill = (out, sr) => {
    const body = glide(95, 42, 25)
    const dirt = new SVF()
    const grit = new SVF()
    for (let i = 0; i < out.length; i++) {
        const t = i / sr
        const n = noise()
        dirt.process(n, 900, 0.7, sr)
        grit.process(n, 3500, 0.7, sr)
        out[i] =
            body(t, sr) * Math.exp(-t * 26) +
            0.5 * dirt.lp * Math.exp(-t * 35) +
            0.2 * grit.hp * Math.exp(-t * 70)
    }
}

/** A target used up its last hit: a short "power-down" blip. */
export const disabled: Fill = (out, sr) => {
    let phase = 0
    for (let i = 0; i < out.length; i++) {
        const t = i / sr
        const f = 110 + 220 * Math.exp(-t * 6)
        phase += f / sr
        const tri = 4 * Math.abs(phase - Math.floor(phase + 0.5)) - 1
        out[i] = Math.tanh(2.5 * tri) * Math.exp(-t * 6) * Math.min(1, t / 0.005)
    }
}

/** Woodblock tick for the final seconds. */
export const tick: Fill = (out, sr) => {
    for (let i = 0; i < out.length; i++) {
        const t = i / sr
        out[i] =
            Math.sin(TAU * 1650 * t) * Math.exp(-t * 70) +
            0.4 * Math.sin(TAU * 2900 * t) * Math.exp(-t * 110) +
            0.3 * noise() * Math.exp(-t * 900)
    }
}

/** A short songbird phrase: a few fast frequency-swept syllables with a warble. */
export function chirp(): { seconds: number; fill: Fill } {
    const syllables: { start: number; dur: number; f0: number; f1: number; vib: number }[] = []
    const count = 2 + Math.floor(Math.random() * 4)
    const f0 = rand(2800, 4600)
    let cursor = 0.01
    for (let s = 0; s < count; s++) {
        const dur = rand(0.04, 0.09)
        syllables.push({ start: cursor, dur, f0: f0 * rand(0.9, 1.1), f1: f0 * rand(0.65, 1.4), vib: rand(20, 45) })
        cursor += dur + rand(0.02, 0.06)
    }
    return {
        seconds: cursor + 0.05,
        fill: (out, sr) => {
            for (const syl of syllables) {
                let phase = 0
                const n = Math.floor(syl.dur * sr)
                const offset = Math.floor(syl.start * sr)
                for (let i = 0; i < n && offset + i < out.length; i++) {
                    const u = i / n
                    const t = i / sr
                    const f = syl.f0 + (syl.f1 - syl.f0) * u + 250 * Math.sin(TAU * syl.vib * t)
                    phase += (TAU * f) / sr
                    out[offset + i] += Math.sin(phase) * Math.sin(Math.PI * u) ** 2
                }
            }
        },
    }
}

/** White noise for looping wind beds (white noise has no audible loop seam). */
export const whiteNoise: Fill = (out) => {
    for (let i = 0; i < out.length; i++) out[i] = noise()
}

/** Bow-limb creak loop: a stick-slip impulse train ringing through wood resonances. */
export const creak: Fill = (out, sr) => {
    const impulses = new Float32Array(out.length)
    let t = 0.005
    const end = out.length / sr - 0.03
    while (t < end) {
        impulses[Math.floor(t * sr)] = rand(0.3, 1) * (Math.random() < 0.5 ? -1 : 1)
        // Irregular slip rate wanders between ~35 and ~95 slips per second.
        t += 1 / rand(35, 95)
    }
    const modes = [
        { f: new SVF(), hz: 380, q: 14, a: 1 },
        { f: new SVF(), hz: 940, q: 12, a: 0.6 },
        { f: new SVF(), hz: 1720, q: 10, a: 0.3 },
    ]
    for (let i = 0; i < out.length; i++) {
        let s = 0
        for (const m of modes) {
            m.f.process(impulses[i], m.hz, m.q, sr)
            s += m.a * m.f.bp
        }
        out[i] = s
    }
}
