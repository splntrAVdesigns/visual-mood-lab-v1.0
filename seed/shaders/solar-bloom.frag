#version 300 es
precision highp float;

/*
 * solar-bloom — third member of the Vortex Bloom lineage (with
 * vortex-bloom.frag and twin-vortex.frag), but instead of the radial
 * band-phase math those two share, this drives the pattern with a
 * nested angular spike-boundary function: three concentric rings, each
 * an independently-rotating star-shaped radius curve (cos(angle *
 * petalCount) raised to a sharpness exponent), rendered as a thin glow
 * at |r - ringRadius(angle)|. That's genuinely different core math from
 * the phase/duty-cycle banding technique, which is why this is its own
 * file rather than a Vortex Bloom preset.
 *
 * Each petal's length breathes independently (per-petal phase offset
 * keyed off its index within the ring) and each ring rotates at its own
 * speed, so the whole thing reads as alive rather than one rigid
 * spinning shape.
 */

uniform float u_time;
uniform vec2 u_resolution;

// Composition
uniform vec2 u_center;             // @label(Center) @range(-1, 1) @group(Composition)
uniform float u_rotation;          // @label(Rotation) @range(-180, 180) @default(0) @unit(deg) @group(Composition)
uniform float u_scale;             // @label(Scale) @range(0.4, 2.5) @default(1.0) @group(Composition)

// Petal shape
uniform int u_petalCount;          // @label(Petal count) @range(3, 10) @default(6) @nomod
uniform float u_spikeSharpness;    // @label(Spike sharpness) @range(0.15, 1.2) @default(0.4) @mod @hint(Lower values pinch each spike to a sharper point; higher values round the petal shape toward a soft lobe.)
uniform float u_spikeAmount;       // @label(Spike amount) @range(0, 0.5) @default(0.2) @mod @hint(How far each spike extends beyond the ring's base radius.)
uniform float u_breatheAmount;     // @label(Breathe amount) @range(0, 0.3) @default(0.05) @mod @hint(How much each individual petal's length pulses independently — this is what makes the petals feel alive rather than rigid.)
uniform float u_breatheSpeed;      // @label(Breathe speed) @range(0, 4) @default(1.0) @mod
uniform float u_fineDetail;        // @label(Fine detail) @range(0, 0.05) @default(0.018) @mod
uniform float u_fineFrequency;     // @label(Fine frequency) @range(5, 40) @default(21) @mod

// Ring layout
uniform float u_baseRadius;        // @label(Base radius) @range(0.05, 0.5) @default(0.18)
uniform float u_ringSpacing;       // @label(Ring spacing) @range(0.05, 0.3) @default(0.16)
uniform float u_spinSpeed;         // @label(Spin speed) @range(-2, 2) @default(1.0) @mod

// Color
uniform vec3 u_colorDeep;          // @label(Deep) @color @default(0.02, 0.005, 0.0)
uniform vec3 u_hueA;               // @label(Hue A) @color @default(1.0, 0.25, 0.05)
uniform vec3 u_hueB;               // @label(Hue B) @color @default(1.0, 0.8, 0.25)
uniform vec3 u_coreColor;          // @label(Core color) @color @default(1.0, 0.95, 0.75)
uniform float u_coreSize;          // @label(Core size) @range(4, 30) @default(13)
uniform float u_coreBrightness;    // @label(Core brightness) @range(0, 3) @default(1.3) @mod
uniform float u_coreShimmerSpeed;  // @label(Core shimmer speed) @range(0, 8) @default(3.0) @mod
uniform float u_vignette;          // @label(Vignette) @range(0, 1) @default(1.0)

out vec4 fragColor;

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float starR(float a, float baseR, float petalCount, float sharpness, float spikeAmount, float breatheAmt, float breatheSpd, float fineDetail, float fineFreq) {
  float petalIdx = floor(a / (6.2831853 / petalCount));
  float breathe = sin(u_time * breatheSpd + petalIdx * 1.9) * breatheAmt;
  float spikes = pow(max(0.0, cos(a * petalCount)), sharpness) * (spikeAmount + breathe);
  float fine = sin(a * fineFreq + u_time * 0.9) * fineDetail;
  return baseR + spikes + fine;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  uv -= u_center;
  uv /= max(u_scale, 0.001);
  uv = rot2(radians(u_rotation)) * uv;

  float r = length(uv);
  float pc = float(max(u_petalCount, 3));
  vec3 col = u_colorDeep;

  // Three concentric rings, fixed at compile time — a genuinely
  // variable ring count would need a dynamic loop bound, which isn't
  // worth the cost here; three reads clearly as "layered" without it.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ringSpeed = (0.12 + fi * 0.11) * u_spinSpeed;
    float ang = atan(uv.y, uv.x) + u_time * ringSpeed + fi * 0.9;
    float baseR = u_baseRadius + fi * u_ringSpacing;
    float breatheSpd = (1.4 + fi * 0.3) * u_breatheSpeed;
    float rr = starR(ang, baseR, pc, u_spikeSharpness, u_spikeAmount, u_breatheAmount, breatheSpd, u_fineDetail, u_fineFrequency);
    float d = abs(r - rr);
    float glow = exp(-d * d * 260.0) * (1.0 - fi * 0.2);
    float hueDrift = sin(u_time * 0.35 + ang * 1.5 + fi * 2.1) * 0.5 + 0.5;
    vec3 hue = mix(u_hueA, u_hueB, hueDrift);
    col += hue * glow;
  }

  float core = exp(-r * r * u_coreSize);
  float coreShimmer = 0.9 + 0.3 * sin(u_time * u_coreShimmerSpeed);
  col += u_coreColor * core * u_coreBrightness * coreShimmer;

  float vigMin = mix(1.0, 0.4, u_vignette);
  float vig = smoothstep(1.4, 0.3, r);
  col *= mix(vigMin, 1.0, vig);

  fragColor = vec4(col, 1.0);
}
