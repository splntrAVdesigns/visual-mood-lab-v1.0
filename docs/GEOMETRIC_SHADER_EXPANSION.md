# Geometric shader expansion

Prepared against main commit `907083b2da4db3f591d6ef7ab28b159e0bc4b42f`.

## Assets

The seed library grows from 100 to 104 assets. Existing entries and the original
HUD Array sketch are retained; no existing tile is replaced or renamed.

| Slug | Title | Modes |
| --- | --- | --- |
| spatial-hud | Spatial HUD | Radial, Alpha, Delta, Sigma |
| symmetry-shapes | Symmetry Shapes | Translation, Reflection, Glide reflection, Rotation, Random |
| folded-fields | Folded Fields | Contour weave, Ribbon terrain, Folded cells |
| nodal-matter | Nodal Matter | Rounded nodes, Cross modes, Hybrid modes |

All four are GLSL ES 3.00 fragment shaders rendered through the existing shared
WebGL2 stage. There is no p5 dependency in their rendering, no new animation loop,
no independent AudioContext, and no bespoke inspector. Uniform annotations feed
the normal schema, color pickers, modulation, MIDI/gamepad binding, Roll/Mutate,
and persistence paths. Shared Playback, Appearance, and Transform controls remain
host-owned. View zoom changes internal composition, not the whole-tile Scale.
Global VFX continue through the existing effects pipeline.

## Visual behavior

- Spatial HUD uses rigid ray/plane intersections for separate depth layers;
  pitch and yaw do not bend the layers. Alpha has a sphere/scanner core, Delta
  has offset-motion instruments, and Sigma has segmented rings and a triangular
  reticle. Ring, detail, and reticle widths are independently controllable.
- Symmetry Shapes uses extruded shape frames with lighting. Random interpolates
  seeded local positions and orientations inside the ordered field; it is not
  itself a symmetry-preserving mode. Six shapes are exposed.
- Folded Fields fills the frame with an unbounded height field. Folded Cells is
  a hinged pyramid tessellation, not another contour preset.
- Nodal Matter continuously morphs standing-wave modes without a track. A
  playing uploaded track supplies smoothed dominant frequency and energy;
  silence holds its current register, and pause/removal returns to autonomous
  evolution. Manual tone overrides frequency tracking. Definition, strand width,
  density, size, relief, lighting, and four color roles are separate controls.

Nodal Matter is an analytic cymatic visualization with granular relief shading,
not a calibrated vibrating plate or a persistent sand-particle physics solver.
The audio signal estimates the strongest spectral component, not the fundamental
pitch of arbitrary polyphonic music. Microphone and synth modulation still use
the existing Modulate panel; direct high-resolution tone tracking is currently
for uploaded tracks only.

## Audio compatibility

`u_trackTone` is a reserved, opt-in vec3: playing flag, dominant Hz, energy.
Only a shader declaring that uniform requests the extra analysis. A 4096-point
analyser branches from the track's existing unity-gain analysis tap, independently
of audible volume and mute. Reads are limited to 20 Hz, buffers are reused, and
frequency/energy transitions are smoothed. Existing 64-bin frequency analysis and
256-sample waveform analysis are unchanged. Cleanup runs on shader disposal,
source replacement, track unload, and audio-context recovery.

## Validation

Completed in the development environment:

- All 15 modes compiled, linked, and rendered with Mesa OpenGL ES 3.2.
- All exposed numeric shader controls changed rendered pixels in a relevant
  mode; camera extremes, six shapes, autonomous movement, and low/high tone
  inputs were exercised.
- Real schema-parser checks passed for defaults, conditional visibility,
  grouping, reserved names, four color roles, shared controls, and modulation
  bounds.
- Dominant-frequency extraction passed 15 reference spectra at 44.1, 48, and
  96 kHz, plus silent/non-finite input cases.
- Actual track-tone functions passed mocked Web Audio lifecycle checks for lazy
  allocation, throttling, pause/suspension, release, recovery, and unload.

Not yet validated: full Next.js typecheck/build, live browser playback, actual
MIDI/gamepad hardware, browser VFX/capture, persisted reloads, mobile rendering,
or performance on the user's Intel iMac. The scratch checkout contains only the
task-relevant source subset, not the complete application/dependency installation.

## Installation and checks

Merge only the files in the patch into a clean, updated local main checkout.
No dependency installation or database migration is introduced by this patch.

```bash
npm run typecheck
npm run verify:seed
node --import tsx scripts/verify-shader-expansion.ts
npm run build
npm run seed
```

Do not use `seed:fresh`: normal seed is sufficient. Seeding targets the database
configured by `.env.local`; a local PGlite seed does not populate the deployed
production database. Seed the production library through its existing authorized
workflow after deployment if that is a different database.

In the browser, verify all four new titles, then test mode switching, colors,
camera/depth extremes, speed zero/pause/resume, parameter persistence, VFX, and
capture. For Nodal Matter, test a low sine tone, a high sine tone, and a music
track, including playback mute, track pause/resume, seek, and removal. Confirm
the original HUD Array still renders as before.
