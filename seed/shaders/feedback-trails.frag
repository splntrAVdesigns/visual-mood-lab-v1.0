#version 300 es
precision highp float;

/* feedback-trails — accumulation against the previous frame.
   The only seed asset that forces the backbuffer/FBO path, which is exactly
   why it is in the starter set rather than discovered in Phase 4. */

uniform float u_time;
uniform vec2 u_resolution;
uniform sampler2D u_prevFrame;  /* reserved: host-bound backbuffer */

uniform sampler2D u_src;       // @label(Source) @hint(Leave empty to run purely generative.)
uniform float u_decay;         // @label(Decay) @range(0.7, 0.999) @default(0.965) @hint(How much of the last frame survives.)
uniform float u_feedbackZoom;  // @label(Feedback zoom) @range(0.95, 1.05) @default(1.004)
uniform float u_feedbackSpin;  // @label(Feedback spin) @range(-0.05, 0.05) @default(0.004)
uniform vec2 u_feedbackShift;  // @label(Feedback drift) @range(-0.01, 0.01)
uniform float u_emitterSize;   // @label(Emitter size) @range(0.005, 0.3) @default(0.045)
uniform float u_emitterSpeed;  // @label(Emitter speed) @range(0, 3) @default(0.8)
uniform vec3 u_emitterColor;   // @label(Emitter colour) @color @default(0.0, 0.83, 1.0)
uniform bool u_useSource;      // @label(Feed from source) @default(false)
uniform float u_hueShift;      // @label(Hue drift) @range(0, 1) @default(0.12) @advanced

out vec4 fragColor;

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

vec3 hue(vec3 c, float shift) {
  const vec3 k = vec3(0.57735);
  float cosA = cos(shift * 6.2831);
  return c * cosA + cross(k, c) * sin(shift * 6.2831) + k * dot(k, c) * (1.0 - cosA);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 centered = uv - 0.5;

  /* Sample the previous frame through a small affine transform — the zoom
     and spin are what turn a fading trail into a spiral. */
  vec2 warped = rot(u_feedbackSpin) * centered / u_feedbackZoom + 0.5 + u_feedbackShift;
  vec3 prev = texture(u_prevFrame, warped).rgb * u_decay;
  prev = hue(prev, u_hueShift * 0.02);

  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 p = centered * aspect;

  float t = u_time * u_emitterSpeed;
  vec2 emitter = vec2(cos(t) * 0.32 + cos(t * 2.3) * 0.12,
                      sin(t * 1.4) * 0.28 + sin(t * 0.7) * 0.1);

  float d = length(p - emitter);
  float dot_ = 1.0 - smoothstep(0.0, u_emitterSize, d);

  vec3 emit = u_emitterColor * dot_;
  if (u_useSource) emit = texture(u_src, uv).rgb * dot_;

  fragColor = vec4(max(prev, emit), 1.0);
}
