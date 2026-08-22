#version 300 es
precision highp float;

/*
 * pulse-bars — full-height vertical columns, each carrying several
 * bright "signal beam" segments that scroll continuously through it,
 * for a spectrogram/heatmap read rather than an equalizer with bars
 * growing from a baseline (an earlier version of this tile). Columns
 * span the whole tile height at all times; the "pulse" is the beams'
 * own brightness and motion, not the column's height.
 *
 * Built as a natural future audio-reactivity candidate specifically:
 * u_amplitude is the one parameter that most directly maps to "how much
 * energy is in the signal right now" — it controls how strongly the
 * signal colour cuts through against the base column tone, the most
 * obvious thing to eventually drive from real audio input.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_barCount;        // @label(Bar count) @range(4, 48) @default(20)
uniform float u_gap;             // @label(Gap) @range(0, 0.6) @default(0.25) @hint(Space between bars, as a fraction of one bar's width.)
uniform float u_amplitude;       // @label(Amplitude) @range(0, 1) @default(0.7) @mod @hint(How strongly the signal colour contrasts against the base column tone — the one control most worth binding to Modulate.)
uniform float u_pulseSpeed;      // @label(Pulse speed) @range(0, 4) @default(1.2) @mod @hint(Speed of the signal beams scrolling through the bars.)
uniform float u_smoothness;      // @label(Smoothness) @range(0, 1) @default(0.4) @hint(Edge softness of each beam — 0 is squared off, 1 is round and blurred.)
uniform float u_beamDensity;     // @label(Beam density) @range(0, 1) @default(0.5) @hint(How many signal segments appear per column.)

uniform int u_pulseDirection;    // @label(Pulse direction) @select(Up=0 | Down=1 | Both=2) @default(2) @hint(Both alternates direction every other bar.)
uniform float u_glow;            // @label(Glow) @range(0, 2) @default(0.7)

uniform vec3 u_colorBase;        // @label(Base color) @color @default(0.08, 0.05, 0.35)
uniform vec3 u_colorSignal;      // @label(Signal color) @color @default(0.4, 0.95, 1.0)
uniform vec3 u_bg;               // @label(Background) @color @default(0.02, 0.02, 0.05)

out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float hash1(float p) { return fract(sin(p * 127.1) * 43758.5453); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  float n = max(1.0, floor(u_barCount + 0.5));
  float barIndex = floor(uv.x * n);
  float barLocalX = fract(uv.x * n);

  float halfGap = u_gap * 0.5;
  float aaX = fwidth(barLocalX) * 1.5 + 1e-4;
  float inBarX = smoothstep(halfGap - aaX, halfGap + aaX, barLocalX)
               * (1.0 - smoothstep(1.0 - halfGap - aaX, 1.0 - halfGap + aaX, barLocalX));

  float colVar = 0.65 + hash1(barIndex * 3.7) * 0.6;
  vec3 baseCol = u_colorBase * colVar;

  float dir = 1.0;
  if (u_pulseDirection == 1) dir = -1.0;
  else if (u_pulseDirection == 2) dir = mod(barIndex, 2.0) < 1.0 ? 1.0 : -1.0;

  int nBeams = int(clamp(floor(u_beamDensity * 6.0 + 1.5), 1.0, 7.0));

  float coreMax = 0.0;
  float glowSum = 0.0;

  for (int i = 0; i < 7; i++) {
    if (i >= nBeams) break;
    float bi = float(i);
    float beamSeed = hash(vec2(barIndex, bi));
    float speedVar = 0.6 + hash(vec2(barIndex, bi + 10.0)) * 0.7;

    float beamY = fract(beamSeed + u_time * u_pulseSpeed * 0.12 * dir * speedVar);
    float dy = abs(uv.y - beamY);
    dy = min(dy, 1.0 - dy);

    float coreWidth = 0.012;
    float aaBeam = mix(0.003, 0.05, u_smoothness);
    float core = 1.0 - smoothstep(coreWidth - aaBeam, coreWidth + aaBeam, dy);
    coreMax = max(coreMax, core);

    float glowSigma = mix(0.015, 0.05, u_glow * 0.5);
    glowSum += exp(-(dy * dy) / (2.0 * glowSigma * glowSigma));
  }

  float amp = clamp(u_amplitude, 0.0, 1.0);
  vec3 col = mix(baseCol, u_colorSignal, coreMax * amp);
  col += u_colorSignal * glowSum * u_glow * amp * 0.35;

  col = mix(u_bg, col, inBarX);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
