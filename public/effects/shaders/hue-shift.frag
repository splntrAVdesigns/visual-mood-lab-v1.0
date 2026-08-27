// Hue Shift LUT — public/effects/shaders/hue-shift.frag
//
// SCOPING NOTE, worth being explicit about: this is an HSV hue-rotation
// pass, not a texture-based 3D LUT. The original decision (pre-VFX,
// scoped for uploaded media's BASE_CONTROLS) explicitly named a
// texture-based color grade as what "LUT" technically implies, and
// flagged that as real, separate shader work versus "a simpler hue-rotate
// slider." This ships the simpler, genuinely useful version now — full
// HSV rotation plus saturation/brightness, shader-based (never CSS
// filter/mix-blend-mode, consistent with every other effect in this
// registry) — with true LUT-texture support a clearly separate future
// step if it's still wanted once this is in use.
//
// Contract: declare fxMain(vec2 uv) -> vec4 plus this effect's own
// uniforms (bound via Control.binding in effects/manifest.json).
// u_fxSource/u_fxMix/u_time/u_resolution and the final mix blend are
// supplied by the wrapper in lib/gl/effects-compositor.ts.

uniform float u_hue;         // 0..360 degrees
uniform float u_saturation;  // 0..2, multiplier
uniform float u_brightness;  // 0..2, multiplier

// Standard RGB<->HSV, the same well-known formulation used throughout
// shader work generally — no dependency on anything else in this repo.
vec3 rgb2hsv(vec3 c) {
  vec4 k = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, k.wz), vec4(c.gb, k.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(k.xxx, clamp(p - k.xxx, 0.0, 1.0), c.y);
}

vec4 fxMain(vec2 uv) {
  vec4 src = fxSample(uv);
  vec3 hsv = rgb2hsv(src.rgb);
  hsv.x = fract(hsv.x + u_hue / 360.0);
  hsv.y = clamp(hsv.y * u_saturation, 0.0, 1.0);
  hsv.z = clamp(hsv.z * u_brightness, 0.0, 2.0);
  return vec4(hsv2rgb(hsv), src.a);
}
