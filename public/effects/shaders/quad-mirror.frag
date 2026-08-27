// Quad Mirror — public/effects/shaders/quad-mirror.frag
//
// Folds all four quadrants around an adjustable center point into one —
// the classic 4-way kaleidoscope-style mirror. Center is adjustable
// rather than fixed to the exact middle of the frame, so the fold point
// itself becomes a usable, modulatable parameter (an LFO nudging the
// center makes the whole pattern breathe, not just repeat statically).
//
// Contract: declare fxMain(vec2 uv) -> vec4 plus this effect's own
// uniforms (bound via Control.binding in effects/manifest.json).
// u_fxSource/u_fxMix/u_time/u_resolution and the final mix blend are
// supplied by the wrapper in lib/gl/effects-compositor.ts.

uniform float u_centerX;  // 0..1
uniform float u_centerY;  // 0..1

vec4 fxMain(vec2 uv) {
  vec2 center = vec2(u_centerX, u_centerY);
  // abs() folds every quadrant's offset from center into the same
  // positive-positive quadrant — the standard 4-way mirror fold.
  vec2 folded = center + abs(uv - center);
  return fxSample(clamp(folded, 0.0, 1.0));
}
