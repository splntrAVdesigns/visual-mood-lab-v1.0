// Linear Mirror — public/effects/shaders/linear-mirror.frag
//
// Folds the frame across a line at an arbitrary angle and offset, rather
// than a fixed horizontal/vertical/both selector — genuinely more capable
// with just two continuous sliders than a 3-way discrete choice would be,
// and avoids needing a `select`-kind control (VfxPanel only renders
// `slider`-kind params today — see VfxPanel.tsx's own doc comment on that
// scoping choice).
//
// Contract: declare fxMain(vec2 uv) -> vec4 plus this effect's own
// uniforms (bound via Control.binding in effects/manifest.json).
// u_fxSource/u_fxMix/u_time/u_resolution and the final mix blend are
// supplied by the wrapper in lib/gl/effects-compositor.ts.

uniform float u_angle;   // degrees — the mirror line's orientation
uniform float u_offset;  // -0.5..0.5 — perpendicular distance of the line from center

vec4 fxMain(vec2 uv) {
  vec2 centered = uv - 0.5;

  float rad = radians(u_angle);
  vec2 dir = vec2(cos(rad), sin(rad));       // along the mirror line
  vec2 normal = vec2(-dir.y, dir.x);         // perpendicular to it

  // Signed distance from the (offset) line. Reflect anything on the far
  // side back across it — everything on the near side is untouched.
  float d = dot(centered, normal) - u_offset;
  if (d > 0.0) {
    centered -= 2.0 * d * normal;
  }

  vec2 mirrored = clamp(centered + 0.5, 0.0, 1.0);
  return fxSample(mirrored);
}
