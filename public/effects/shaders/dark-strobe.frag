// Dark Strobe / White Strobe — effects/shaders/dark-strobe.frag
//
// Black-flicker strobe. Deliberately the first effect built in Phase 4.96
// Part 1, not the simplest one available — it's the only Beta-tier effect
// that's temporal rather than purely spatial (the mirror family is a pure
// UV remap), so it's what actually exercises the modulation-wiring and
// timing plumbing end to end. See IMPLEMENTATION_PLAN.md §7 Phase 4.96.
//
// GENERALIZED (Tier 1+2 batch) to also serve "White Strobe" as a second
// manifest entry pointing at this same file, differing only in
// u_flashColor's fixed default (black vs white — see the `flashColor`
// Control in effects/manifest.json, a `color`-kind param deliberately
// left off VfxPanel's rendered kinds so it acts as a fixed per-entry
// constant rather than a user-facing control, the same "declared but not
// surfaced" trick applyEffectParams already supports for any control
// kind it doesn't explicitly render). Verified equivalence: with
// u_flashColor = (0,0,0), `mix(u_flashColor, src.rgb, lit)` reduces to
// exactly `src.rgb * lit` — Dark Strobe's on-screen behavior is
// byte-identical to before this change.
//
// Contract: declare fxMain(vec2 uv) -> vec4 plus this effect's own
// uniforms (bound the same way a seed shader's params bind, via
// Control.binding in effects/manifest.json). u_fxSource/u_fxMix/u_time/
// u_resolution and the final mix blend are supplied by the wrapper in
// lib/gl/effects-compositor.ts — this file never declares them itself.

uniform float u_strobeRate;      // Hz — cycles per second
uniform float u_strobeDuty;      // 0..1 — fraction of each cycle held on-color
uniform float u_strobeHardness;  // 0..1 — 0 = smooth crossfade, 1 = hard cut
uniform float u_echoAmount;      // 0..1 — Phase 4.96 Part 2: how much of the
                                  // fading trail (fxEcho) ghosts through
uniform vec3  u_flashColor;      // fixed per-entry constant — black for Dark
                                  // Strobe, white for White Strobe

vec4 fxMain(vec2 uv) {
  vec4 src = fxSample(uv);
  vec4 echo = fxEcho(uv);

  float phase = fract(u_time * u_strobeRate);
  float onWidth = 1.0 - u_strobeDuty;

  // Softness band width in phase units, shrinking toward a hard edge as
  // hardness -> 1. Clamped away from exactly 0 so smoothstep never
  // degenerates (edge0 == edge1 is undefined behavior in GLSL).
  float edge = mix(0.2, 0.002, u_strobeHardness);
  float lit = 1.0 - smoothstep(onWidth - edge, onWidth + edge, phase);

  vec3 strobed = mix(u_flashColor, src.rgb, lit);
  // Echo ghosts through most visibly during the flash-color portion of
  // the cycle (1.0 - lit near 1 there) and barely shows during the lit
  // portion — the whole reason to pair strobe with a trail at all is the
  // afterimage flashing through the gaps, not sitting flatly under a
  // fully-lit frame where it wouldn't read as anything distinct. Echo is
  // a Dark-Strobe-only knob for now (White Strobe's manifest entry omits
  // the `echo` param entirely, so u_echoAmount stays at its GL default
  // of 0 and this line is a no-op for it) — max() against a white flash
  // color would need different blend math to read correctly, flagged
  // rather than guessed at; see IMPLEMENTATION_PLAN.md VFX diagnostic
  // notes if White Strobe + Echo is wanted later.
  vec3 withEcho = mix(strobed, max(strobed, echo.rgb), u_echoAmount * (1.0 - lit));
  return vec4(withEcho, src.a);
}
