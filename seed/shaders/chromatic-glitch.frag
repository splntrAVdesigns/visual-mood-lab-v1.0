#version 300 es
precision highp float;

/* chromatic-glitch — aberration, scanlines, and block displacement.
   Carries the only @trigger in the shader set, so the inspector's
   fire-and-forget control path gets exercised by a real asset. */

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;          /* reserved: host bumps this on trigger */
uniform sampler2D u_src;       // @label(Source)

uniform float u_aberration;    // @label(Aberration) @range(0, 0.06) @default(0.006)
uniform float u_blockAmount;   // @label(Block displace) @range(0, 1) @default(0.25)
uniform float u_blockSize;     // @label(Block size) @range(2, 64) @default(14) @log @unit(px)
uniform float u_scanlines;     // @label(Scanline density) @range(0, 800) @default(240)
uniform float u_scanDepth;     // @label(Scanline depth) @range(0, 1) @default(0.25)
uniform float u_jitter;        // @label(Line jitter) @range(0, 0.1) @default(0.008)
uniform float u_noise;         // @label(Noise) @range(0, 0.5) @default(0.05)
uniform float u_rate;          // @label(Glitch rate) @range(0, 8) @default(2.2)
uniform bool u_desaturate;     // @label(Desaturate base) @default(false)
uniform bool u_vignette;       // @label(Vignette) @default(true) @advanced
uniform bool u_reseed;         // @label(Reseed) @default(false) @advanced

out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + u_seed) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  /* Quantise time so glitches land in discrete bursts rather than sliding. */
  float slot = floor(u_time * max(u_rate, 0.001));
  float burst = step(0.72, hash(vec2(slot, 3.7)));

  vec2 block = floor(gl_FragCoord.xy / u_blockSize);
  float blockRand = hash(block + slot);
  vec2 offset = vec2((blockRand - 0.5) * u_blockAmount * burst * 0.2, 0.0);

  float line = floor(gl_FragCoord.y);
  offset.x += (hash(vec2(line, slot)) - 0.5) * u_jitter * burst;

  vec2 uvR = uv + offset + vec2(u_aberration, 0.0);
  vec2 uvG = uv + offset;
  vec2 uvB = uv + offset - vec2(u_aberration, 0.0);

  vec3 col = vec3(
    texture(u_src, uvR).r,
    texture(u_src, uvG).g,
    texture(u_src, uvB).b);

  if (u_desaturate) col = vec3(dot(col, vec3(0.2126, 0.7152, 0.0722)));

  if (u_scanlines > 0.0) {
    float s = sin(uv.y * u_scanlines * 3.14159);
    col *= 1.0 - u_scanDepth * (0.5 + 0.5 * s);
  }

  col += (hash(gl_FragCoord.xy + slot) - 0.5) * u_noise;

  if (u_vignette) {
    vec2 c = uv - 0.5;
    col *= 1.0 - smoothstep(0.35, 0.78, length(c));
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
