#version 300 es
precision highp float;

/* chromatic-glitch — was a post-processing effect that required linking
   another board asset as a "Source" and sampling it. That link never
   worked reliably in practice (it depended on board-wide texture-source
   wiring that turned out to be missing entirely, and even once fixed,
   only ever sampled the linked asset's static poster, never its live
   output — a real ceiling on what this asset could ever be).

   Redesigned as a fully self-contained generative texture engine — no
   external dependency at all: an animated noise field, a traveling
   light-pulse band, color grain, and chromatic fringing, all generated
   here, with the original glitch identity (block displacement, line
   jitter, scanlines) kept as an occasional burst modulating that base
   rather than being the only thing on screen.

   Also fixes a real stutter bug from the old version: every moving part
   of the previous shader (block displacement, line jitter, even the
   general noise) was driven by `slot`, a floor()'d time value that only
   updates u_rate times per second (2.2 by default) — meaning the whole
   image was a frozen snapshot for ~450ms at a time, then jumped, with
   nothing animating continuously in between. Here, the noise flow,
   pulse sweep, and grain all animate every frame directly off u_time;
   `slot`-driven quantization is kept ONLY for the block/line glitch
   bursts, which are supposed to look sudden — that's authentic to what
   a glitch burst is, but it's no longer the sole source of motion. */

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;

uniform float u_noiseScale;      // @label(Noise Scale) @range(1, 12) @default(3.5) @mod
uniform float u_flowSpeed;       // @label(Flow Speed) @range(0, 3) @default(0.6) @mod
uniform float u_pulseSpeed;      // @label(Pulse Speed) @range(0, 4) @default(1.2) @mod
uniform float u_pulseWidth;      // @label(Pulse Width) @range(0.02, 0.5) @default(0.12)
uniform float u_pulseIntensity;  // @label(Pulse Intensity) @range(0, 2) @default(0.8) @mod
uniform float u_grainAmount;     // @label(Color Grain) @range(0, 0.6) @default(0.15) @mod
uniform float u_aberration;      // @label(Chromatic Split) @range(0, 0.4) @default(0.08)

uniform float u_burstRate;       // @label(Glitch Burst Rate) @range(0, 8) @default(1.4) @mod
uniform float u_blockAmount;     // @label(Block Displace) @range(0, 1) @default(0.25)
uniform float u_blockSize;       // @label(Block Size) @range(2, 64) @default(14) @log @unit(px)
uniform float u_jitter;          // @label(Line Jitter) @range(0, 0.1) @default(0.008)

uniform float u_scanlines;       // @label(Scanline Density) @range(0, 800) @default(240) @advanced
uniform float u_scanDepth;       // @label(Scanline Depth) @range(0, 1) @default(0.2) @advanced

uniform vec3 u_colorA;           // @label(Color A) @color @default(0.05, 0.85, 1.0)
uniform vec3 u_colorB;           // @label(Color B) @color @default(1.0, 0.15, 0.65)
uniform vec3 u_bg;               // @label(Background) @color @default(0.02, 0.02, 0.04)

uniform bool u_vignette;         // @label(Vignette) @default(true) @advanced
uniform bool u_altPattern;       // @label(Alt Pattern) @default(false) @advanced @hint(Shifts the noise field to a distinct second arrangement.)

out vec4 fragColor;

float hash(vec2 p) {
  float seedOffset = u_seed + (u_altPattern ? 91.7 : 0.0);
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seedOffset) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Four-octave fractal noise — the generated base content this whole
// shader now runs on, standing in for what used to be a sampled
// texture.
float fbm(vec2 p) {
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * valueNoise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  // Glitch burst — the one part of this shader that's DELIBERATELY
  // quantized, same as the old version, because a burst is supposed to
  // look like a sudden discrete event. Everything else below animates
  // continuously off u_time directly, so the image keeps moving between
  // bursts instead of freezing.
  float slot = floor(u_time * max(u_burstRate, 0.001));
  float burst = step(0.72, hash(vec2(slot, 3.7)));

  vec2 block = floor(gl_FragCoord.xy / u_blockSize);
  float blockRand = hash(block + slot);
  vec2 glitchOffset = vec2((blockRand - 0.5) * u_blockAmount * burst * 0.2, 0.0);
  float lineY = floor(gl_FragCoord.y);
  glitchOffset.x += (hash(vec2(lineY, slot)) - 0.5) * u_jitter * burst;

  // Continuously-flowing noise field — this is what actually fixes the
  // stutter. u_time enters directly here, every frame, not through
  // `slot`.
  vec2 flowUv = uv * u_noiseScale + glitchOffset
              + vec2(u_time * u_flowSpeed * 0.08, u_time * u_flowSpeed * 0.05);

  // Three noise samples offset by u_aberration, the same structural
  // idea as the old RGB-channel texture split — here the SPREAD between
  // them (nR - nB) becomes a fringing term rather than literal channel
  // sampling, since there's no source image to split anymore.
  //
  // The offset is scaled by u_noiseScale here — it used to be applied
  // directly in raw UV space (a fixed 0-0.05 distance), which was tiny
  // relative to the noise lattice's own spacing (adjacent hash cells
  // are 1.0 apart in flowUv space) and produced an imperceptible shift
  // at every slider value. Scaling it keeps the split a consistent
  // fraction of one visible noise cell regardless of how zoomed in the
  // field is.
  vec2 abOffset = vec2(u_aberration * u_noiseScale, 0.0);
  float nR = fbm(flowUv + abOffset);
  float nG = fbm(flowUv);
  float nB = fbm(flowUv - abOffset);

  vec3 palette = mix(u_colorA, u_colorB, smoothstep(0.3, 0.7, nG));
  float shade = smoothstep(0.15, 0.75, nG);
  vec3 col = mix(u_bg, palette, shade);
  float fringe = nR - nB;
  col += vec3(fringe, 0.0, -fringe) * 0.6;

  // Traveling light pulse — a diagonal band sweeping continuously
  // across the field, independent of the burst/noise timing.
  float pulsePhase = fract((uv.x + uv.y) * 0.5 - u_time * u_pulseSpeed * 0.15);
  float band = smoothstep(u_pulseWidth, 0.0, abs(pulsePhase - 0.5));
  col += u_colorA * band * u_pulseIntensity;

  // Color grain — refreshed every frame via fract(u_time), so it reads
  // as authentic fast-flickering film grain rather than the old
  // slot-locked noise that only changed a couple of times a second.
  float grain = hash(gl_FragCoord.xy * 1.7 + fract(u_time) * 977.0) - 0.5;
  col += grain * u_grainAmount;

  if (u_scanlines > 0.0) {
    float s = sin(uv.y * u_scanlines * 3.14159 - u_time * 0.3);
    col *= 1.0 - u_scanDepth * (0.5 + 0.5 * s);
  }

  if (u_vignette) {
    vec2 c = uv - 0.5;
    col *= 1.0 - smoothstep(0.35, 0.78, length(c));
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
