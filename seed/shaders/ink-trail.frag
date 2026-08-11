#version 300 es
precision highp float;

/* ink-trail — feedback accumulation (same u_prevFrame protocol as
   feedback-trails.frag) plus a small multi-tap blur for genuine fluid
   diffusion, rather than a crisp decaying copy. Ink is injected at the
   live pointer position. */

uniform float u_time;
uniform vec2 u_resolution;
uniform sampler2D u_prevFrame; /* reserved: host-bound backbuffer */
// See field-lines.frag for the same u_pointer coordinate-convention note —
// assumed 0-1 UV space, unconfirmed against a prior working example.
uniform vec2 u_pointer;

// --- controls ---
uniform float u_decay;        // @label(Decay) @range(0.85, 0.998) @default(0.965)
uniform float u_dispersion;   // @label(Dispersion) @range(0, 1) @default(0.4) @mod @hint(Fluid diffusion amount — how much the ink spreads and softens each frame.)
uniform float u_flowSpeed;    // @label(Flow Speed) @range(0, 0.05) @default(0.012) @mod
uniform float u_inkSize;      // @label(Ink Size) @range(0.005, 0.15) @default(0.035)
uniform vec3 u_inkColor;      // @label(Ink Color) @color @default(0.9, 0.2, 0.5)
uniform vec3 u_secondaryColor; // @label(Secondary Color) @color @default(0.1, 0.6, 0.9)

out vec4 fragColor;

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 centered = uv - 0.5;
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);

  // Slow drifting swirl applied to the sample point before reading the
  // backbuffer — this is what makes the ink curl like fluid instead of
  // just fading in place.
  vec2 warped = rot(u_flowSpeed) * centered / (1.0 + u_flowSpeed * 0.3) + 0.5;

  // Cheap 5-tap diffusion blur, radius scaled by dispersion.
  float r = u_dispersion * 0.01;
  vec3 prev = texture(u_prevFrame, warped).rgb * 0.4;
  prev += texture(u_prevFrame, warped + vec2(r, 0.0)).rgb * 0.15;
  prev += texture(u_prevFrame, warped - vec2(r, 0.0)).rgb * 0.15;
  prev += texture(u_prevFrame, warped + vec2(0.0, r)).rgb * 0.15;
  prev += texture(u_prevFrame, warped - vec2(0.0, r)).rgb * 0.15;
  prev *= u_decay;

  vec2 pointerP = (u_pointer - 0.5) * aspect;
  vec2 p = centered * aspect;
  float d = length(p - pointerP);
  float daub = 1.0 - smoothstep(0.0, u_inkSize, d);

  // Two-tone ink — which color leads slowly shifts over time so a long
  // idle session (or an off-canvas pointer) still visibly evolves.
  vec3 inkTone = mix(u_inkColor, u_secondaryColor, 0.5 + 0.5 * sin(u_time * 0.15));
  vec3 emit = inkTone * daub;

  fragColor = vec4(max(prev, emit), 1.0);
}
