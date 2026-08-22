#version 300 es
precision highp float;

/*
 * glitch-scan — broken-transmission signal corruption: chromatic
 * aberration, horizontal scanline jitter, and block displacement, over a
 * base field of drifting colour bands. A VHS/CRT-glitch aesthetic, not a
 * strobe (Strobe Cut is the hard binary flash) and not typography (this
 * project's library already has five different kinetic-typography
 * sketches — Type Grid, Type Wave, Glyph Swarm, Data Glyphs, LED
 * Display — so a sixth wasn't worth building; this fills the "glitchy"
 * half of the original brief's "strobe effects for glitchy flashing"
 * language instead, from a different angle than Strobe Cut).
 *
 * Three corruption layers, each independently controllable:
 *   - Block displacement: whole horizontal bands randomly shift left or
 *     right, like a corrupted video buffer.
 *   - Scanline jitter: fine per-row horizontal noise, like signal
 *     interference.
 *   - Chromatic split: the red/green/blue channels sample the
 *     (post-displacement) field at slightly different offsets, the
 *     classic RGB-fringe glitch look.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_bandScale;       // @label(Band scale) @range(0.5, 8) @default(2.5) @hint(Size of the underlying colour bands being corrupted.)
uniform float u_flowSpeed;       // @label(Flow speed) @range(0, 2) @default(0.3) @mod

uniform float u_blockGlitch;     // @label(Block displacement) @range(0, 0.3) @default(0.08) @mod @hint(How far corrupted horizontal bands shift.)
uniform float u_blockRate;       // @label(Block glitch rate) @range(0.2, 10) @default(2.5) @mod @hint(How often new bands get corrupted.)
uniform float u_scanJitter;      // @label(Scanline jitter) @range(0, 0.05) @default(0.008) @mod
uniform float u_chromaSplit;     // @label(Chromatic split) @range(0, 0.05) @default(0.012) @mod

uniform vec3 u_colorA;           // @label(Color A) @color @default(0.05, 0.9, 0.85)
uniform vec3 u_colorB;           // @label(Color B) @color @default(0.9, 0.1, 0.5)
uniform vec3 u_bg;               // @label(Background) @color @default(0.02, 0.02, 0.04)
uniform float u_scanlineDarken;  // @label(Scanline darken) @range(0, 0.6) @default(0.2) @advanced @hint(A faint horizontal line pattern, like a CRT's own raster.)

out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

/* Samples the underlying colour-band field at a given (already-
   corrupted) coordinate — kept as its own function since the chromatic
   split calls this three times with slightly different offsets. */
vec3 bandField(vec2 uv) {
  float n = noise(uv * u_bandScale + vec2(u_time * u_flowSpeed, 0.0));
  return mix(u_bg, mix(u_colorA, u_colorB, smoothstep(0.3, 0.7, n)), smoothstep(0.15, 0.4, n));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  // Block displacement: whole horizontal bands (rows quantized into
  // coarse bins) shift left/right, re-rolled at a rate independent of
  // the frame rate via a time-quantized seed.
  float blockRow = floor(uv.y * 14.0);
  float blockTime = floor(u_time * u_blockRate);
  float blockSeed = hash(vec2(blockRow, blockTime));
  float blockActive = step(0.72, blockSeed);
  float blockShift = (hash(vec2(blockRow, blockTime + 0.5)) - 0.5) * 2.0 * u_blockGlitch * blockActive;

  // Scanline jitter: finer, per-pixel-row horizontal noise, always
  // present at a low level rather than gated on/off like the block
  // glitch.
  float scanRow = floor(uv.y * u_resolution.y);
  float scanJitterAmt = (hash(vec2(scanRow, floor(u_time * 30.0))) - 0.5) * 2.0 * u_scanJitter;

  vec2 corruptedUv = uv + vec2(blockShift + scanJitterAmt, 0.0);

  // Chromatic split: sample the field three times at slightly different
  // X offsets per channel, the classic RGB-fringe look.
  vec2 splitDir = vec2(u_chromaSplit, 0.0);
  float r = bandField(corruptedUv + splitDir).r;
  float g = bandField(corruptedUv).g;
  float b = bandField(corruptedUv - splitDir).b;
  vec3 col = vec3(r, g, b);

  // Faint raster scanline darkening across every row.
  float scanline = 0.5 + 0.5 * sin(uv.y * u_resolution.y * 3.14159);
  col *= 1.0 - u_scanlineDarken * (1.0 - scanline);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
