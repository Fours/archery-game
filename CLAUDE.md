# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server with HMR
- `npm run build` — type-check (`tsc -b`) then produce a production build
- `npm run lint` — run ESLint over the repo
- `npm run preview` — serve the built `dist/` locally

There is no test runner configured.

## Architecture

A first-person archery game. The player is stationary; gameplay so far is aim → draw → release → arrow physics → stick in ground.

**Mount boundary.** `src/App.tsx` is a thin React shell that owns a container `div` and a click-to-play overlay. Inside a single `useEffect`, it constructs `new Game(container, setLocked)` and returns `() => game.dispose()`. **All Three.js lives behind the `Game` class** — no `useFrame`-style React-Three-Fiber, no Three objects in React state. The overlay is shown/hidden by a `locked` boolean that `Game` pushes through the `setLocked` callback when pointer-lock state changes.

**Game loop and ownership.** `Game` (`src/game/Game.ts`) owns the `WebGLRenderer`, `Scene`, `PerspectiveCamera`, the `Bow` viewmodel, and an `Arrow[]`. Its `animate` method is a `requestAnimationFrame` loop that computes `dt` (clamped to 50 ms to survive tab-throttle), advances the draw timer, calls `arrow.update(dt)` on each live arrow, and renders. The bow is added as a **child of the camera** so it tracks aim automatically — there is no separate viewmodel matrix.

**Input.** Pointer Lock API on the renderer canvas. Mouse-look uses a `THREE.Euler` in `'YXZ'` order so yaw and pitch don't fight each other; pitch is clamped to ±(π/2 − ε). Spacebar drives a one-shot draw state (`drawing`, `drawTime`, `spaceHeld`); losing pointer lock cancels any in-progress draw so the bow doesn't get stuck mid-pull.

**Bow viewmodel coordinate convention** (`src/game/Bow.ts`). The bow's local frame matches the camera's: bow-local `−Z` points away from the archer (toward the target), `+Z` points back at the archer. Limbs curve toward `−Z` (back of bow faces target); the string's three-point polyline sits at `+Z` and the middle vertex slides further `+Z` as draw increases. The nocked arrow is a child of the bow group and inherits this same convention. If you change the bow's parent transform, preserve this orientation or `setDraw` will pull the string the wrong direction.

**Firing geometry — important.** Arrows are **not** spawned from the bow's tip. Direction is `camera.getWorldDirection()` (so the crosshair is the source of truth), and the origin is the camera position offset forward + right + down to *appear* to leave the bow. This keeps aim accurate; if you make the spawn truly bow-relative, expect arrows to miss the crosshair at close range.

**Arrow physics** (`src/game/Arrow.ts`). Each arrow integrates its own velocity with `GRAVITY = 22 m/s²` (semi-implicit Euler). The mesh is built so its local `−Z` is the tip, which lets `lookAt(position + velocity)` re-orient the arrow along its trajectory each frame. Ground collision is the half-space `y ≤ 0`: on contact, the arrow snaps to `y = 0`, advances 6 cm along travel direction to embed the tip, and sets `stuck = true` to skip further updates. There is currently **no broadphase, no scene collision, and no arrow lifetime cap** — stuck arrows accumulate in `Game.arrows` forever.

**Tunables** live as module-level constants at the top of each file: `MAX_DRAW_TIME`, `MIN_ARROW_SPEED`, `MAX_ARROW_SPEED`, `MOUSE_SENSITIVITY`, `EYE_HEIGHT` in `Game.ts`; `STRING_REST_OFFSET`, `STRING_MAX_DRAW`, `BOW_HALF_HEIGHT` in `Bow.ts`; `GRAVITY`, `SHAFT_LENGTH` in `Arrow.ts`.

**Disposal contract.** Because of React 19 StrictMode (see below), `Game.dispose()` must be exhaustive: cancel the RAF, remove every `window`/`document` listener it added, exit pointer lock if held, dispose every geometry/material reachable from the scene, dispose the grass `CanvasTexture` (textures are not auto-disposed by material `dispose()`), call `renderer.dispose()`, and remove the canvas from its parent. `Bow` and `Arrow` each expose their own `dispose()` for symmetry. When adding new long-lived Three resources, wire them into this teardown path.

## Stack notes that affect how code is written

- **React 19** with `StrictMode` enabled in `src/main.tsx` — effects and refs may run twice in dev; Three.js setup that mounts to a DOM node must clean up renderers, geometries, and event listeners in the effect's cleanup function or it will leak on every re-mount.
- **TypeScript config is strict in non-obvious ways** (`tsconfig.app.json`):
  - `verbatimModuleSyntax: true` — type-only imports must use `import type { ... }`.
  - `erasableSyntaxOnly: true` — no enums, namespaces, or parameter properties; use `const` objects + union types instead.
  - `noUnusedLocals` / `noUnusedParameters` — unused identifiers fail the build, not just lint. Prefix with `_` to silence intentionally.
- **Vite** is the only bundler; static assets go in `public/` (served at `/`) and are referenced by absolute path.
