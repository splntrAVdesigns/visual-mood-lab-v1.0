#version 300 es
precision highp float;

/*
 * vortex-bloom — a polar N-fold kaleidoscope fold whose axis itself
 * spirals inward via a 1/r twist term, so the fold angle winds tighter
 * near the center instead of staying radially straight. The resulting
 * bands are shaped with the same phase/duty-cycle technique as
 * gradient-fold-tunnel.frag, plus a high-frequency jag term for the
 * organic ripple edge and a hot additive core at the origin.
 *
 * This is the base member of a three-file family sharing this lineage:
 *   - twin-vortex.frag  — two independently counter-rotating instances
 *                          of this same fold, screen-blended (the
 *                          Vortex Bloom equivalent of Chroma Fracture)
 *   - solar-bloom.frag  — replaces the radial band-phase math with a
 *                          nested angular spike-boundary function;
 *                          genuinely different core math, not a preset
 *
 * Unlike gradient-fold-tunnel.frag's fixed two-axis mirror, this fold
 * uses a real N-fold polar segment (mod(angle, TAU/foldCount)), so Fold
 * count is a real, meaningful integer control here.
 */

uniform float u_time;
uniform vec2 u_resolution;

// Composition
uniform vec2 u_center;           // @label(Center) @range(-1, 1) @group(Composition)
uniform float u_rotation;        // @label(Rotation) @range(-180, 180) @default(0) @unit(deg) @group(Composition)
uniform float u_scale;           // @label(Scale) @range(0.4, 2.5) @default(1.0) @group(Composition)

// Vortex
uniform int u_foldCount;         // @label(Fold count) @range(4, 16) @default(9) @nomod @hint(Number of kaleidoscope segments. Integer — modulating this snaps rather than pulses, so it's excluded from Modulate.)
uniform float u_spiralAmount;    // @label(Spiral amount) @range(0.4, 4.0) @default(1.8) @mod @hint(Strength of the 1/r twist that spirals the fold toward the center. Higher values wind the tendrils tighter near the core.)
uniform float u_spinSpeed;       // @label(Spin speed) @range(-2, 2) @default(0.55) @mod

// Bands
uniform float u_jagAmount;       // @label(Jag amount) @range(0, 2) @default(1.0) @mod @hint(High-frequency ripple applied to each band's edge — 0 gives clean smooth bands, higher values give the jagged organic edge.)
uniform float u_frequency;       // @label(Band frequency) @range(4, 20) @default(11) @mod
uniform float u_scrollSpeed;     // @label(Scroll speed) @range(-4, 4) @default(1.6) @mod
uniform float u_bandSharpness;   // @label(Band sharpness) @range(0.5, 4) @default(2.2) @mod

// Color
uniform vec3 u_colorDeep;        // @label(Deep) @color @default(0.015, 0.0, 0.03)
uniform vec3 u_colorA;           // @label(Color A) @color @default(0.55, 0.15, 0.85)
uniform vec3 u_colorB;           // @label(Color B) @color @default(0.12, 0.62, 0.6)
uniform vec3 u_coreColor;        // @label(Core color) @color @default(1.0, 0.95, 1.0)
uniform float u_coreSize;        // @label(Core size) @range(4, 30) @default(13) @hint(Higher values pinch the hot center to a tighter point; lower values spread it into a soft glow.)
uniform float u_coreBrightness;  // @label(Core brightness) @range(0, 3) @default(1.25) @mod
uniform float u_vignette;        // @label(Vignette) @range(0, 1) @default(1.0)

out vec4 fragColor;

float hash1(float x) { return fract(sin(x * 127.1) * 43758.5453); }

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  uv -= u_center;
  uv /= max(u_scale, 0.001);
  float rotRad = radians(u_rotation);
  uv = mat2(cos(rotRad), -sin(rotRad), sin(rotRad), cos(rotRad)) * uv;

  float r = length(uv);
  float ang = atan(uv.y, uv.x);
  float spiralTwist = u_spiralAmount / (r + 0.18) - u_time * u_spinSpeed;
  float seg = 6.2831853 / float(max(u_foldCount, 3));
  float foldedAng = mod(ang + spiralTwist, seg);
  foldedAng = abs(foldedAng - seg * 0.5);

  float jag = (sin(foldedAng * 14.0 + u_time * 0.8) * 0.06
             + sin(foldedAng * 23.0 - u_time * 1.1) * 0.03) * u_jagAmount;
  float warp = sin(r * 8.0 + foldedAng * 3.0 + u_time * 0.3) * 0.15;

  // Two slightly detuned band phases summed together — this is what
  // keeps the tendrils from looking like one perfectly clean ring
  // pattern; the second phase runs at a marginally different frequency
  // and scroll speed so the two never stay in lockstep.
  float phase1 = r * u_frequency + jag * 5.0 + warp - u_time * u_scrollSpeed;
  float ph1 = fract(phase1);
  float tri1 = 1.0 - abs(ph1 - 0.5) * 2.0;
  float shaped1 = pow(max(tri1, 0.0), u_bandSharpness);

  float phase2 = r * (u_frequency * 1.036) + jag * 5.0 + warp - u_time * (u_scrollSpeed * 1.025);
  float ph2 = fract(phase2);
  float tri2 = 1.0 - abs(ph2 - 0.5) * 2.0;
  float shaped2 = pow(max(tri2, 0.0), u_bandSharpness + 0.2) * 0.6;

  float shapedAll = clamp(shaped1 + shaped2, 0.0, 1.0);

  vec3 mixCol = mix(u_colorA, u_colorB, smoothstep(0.15, 0.85, sin(foldedAng * 3.0 + u_time * 0.2) * 0.5 + 0.5));
  vec3 col = u_colorDeep + mixCol * shapedAll * 0.95;

  float core = exp(-r * r * u_coreSize);
  col += u_coreColor * core * u_coreBrightness;

  float vigMin = mix(1.0, 0.4, u_vignette);
  float vig = smoothstep(1.4, 0.3, r);
  col *= mix(vigMin, 1.0, vig);

  fragColor = vec4(col, 1.0);
}
