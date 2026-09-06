// Grain — public/effects/shaders/grain.frag
//
// BUGFIX (post-Tier-1+2 field testing): the original version of this file
// used a `hash(vec2 p) { p = fract(p*vec2(123.34,456.21)); p += dot(p,
// p+45.32); return fract(p.x*p.y); }` idiom that's safe for normalized
// UV-scale inputs (the range every other new effect in this batch feeds
// it) but was fed RAW PIXEL-CELL COORDINATES here — values in the
// thousands. `p.x*p.y` at that stage becomes a number in the hundreds of
// thousands to millions; float32 has ~7 decimal digits of precision, so
// `fract()` of a value that large returns a heavily quantized result —
// not noise, coherent vertical banding (confirmed by simulating the
// exact math at real canvas resolutions: reproduced the "thin vertical
// lines" artifact pixel-for-pixel). That coherent periodic structure is
// also what was aliasing against a tile's own animated motion and
// reading as reversed drift — a real periodic signal beating against
// motion, not a direction bug. True independent-per-pixel noise has no
// coherent structure to alias against and doesn't produce this.
//
// Fixed by swapping in a hash that stays well-behaved at arbitrary input
// magnitude (multiplies by a small constant and fracts immediately,
// before any operation that could blow up precision — the standard fix
// for exactly this failure mode, unlike the previous version which
// amplified by 123-456 first).
//
// Contract: declare fxMain(vec2 uv) -> vec4 plus this effect's own
// uniforms (bound via Control.binding in effects/manifest.json).
// u_fxSource/u_fxMix/u_time/u_resolution and the final mix blend are
// supplied by the wrapper in lib/gl/effects-compositor.ts.

uniform float u_grainIntensity; // 0..1 — how strongly the noise perturbs the image
uniform float u_grainSize;      // 1..8 — grain cell size, in source pixels
uniform bool  u_grainColored;   // false = monochrome grain, true = per-channel color noise

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.13);
  p3 += dot(p3, p3.yzx + 3.333);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 fxMain(vec2 uv) {
  vec4 src = fxSample(uv);

  vec2 px = floor(uv * u_resolution / max(u_grainSize, 1.0));
  float seed = u_time * 59.0;

  float mono = hash(px + seed) - 0.5;
  vec3 colored = vec3(
    hash(px + seed + 11.0) - 0.5,
    hash(px + seed + 37.0) - 0.5,
    hash(px + seed + 71.0) - 0.5
  );
  vec3 grain = u_grainColored ? colored : vec3(mono);

  vec3 graded = src.rgb + grain * u_grainIntensity;
  return vec4(clamp(graded, 0.0, 1.0), src.a);
}
