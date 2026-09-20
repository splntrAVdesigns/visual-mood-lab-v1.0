#version 300 es
precision highp float;

/*
 * radial-fracture — a circular HUD/dial pattern: concentric rings, each
 * divided into angular wedges, every ring x wedge cell independently
 * coloured. Ring thickness and cell colour are both randomizable for
 * varied radial geometric patterns, but every boundary is a genuine
 * circular arc or straight radial line — clean analytic geometry, not
 * organic fracture.
 *
 * REBUILT from an earlier Voronoi-shard "shattered glass" version after
 * feedback that the crack/shatter look didn't fit and that it needed to
 * read as a clean, HUD-like radial instrument instead. Two real bugs
 * from that version are fixed here structurally, not patched:
 *
 *  1. A visible seam at the angle wrap (atan2's discontinuity at ±π,
 *     which lands at the 9 o'clock position) — angular partitioning here
 *     is computed from mod(angle, 2*PI) with wedge boundaries at exact
 *     multiples of a fixed step, which has no discontinuity to inherit
 *     in the first place; there's no coordinate warp upstream of it that
 *     could reintroduce one.
 *  2. The tile freezing then going black after several minutes — u_time
 *     grows unbounded for as long as the tile is open, and feeding a
 *     large, ever-growing value into trig functions loses floating-point
 *     precision as it grows, eventually degrading into visible jitter
 *     and, once something downstream hits NaN, a fully black frame that
 *     persists even after a manual reset (the reset re-seeds parameters,
 *     it doesn't reset the clock). The rotation offset here is wrapped
 *     with mod() to a bounded range before it ever reaches a trig
 *     function, so it can run indefinitely without drifting.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform int u_ringCount;        // @label(Ring count) @range(2, 16) @default(8)
uniform int u_wedgeCount;       // @label(Wedge count) @range(3, 32) @default(12)
uniform float u_ringVariance;   // @label(Ring thickness variance) @range(0, 1) @default(0.5) @hint(0 gives perfectly even ring spacing; higher values randomize how thick each ring is.)
uniform float u_ringSeed;       // @label(Ring shuffle seed) @advanced @nomidi @range(0, 50) @default(3) @step(1) @hint(Nudge for a different random arrangement of ring thicknesses.)
uniform float u_maxRadius;      // @label(Overall size) @range(0.3, 1) @default(0.85)

uniform float u_cellColorVariance; // @label(Cell color variance) @range(0, 1) @default(0.6) @hint(0 colours whole rings uniformly; higher values let individual cells within a ring switch to a different colour independently.)
uniform float u_colorSeed;      // @label(Color shuffle seed) @advanced @nomidi @range(0, 50) @default(11) @step(1) @hint(Nudge for a different random assignment of colours to rings and cells.)
uniform float u_rotationSpeed;  // @label(Rotation speed) @range(-1, 1) @default(0.12) @mod

uniform float u_edgeWidth;      // @label(Edge line width) @range(0, 0.02) @default(0.006) @hint(Thin separator between cells — set to 0 for flat colour blocks with no line at all.)
uniform vec3 u_edgeColor;       // @label(Edge line color) @color @default(1.0, 1.0, 1.0)
uniform float u_edgeGlow;       // @label(Edge glow) @range(0, 2) @default(0.5) @advanced

uniform vec3 u_colorA;          // @label(Color A) @color @default(0.05, 0.85, 0.9)
uniform vec3 u_colorB;          // @label(Color B) @color @default(0.9, 0.15, 0.55)
uniform vec3 u_colorC;          // @label(Color C) @color @default(1.0, 0.75, 0.1)
uniform vec3 u_colorD;          // @label(Color D) @color @default(0.55, 0.3, 0.95)
uniform vec3 u_bg;              // @label(Background) @color @default(0.02, 0.02, 0.05)

uniform vec3 u_centerColor;     // @label(Center glow) @color @default(1.0, 1.0, 1.0) @advanced
uniform float u_centerGlowStrength; // @label(Center glow strength) @range(0, 2) @default(0.3) @advanced

out vec4 fragColor;

const float TAU = 6.2831853;

float hash1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

vec3 palette(float h) {
  if (h < 0.25) return u_colorA;
  if (h < 0.5) return u_colorB;
  if (h < 0.75) return u_colorC;
  return u_colorD;
}

/* Finds which ring a given radius falls into, walking outward and
   accumulating each ring's own (possibly randomized) thickness — rings
   always tile with no gaps or overlaps by construction, since each one's
   inner edge is exactly the previous one's outer edge. Returns the
   ring's index, and its inner/outer boundary radii via out params (used
   both for the 0..1 position within the ring and for the clean edge
   distance calculation in main()). */
float findRing(float radius, int ringCount, float variance, float seed, out float innerR, out float outerR) {
  float cum = 0.0;
  float avgThickness = u_maxRadius / float(ringCount);
  for (int i = 0; i < 16; i++) {
    if (i >= ringCount) break;
    float w = mix(1.0, 0.3 + hash1(vec2(float(i), seed)) * 1.6, variance);
    float thickness = avgThickness * w;
    float next = cum + thickness;
    if (radius < next || i == ringCount - 1) {
      innerR = cum;
      outerR = next;
      return float(i);
    }
    cum = next;
  }
  innerR = cum;
  outerR = cum + avgThickness;
  return float(ringCount - 1);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

  // Rotation offset wrapped to a bounded range BEFORE it reaches a trig
  // function — see the module doc's bug #2. mod() here costs nothing and
  // is what keeps this shader runnable indefinitely instead of degrading
  // after a few minutes.
  float rotation = mod(u_time * u_rotationSpeed, TAU);
  float ang = mod(atan(uv.y, uv.x) + rotation, TAU);
  float radius = length(uv);

  int ringCount = clamp(u_ringCount, 2, 16);
  int wedgeCount = clamp(u_wedgeCount, 3, 32);

  float innerR, outerR;
  float ringId = findRing(radius, ringCount, u_ringVariance, u_ringSeed, innerR, outerR);

  float wedgeStep = TAU / float(wedgeCount);
  float wedgeF = ang / wedgeStep;
  float wedgeId = floor(wedgeF);
  float wedgeFrac = fract(wedgeF);

  // Cell colour: ring-level hash by default, with an INDEPENDENT
  // per-cell override that kicks in more often as cellColorVariance
  // rises — "various cells can switch colours" rather than only whole
  // rings changing together.
  float ringHash = hash1(vec2(ringId, u_colorSeed));
  float cellHash = hash1(vec2(ringId * 31.7 + wedgeId, u_colorSeed + 7.0));
  float useCell = step(1.0 - u_cellColorVariance, hash1(vec2(ringId, wedgeId + u_colorSeed * 3.1)));
  float colorHash = mix(ringHash, cellHash, useCell);
  vec3 cellCol = palette(colorHash);

  bool insideDisc = radius < u_maxRadius;

  // Distance to the nearest cell boundary — inner/outer ring edges
  // (circular arcs) and the two wedge edges (radial lines), each
  // measured as a genuine screen-space distance so the antialiasing
  // width is consistent regardless of how far from the centre a pixel
  // is. Wedge angular distance is converted to arc length via *radius so
  // it's comparable to the ring distances rather than a raw angle value.
  float distToRingEdge = min(radius - innerR, outerR - radius);
  float distToWedgeEdge = min(wedgeFrac, 1.0 - wedgeFrac) * wedgeStep * max(radius, 0.02);
  float distToEdge = min(distToRingEdge, distToWedgeEdge);

  float aa = length(fwidth(uv)) * 1.5 + 1e-4;
  float edgeMask = u_edgeWidth > 0.0
    ? 1.0 - smoothstep(u_edgeWidth - aa, u_edgeWidth + aa, distToEdge)
    : 0.0;

  float discMask = 1.0 - smoothstep(u_maxRadius - aa, u_maxRadius + aa, radius);

  vec3 col = mix(u_bg, cellCol, discMask);
  col = mix(col, u_edgeColor, edgeMask * discMask);

  // Soft glow along the edge lines, same idea as the previous version's
  // crack glow, just against clean geometric boundaries now instead of
  // organic fracture lines.
  if (u_edgeWidth > 0.0) {
    float glowFalloff = 1.0 - smoothstep(0.0, u_edgeWidth * 6.0, distToEdge);
    col += u_edgeColor * glowFalloff * u_edgeGlow * 0.25 * (1.0 - edgeMask) * discMask;
  }

  col += u_centerColor * u_centerGlowStrength * exp(-radius * 6.0);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
