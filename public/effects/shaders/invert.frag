// Invert — public/effects/shaders/invert.frag
//
// Point reflection through an adjustable center — the fourth member of
// the original brainstorm's mirror family (Linear, Polar/Quad, Invert),
// completing that set. Same slider-only scoping as Linear/Quad Mirror:
// VfxPanel only renders slider-kind params until #6 in this sprint lands
// select/toggle support, so this ships ahead of that dependency too.
//
// Contract: declare fxMain(vec2 uv) -> vec4 plus this effect's own
// uniforms (bound via Control.binding in effects/manifest.json).
// u_fxSource/u_fxMix/u_time/u_resolution and the final mix blend are
// supplied by the wrapper in lib/gl/effects-compositor.ts.

uniform float u_centerX;  // 0..1
uniform float u_centerY;  // 0..1

vec4 fxMain(vec2 uv) {
  vec2 center = vec2(u_centerX, u_centerY);
  vec2 inverted = 2.0 * center - uv;
  return fxSample(clamp(inverted, 0.0, 1.0));
}
