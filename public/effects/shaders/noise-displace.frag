// Noise Displacement — public/effects/shaders/noise-displace.frag
//
// Samples the source at uv offset by a smooth 2D value-noise field —
// stateless UV remap, same family as Math Warp (a continuous domain
// warp) but driven by noise instead of a closed-form transform. Shares
// no code with math-warp.frag by design: each effect file is
// self-contained per the existing registry contract, so this carries its
// own small hash/value-noise pair rather than importing one.
//
// Contract: declare fxMain(vec2 uv) -> vec4 plus this effect's own
// uniforms (bound via Control.binding in effects/manifest.json).
// u_fxSource/u_fxMix/u_time/u_resolution and the final mix blend are
// supplied by the wrapper in lib/gl/effects-compositor.ts.

uniform float u_amount; // 0..0.5 — max UV displacement
uniform float u_scale;  // 0.5..8 — zoom of the noise field
uniform float u_speed;  // 0..2 — animation speed

// BUGFIX (post-Tier-1+2 field testing): swapped from a hash idiom that
// amplifies its input by 123-456 before fract()-ing — safe here today
// only because uv*scale+time*speed stays in a small range, but the same
// float32 precision collapse found in grain.frag would eventually hit
// this too as u_time grows over a long session. This version multiplies
// by a small constant first, so it stays well-behaved at any input
// magnitude — same fix, applied proactively rather than waiting for it
// to surface here as well.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.13);
  p3 += dot(p3, p3.yzx + 3.333);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

vec4 fxMain(vec2 uv) {
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 field = (uv - 0.5) * aspect * u_scale + u_time * u_speed;
  float nx = valueNoise(field) - 0.5;
  float ny = valueNoise(field + vec2(31.7, 9.2)) - 0.5;
  vec2 displaced = uv + vec2(nx, ny) * u_amount / aspect;
  return fxSample(clamp(displaced, 0.0, 1.0));
}
