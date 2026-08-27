// Dark Strobe — effects/shaders/dark-strobe.frag
//
// Black-flicker strobe. Deliberately the first effect built in Phase 4.96
// Part 1, not the simplest one available — it's the only Beta-tier effect
// that's temporal rather than purely spatial (the mirror family is a pure
// UV remap), so it's what actually exercises the modulation-wiring and
// timing plumbing end to end. See IMPLEMENTATION_PLAN.md §7 Phase 4.96.
//
// Contract: declare fxMain(vec2 uv) -> vec4 plus this effect's own
// uniforms (bound the same way a seed shader's params bind, via
// Control.binding in effects/manifest.json). u_fxSource/u_fxMix/u_time/
// u_resolution and the final mix blend are supplied by the wrapper in
// lib/gl/effects-compositor.ts — this file never declares them itself.

uniform float u_strobeRate;      // Hz — cycles per second
uniform float u_strobeDuty;      // 0..1 — fraction of each cycle held black
uniform float u_strobeHardness;  // 0..1 — 0 = smooth crossfade, 1 = hard cut

vec4 fxMain(vec2 uv) {
  vec4 src = fxSample(uv);

  float phase = fract(u_time * u_strobeRate);
  float onWidth = 1.0 - u_strobeDuty;

  // Softness band width in phase units, shrinking toward a hard edge as
  // hardness -> 1. Clamped away from exactly 0 so smoothstep never
  // degenerates (edge0 == edge1 is undefined behavior in GLSL).
  float edge = mix(0.2, 0.002, u_strobeHardness);
  float lit = 1.0 - smoothstep(onWidth - edge, onWidth + edge, phase);

  return vec4(src.rgb * lit, src.a);
}
