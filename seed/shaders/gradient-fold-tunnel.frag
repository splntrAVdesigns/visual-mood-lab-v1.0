#version 300 es
precision highp float;

/*
 * gradient-fold-tunnel — a rotating dihedral-mirror fold applied to a set
 * of phase-scrolled gradient bands, each band's thickness independently
 * varied by a per-band hash rather than a uniform period. Sibling to this
 * library's other dihedral-fold tiles (Kaleidoscope, Kaleidoscope Wire) —
 * where those fold a filled colour field or line strokes respectively,
 * this folds a soft airbrushed gradient ramp, closer to the "tunnel of
 * mirrored light" read of a VJ gradient loop than either existing tile.
 * See Chroma Fracture (a separate file) for the two-layer counter-
 * rotating variant of this same technique.
 *
 * The fold itself is a fixed two-axis mirror (abs(p.x), abs(p.y) after
 * rotation) rather than an arbitrary N-fold polar segment — that's what
 * gives the X → diamond → horizontal-band progression as the fold axis
 * rotates through 45°, and it's a single mirror.xz-style operation, not a
 * per-segment mod() loop, so there's no separate "fold count" control:
 * the fold's apparent complexity comes from Fold angle plus Band
 * frequency, not a segment count.
 */

uniform float u_time;
uniform vec2 u_resolution;

// Composition
uniform vec2 u_center;         // @label(Center) @range(-1, 1) @group(Composition)
uniform float u_rotation;      // @label(Rotation) @range(-180, 180) @default(0) @unit(deg) @group(Composition)
uniform float u_scale;         // @label(Scale) @range(0.4, 2.5) @default(1.0) @group(Composition)

// Fold
uniform float u_foldWeight;    // @label(Fold angle) @range(0.1, 0.9) @default(0.58) @hint(Ratio between the fold's two axes. Lower values narrow the V toward horizontal; higher values open it toward vertical.)
uniform float u_foldSpin;      // @label(Fold spin speed) @range(-1, 1) @default(0.12) @mod @hint(How fast the mirror axis itself rotates — this is what cycles the pattern between an X, a diamond, and horizontal bands over time.)

// Bands
uniform float u_frequency;     // @label(Band frequency) @range(3, 20) @default(9) @mod
uniform float u_scrollSpeed;   // @label(Scroll speed) @range(-4, 4) @default(1.4) @mod
uniform float u_bandVariety;   // @label(Band variety) @range(0, 2) @default(1.0) @mod @hint(Organic warp applied to band spacing. 0 gives perfectly even rings; higher values give an irregular thick/thin rhythm.)
uniform float u_bandSharpness; // @label(Band sharpness) @range(0.5, 4) @default(1.5) @mod @hint(Higher values pinch each band toward a thin bright line; lower values keep a soft wide glow.)

// Color
uniform vec3 u_colorDark;      // @label(Dark) @color @default(0.03, 0.0, 0.0)
uniform vec3 u_colorMid;       // @label(Mid) @color @default(0.55, 0.03, 0.02)
uniform vec3 u_colorHot;       // @label(Hot) @color @default(1.0, 0.18, 0.12)

out vec4 fragColor;

float hash1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  uv -= u_center;
  uv /= max(u_scale, 0.001);
  uv = rot2(radians(u_rotation)) * uv;

  float angle = u_time * u_foldSpin;
  vec2 p = rot2(angle) * uv;
  vec2 fp = abs(p);
  float weight = clamp(u_foldWeight, 0.05, 0.95);
  float stripe = fp.x * weight + fp.y * (1.0 - weight);

  // Band-spacing warp: two low-frequency sine terms perturb the stripe
  // coordinate before banding, so ring spacing compresses and expands
  // organically instead of every band being identical width.
  float warp = sin(stripe * 1.7 + u_time * 0.06) * (0.7 * u_bandVariety)
             + sin(stripe * 0.6 - u_time * 0.03) * (0.5 * u_bandVariety);
  float phase = stripe * u_frequency - u_time * u_scrollSpeed + warp;

  // Per-band duty cycle: each ring (floor(phase)) gets its own hashed
  // thickness, so some bands read thin and sharp, others thick and soft,
  // rather than a uniform repeating stripe.
  float bandId = floor(phase);
  float ph = fract(phase);
  float duty = mix(0.3, 0.9, hash1(bandId * 3.13));
  float edge = (1.0 - duty) * 0.5;
  float gap = smoothstep(0.0, max(edge, 0.01), ph) * smoothstep(1.0, 1.0 - max(edge, 0.01), ph);
  float tri = clamp(1.0 - abs(ph - 0.5) * 2.0 / max(duty, 0.05), 0.0, 1.0);
  float shaped = pow(tri, u_bandSharpness);
  float band = shaped * gap;

  // Fine ripple: a much higher-frequency term riding on top of the main
  // band, giving the soft "layered silk" texture inside each band rather
  // than a flat gradient fill.
  float ripple = sin(phase * 18.85) * 0.04 * shaped;
  float intensity = clamp(band + ripple, 0.0, 1.0);

  vec3 col = mix(u_colorDark, u_colorMid, smoothstep(0.0, 0.5, intensity));
  col = mix(col, u_colorHot, smoothstep(0.5, 1.0, intensity));

  fragColor = vec4(col, 1.0);
}
