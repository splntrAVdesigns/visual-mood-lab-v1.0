// Graphic Slice — public/effects/shaders/slice.frag
//
// Row-banded UV displacement — the classic glitch-cut look: the frame is
// divided into u_bandCount horizontal bands, each offset by its own
// per-band random amount, re-randomizing on a stepped clock rather than
// drifting continuously so cuts read as discrete rather than a smooth
// wobble (that's Noise Displacement's job, not this one's). Fills the
// `slice` EffectFamily that's been reserved in VfxPanel.tsx since the
// original Phase 4.96 catalog scoping.
//
// Contract: declare fxMain(vec2 uv) -> vec4 plus this effect's own
// uniforms (bound via Control.binding in effects/manifest.json).
// u_fxSource/u_fxMix/u_time/u_resolution and the final mix blend are
// supplied by the wrapper in lib/gl/effects-compositor.ts.

uniform float u_bandCount; // 2..64 — number of horizontal slices
uniform float u_amount;    // 0..0.3 — max horizontal displacement per band
uniform float u_rate;      // 0.5..30 Hz — how often bands re-randomize

float hash(float n) {
  return fract(sin(n) * 43758.5453);
}

vec4 fxMain(vec2 uv) {
  float band = floor(uv.y * max(u_bandCount, 1.0));
  float stepIndex = floor(u_time * max(u_rate, 0.01));
  float seed = hash(band * 13.17 + stepIndex * 7.31);
  float offset = (seed - 0.5) * 2.0 * u_amount;
  vec2 sliced = vec2(uv.x + offset, uv.y);
  return fxSample(clamp(sliced, 0.0, 1.0));
}
