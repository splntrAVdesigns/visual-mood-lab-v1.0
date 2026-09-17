#version 300 es
precision highp float;

/*
 * ribbon-flow — reuses gradient-fold-tunnel.frag's proven band-shaping
 * technique (phase-scrolled bands with per-band hashed duty cycle), but
 * the scalar field driving the phase is an organic domain-warped flow
 * (three octaves of rotated, translated sine warp) instead of a straight
 * dihedral-mirrored stripe coordinate. That single swap is what turns
 * rigid mirrored kaleidoscope geometry into flowing calligraphic ribbon
 * strokes — same "math as machinery" lineage, different input field, so
 * this is its own file rather than a preset of Gradient Fold Tunnel.
 *
 * Bandwidth min/max control the per-band duty-cycle range directly
 * (previously hardcoded) — at min≈max the ribbon reads as uniformly
 * thin or thick strokes; a wide gap between them gives the varied
 * thick/thin calligraphic rhythm the tile shipped with.
 */

uniform float u_time;
uniform vec2 u_resolution;

// Composition
uniform vec2 u_center;          // @label(Center) @range(-1, 1) @group(Composition)
uniform float u_rotation;       // @label(Rotation) @range(-180, 180) @default(0) @unit(deg) @group(Composition)
uniform float u_scale;          // @label(Scale) @range(0.4, 2.5) @default(1.0) @group(Composition)

// Flow field
uniform float u_flowScale;      // @label(Flow scale) @range(0.5, 3.0) @default(1.3) @hint(Sampling scale of the underlying warp field. Larger values shrink the flow's large-scale structure into the frame.)
uniform float u_flowSpin;       // @label(Flow rotation speed) @range(-1, 1) @default(0.08) @mod
uniform float u_flowSpeed;      // @label(Flow speed) @range(0, 2) @default(1.0) @mod @hint(How fast the warp field itself evolves — distinct from Scroll speed below, which moves the bands along the field rather than changing the field's own shape.)

// Bands
uniform float u_frequency;      // @label(Band frequency) @range(1, 8) @default(2.6) @mod
uniform float u_scrollSpeed;    // @label(Scroll speed) @range(-4, 4) @default(0.9) @mod
uniform float u_bandVariety;    // @label(Band variety) @range(0, 2) @default(1.0) @mod @hint(Secondary warp applied on top of the flow field, adding extra irregularity to where each band sits.)
uniform float u_bandSharpness;  // @label(Band sharpness) @range(0.5, 4) @default(1.8) @mod
uniform float u_bandwidthMin;   // @label(Bandwidth min) @range(0, 1) @default(0.22) @hint(Thinnest a band's duty cycle can hash to.)
uniform float u_bandwidthMax;   // @label(Bandwidth max) @range(0, 1) @default(0.6) @hint(Thickest a band's duty cycle can hash to. Set equal to Bandwidth min for uniform stroke width.)

// Color
uniform vec3 u_colorDark;       // @label(Dark) @color @default(0.0, 0.0, 0.0)
uniform vec3 u_colorMid;        // @label(Mid) @color @default(0.3, 0.28, 0.24)
uniform vec3 u_colorHot;        // @label(Hot) @color @default(0.98, 0.95, 0.88)

out vec4 fragColor;

float hash1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float warpField(vec2 p) {
  float n = 0.0;
  float amp = 0.6;
  vec2 q = p;
  for (int i = 0; i < 3; i++) {
    n += amp * sin(q.x * 1.6 + sin(q.y * 1.3 + u_time * 0.25 * u_flowSpeed) * 1.6 + float(i) * 2.1);
    q = rot2(0.8) * q * 1.6 + vec2(0.0, u_time * 0.05 * u_flowSpeed);
    amp *= 0.55;
  }
  return n;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  uv -= u_center;
  uv /= max(u_scale, 0.001);
  uv = rot2(radians(u_rotation)) * uv;

  vec2 rp = rot2(u_time * u_flowSpin) * uv * u_flowScale;
  float stripe = warpField(rp) * 1.9;
  float warp = sin(stripe * 1.1 + u_time * 0.1 * u_flowSpeed) * 0.6 * u_bandVariety;
  float phase = stripe * u_frequency - u_time * u_scrollSpeed + warp;

  float bandId = floor(phase);
  float ph = fract(phase);
  float bw0 = clamp(min(u_bandwidthMin, u_bandwidthMax), 0.02, 0.98);
  float bw1 = clamp(max(u_bandwidthMin, u_bandwidthMax), 0.02, 0.98);
  float duty = mix(bw0, bw1, hash1(bandId * 3.13));
  float edge = (1.0 - duty) * 0.5;
  float gap = smoothstep(0.0, max(edge, 0.02), ph) * smoothstep(1.0, 1.0 - max(edge, 0.02), ph);
  float tri = clamp(1.0 - abs(ph - 0.5) * 2.0 / max(duty, 0.06), 0.0, 1.0);
  float shaped = pow(tri, u_bandSharpness);
  float intensity = clamp(shaped * gap, 0.0, 1.0);

  vec3 col = mix(u_colorDark, u_colorMid, smoothstep(0.0, 0.5, intensity));
  col = mix(col, u_colorHot, smoothstep(0.5, 1.0, intensity));

  fragColor = vec4(col, 1.0);
}
