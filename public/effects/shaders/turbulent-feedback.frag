// Turbulent Feedback — public/effects/shaders/turbulent-feedback.frag
//
// Reuses the SAME echo/feedback buffer mechanism Dark Strobe's `echo`
// param already established (lib/gl/effects-compositor.ts's echoCanvases
// + u_echoBuffer) rather than inventing new persistent-state plumbing —
// see the diagnostic notes on EffectDefinition.usesEcho for the one gate
// change this required. This is the buffer's second consumer and, unlike
// Dark Strobe, treats it as load-bearing rather than an optional knob:
// there's no "off" state here beyond turbulence/decay reaching 0.
//
// The look: the accumulated trail (fxEcho) is resampled through a
// turbulent noise-warped UV before blending back over the live source,
// so the trail itself churns and folds frame to frame rather than just
// fading — a "turbulent" feedback loop rather than a static ghost trail.
//
// Contract: declare fxMain(vec2 uv) -> vec4 plus this effect's own
// uniforms (bound via Control.binding in effects/manifest.json).
// u_fxSource/u_fxMix/u_time/u_resolution/u_echoBuffer and the final mix
// blend are supplied by the wrapper in lib/gl/effects-compositor.ts.

uniform float u_turbulence; // 0..1 — strength of the noise warp applied to the trail read
uniform float u_decay;      // 0..1 — how strongly the warped trail blends back in
uniform float u_scale;      // 0.5..8 — zoom of the turbulence noise field

// BUGFIX (post-Tier-1+2 field testing) — same precision-collapse issue
// found in grain.frag, fixed proactively here too. See that shader's own
// doc comment for the full root-cause writeup.
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
  vec4 src = fxSample(uv);

  vec2 field = uv * u_scale + u_time * 0.15;
  vec2 warp = vec2(valueNoise(field) - 0.5, valueNoise(field + vec2(17.3, 4.1)) - 0.5) * u_turbulence;
  vec4 trail = fxEcho(clamp(uv + warp, 0.0, 1.0));

  vec3 blended = mix(src.rgb, max(src.rgb, trail.rgb), u_decay);
  return vec4(blended, src.a);
}
