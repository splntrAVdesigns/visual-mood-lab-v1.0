#version 300 es
precision highp float;

/*
 * strobe-cut — a grid of hard-edged geometric cells, each independently
 * cutting between on and off states rather than the whole canvas
 * flashing uniformly. A flat, screen-wide strobe is a lighting effect;
 * this is closer to a signal being sliced — sharp per-cell rectangles
 * snapping in and out, phase-offset from their neighbours so the pattern
 * itself seems to scan and glitch rather than just blink.
 *
 * Built with Modulate in mind specifically: u_flashRate, u_threshold, and
 * u_hueShift are the three parameters most worth binding to an LFO or
 * (once available) audio energy — they're what actually drives the
 * cutting rhythm, not incidental detail. The threshold-based hard cut
 * (step(), not smoothstep()) is deliberate too: a strobe reads as a
 * strobe because the transition is instant, not eased.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_cols;           // @label(Columns) @range(1, 20) @default(8)
uniform float u_rows;            // @label(Rows) @range(1, 20) @default(5)
uniform float u_gap;             // @label(Gap) @range(0, 0.3) @default(0.08)

uniform float u_flashRate;       // @label(Flash rate) @range(0.5, 20) @default(6) @mod @hint(How fast each cell cycles between on and off.)
uniform float u_threshold;       // @label(Duty cycle) @range(0.05, 0.95) @default(0.5) @mod @hint(Fraction of each cycle a cell spends "on" — low values give brief sharp flashes, high values give brief dark gaps.)
uniform float u_phaseSpread;     // @label(Phase spread) @range(0, 3) @default(1.2) @hint(How out of sync neighbouring cells' flashes are — 0 flashes the whole grid in lockstep.)
uniform float u_scanBias;        // @label(Scan direction) @range(-1, 1) @default(0.4) @hint(Biases the phase spread across the grid so the flashing reads as sweeping in one direction rather than purely random.)

uniform int u_pattern;           // @label(Cell shape) @select(Rectangle=0 | Cross=1 | Diamond=2 | Hourglass=3 | Star=4 | Hexagon=5) @default(0)
uniform float u_hueShift;        // @label(Color cycle) @range(0, 2) @default(0.3) @mod @hint(Cycles the on-colour through the palette over time.)

uniform vec3 u_colorOn;          // @label(Color (on)) @color @default(1.0, 1.0, 1.0)
uniform vec3 u_colorOnAlt;       // @label(Color (on, cycled)) @color @default(0.0, 0.9, 1.0)
uniform vec3 u_colorOff;         // @label(Color (off)) @color @default(0.03, 0.03, 0.05)
uniform vec3 u_bg;               // @label(Background) @color @default(0.0, 0.0, 0.0)

out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float sdBox(vec2 p, vec2 halfSize) {
  vec2 d = abs(p) - halfSize;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

/* Rotated-square SDF via L1 (taxicab) distance, scaled into approximate
   real-world units (by the smaller half-extent) so fwidth() of it gives
   a sensible antialiasing width — the earlier version used the raw,
   dimensionless L1 ratio directly with step(), which has no
   antialiasing at all and is exactly what produced the reported
   staircasing on diagonal edges specifically (diagonals are far more
   sensitive to a hard cutoff than axis-aligned edges are). */
float sdDiamond(vec2 p, vec2 halfSize) {
  float l1 = abs(p.x) / halfSize.x + abs(p.y) / halfSize.y;
  return (l1 - 1.0) * min(halfSize.x, halfSize.y);
}

float sdCross(vec2 p, vec2 halfSize, float armH) {
  return min(sdBox(p, vec2(halfSize.x, armH)), sdBox(p, vec2(armH, halfSize.y)));
}

/* Two triangles meeting tip to tip — the region where |x|/halfW is
   still less than |y|/halfH (closer to the vertical centreline than the
   diagonal boundary), intersected with the vertical extent. */
float sdHourglass(vec2 p, float halfW, float halfH) {
  float wedge = (abs(p.x) * halfH - abs(p.y) * halfW) / max(length(vec2(halfH, halfW)), 1e-4);
  float withinY = abs(p.y) - halfH;
  return max(wedge, withinY);
}

/* Four-pointed sparkle/star via a polar radius function — a small,
   standard technique (radius shrinks between the four points via
   |cos(2*angle)|), not a from-scratch derivation prone to the same kind
   of error the isometric grid's projection math needed several passes
   to get right. */
float sdStar(vec2 p, float r) {
  float ang = atan(p.y, p.x);
  float starR = r * pow(abs(cos(2.0 * ang)), 0.3);
  return length(p) - starR;
}

/* Inigo Quilez's regular-hexagon SDF — a well-established, widely used
   formula, used verbatim rather than derived, for the same reliability
   reason as sdStar above. */
float sdHexagon(vec2 p, float r) {
  vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

void main() {
  vec2 fragUv = gl_FragCoord.xy / u_resolution;

  float cols = max(1.0, floor(u_cols + 0.5));
  float rows = max(1.0, floor(u_rows + 0.5));

  vec2 grid = fragUv * vec2(cols, rows);
  vec2 cell = floor(grid);
  vec2 local = fract(grid) - 0.5;

  float seed = hash(cell);
  // Scan bias skews each cell's phase by its position along one diagonal,
  // so the strobe reads as sweeping across the grid rather than flashing
  // in a uniformly random scatter — u_scanBias's sign picks the sweep
  // direction, magnitude how strong the directional read is versus the
  // per-cell randomness.
  float sweep = (cell.x / cols + cell.y / rows) * u_scanBias;
  float phase = (seed * u_phaseSpread + sweep) * 6.2831;

  float cyclePos = fract(u_time * u_flashRate * 0.25 + phase / 6.2831);
  // Deliberately still a hard step, unlike the shape edges below — this
  // is the actual strobe timing, and a strobe reads as a strobe because
  // that transition is instant, not eased. Spatial antialiasing and
  // temporal hard-cutting are two different concerns; conflating them by
  // using step() for both was the root of the reported jaggedness.
  float on = step(cyclePos, u_threshold);

  vec2 halfSize = vec2(0.5 - u_gap * 0.5);
  float minHalf = min(halfSize.x, halfSize.y);

  float d;
  if (u_pattern == 1) d = sdCross(local, halfSize, 0.18);
  else if (u_pattern == 2) d = sdDiamond(local, halfSize);
  else if (u_pattern == 3) d = sdHourglass(local, halfSize.x, halfSize.y);
  else if (u_pattern == 4) d = sdStar(local, minHalf);
  else if (u_pattern == 5) d = sdHexagon(local, minHalf);
  else d = sdBox(local, halfSize);

  float aa = fwidth(d) + 1e-4;
  float shapeMask = 1.0 - smoothstep(-aa, aa, d);

  vec3 hueOn = mix(u_colorOn, u_colorOnAlt, 0.5 + 0.5 * sin(u_time * u_hueShift + seed * 6.2831));
  vec3 cellCol = mix(u_colorOff, hueOn, on);

  vec3 col = mix(u_bg, cellCol, shapeMask);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
