// BrokeTV — public/effects/shaders/broke-tv.frag
//
// Started life as a bug: Grain's original hash function broke down and
// produced coherent vertical bands instead of noise (see grain.frag's
// own doc comment for the full root cause). The look was worth keeping
// on its own merits, so it's promoted here as a deliberate effect rather
// than left as an accident — but rebuilt clean, not copy-pasted from the
// broken version:
//
//  - Uses the SAFE 1D hash (`hash(float n) = fract(sin(n)*43758.5453)`)
//    already precedented in slice.frag, not the 2D hash that caused the
//    original problem.
//  - Bands are a function of x ONLY — never y, never a value baked
//    identically into both axes the way the original bug's `seed`
//    was — so there's no coupling that could reproduce that failure.
//  - `rollSpeed` defaults to 0: the band pattern is fully static unless
//    explicitly dialed up. This is what actually fixes the "reverses the
//    tile's own drift direction" complaint — that was the coherent
//    banding's OWN unintended motion (baked into the old hash via a
//    continuously-growing time-based seed) beating against the tile's
//    real motion. A static pattern has no motion of its own to compete
//    with, structurally, not just by accident.
//
// Contract: declare fxMain(vec2 uv) -> vec4 plus this effect's own
// uniforms (bound via Control.binding in effects/manifest.json).
// u_fxSource/u_fxMix/u_time/u_resolution and the final mix blend are
// supplied by the wrapper in lib/gl/effects-compositor.ts.

uniform float u_intensity;  // 0..1 — how strongly the bands tint the image
uniform float u_bandWidth;  // 1..8 — width of each vertical band, in source pixels
uniform float u_rollSpeed;  // 0..200 px/sec — horizontal drift of the band pattern; 0 = static

float hash1(float n) {
  return fract(sin(n) * 43758.5453);
}

vec4 fxMain(vec2 uv) {
  vec4 src = fxSample(uv);

  float x = uv.x * u_resolution.x + u_time * u_rollSpeed;
  float col = floor(x / max(u_bandWidth, 1.0));
  float n = hash1(col * 12.9898);

  vec3 tint = mix(vec3(1.0), vec3(n), u_intensity);
  return vec4(src.rgb * tint, src.a);
}
