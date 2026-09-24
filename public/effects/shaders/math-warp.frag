// Math Warp — public/effects/shaders/math-warp.frag
//
// A single mode-select uber-shader rather than N separate effect files —
// one registry entry, `mode` branches internally, more formulas can be
// added later (swirl already here; Möbius-style complex maps flagged as
// a natural next addition) without growing the effect count in the
// browser UI. `mode` is a real select-kind control now that VfxPanel
// supports rendering one (see this sprint's item 6).
//
// "Quadratic" is the reference case the whole Math Warp concept was
// scoped around: T(x,y) = [x+y, x²-y²], the transform shown warping a
// grid in the reference images that anchored this effect. Used here as
// a genuine UV-domain warp (not a literal plot of the function): `u_scale`
// brings the frame's centered UV into the input range the formula reads
// naturally, `u_amount` blends between the untouched and fully-warped
// sample position.
//
// Contract: declare fxMain(vec2 uv) -> vec4 plus this effect's own
// uniforms (bound via Control.binding in effects/manifest.json).
// u_fxSource/u_fxMix/u_time/u_resolution and the final mix blend are
// supplied by the wrapper in lib/gl/effects-compositor.ts.

uniform float u_warpMode;  // 0 = Quadratic, 1 = Swirl — select-kind control
uniform float u_amount;    // 0..1 — blend between untouched and fully-warped
uniform float u_scale;     // input-range zoom of the warp field

vec2 quadraticWarp(vec2 c) {
  // The reference transform itself: T(x, y) = (x + y, x^2 - y^2).
  return vec2(c.x + c.y, c.x * c.x - c.y * c.y);
}

vec2 swirlWarp(vec2 c) {
  float radius = length(c);
  // More twist near the center, tapering to none at the edge of the
  // zoomed field — reads as a vortex rather than a uniform rotation.
  float angle = atan(c.y, c.x) + (1.0 - clamp(radius, 0.0, 1.0)) * 6.28318;
  return vec2(cos(angle), sin(angle)) * radius;
}

vec4 fxMain(vec2 uv) {
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  float scale = max(u_scale, 0.0001);
  vec2 centered = (uv - 0.5) * aspect * scale;
  vec2 warped = u_warpMode < 0.5 ? quadraticWarp(centered) : swirlWarp(centered);
  vec2 sampleUv = mix(centered, warped, u_amount) / scale / aspect + 0.5;
  return fxSample(clamp(sampleUv, 0.0, 1.0));
}
