#version 300 es
precision highp float;

/*
 * liquid-panel — a grid of structured rectangular panels, each filled with
 * its own independently domain-warped flowing gradient.
 *
 * Two coordinate spaces do the work: PANEL space (which cell is this pixel
 * in, and where does it sit within that panel's own 0..1 box) picks the
 * shape and the gap/rounding; a second, PANEL-LOCAL warp space (domain-
 * warped fbm, seeded and phase-shifted per grid index) picks the colour.
 * Because every panel warps its own noise field from its own local origin
 * rather than sampling one continuous field cut into tiles, no two panels
 * are ever in phase with each other — the grid reads as a wall of small,
 * separately-alive gradients, distinct from this library's other liquid/
 * metaball tiles, which are all a single continuous field (summed
 * potential in Rorschach Metaball/Liquid Blobs/Liquid Gradient, one
 * coordinate space throughout). This is deliberately structured geometry
 * first, liquid fill second.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform int u_cols;            // @label(Columns) @range(1, 12) @default(5)
uniform int u_rows;            // @label(Rows) @range(1, 12) @default(4)
uniform float u_gap;           // @label(Gap) @range(0, 0.3) @default(0.06) @hint(Space between panels, as a fraction of one panel's size.)
uniform bool u_mirrorX;        // @label(Mirror horizontal) @default(false) @hint(Reflects the right half of the grid to match the left half — same shapes, same flow pattern, mirrored.)
uniform bool u_mirrorY;        // @label(Mirror vertical) @default(false) @hint(Reflects the bottom half of the grid to match the top half.)
uniform int u_panelShape;      // @label(Panel shape) @select(Rounded Rect=0 | Circle=1 | Triangle=2 | Cut Corner=3 | Octagon=4 | Stripe=5 | Right Triangle=6 | Mixed=7) @default(0)
uniform float u_shapeAmount;   // @label(Shape amount) @range(0, 0.5) @default(0.15) @hint(Corner rounding, chamfer, or stripe thickness, depending on the shape — reused per-shape rather than one control per option.)
uniform float u_shapeSeed;     // @label(Shuffle seed) @range(0, 50) @default(7) @step(1) @advanced @hint(Only affects Mixed — nudge this for a different random arrangement of shapes across the grid, the same "roll again" idea Rorschach Metaball's own Arrangement control uses.)

uniform float u_warpAmount;    // @label(Warp amount) @range(0.2, 3) @default(1.3) @mod
uniform float u_warpScale;     // @label(Warp scale) @range(0.5, 5) @default(1.8) @mod
uniform float u_flowSpeed;     // @label(Flow speed) @range(0, 2) @default(0.35) @mod
uniform float u_phaseSpread;   // @label(Phase spread) @range(0, 3) @default(1.4) @hint(How out-of-sync neighbouring panels' flows are with each other.)

uniform vec3 u_colorA;         // @label(Color A) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_colorB;         // @label(Color B) @color @default(0.92, 0.18, 0.55)
uniform vec3 u_colorC;         // @label(Color C) @color @default(0.06, 0.02, 0.1)
uniform vec3 u_gapColor;       // @label(Gap color) @color @default(0.0, 0.0, 0.0)

uniform float u_paletteSpread; // @label(Palette spread) @range(0.3, 3) @default(1.1) @advanced @hint(How many colour cycles happen across each panel.)
uniform bool u_outline;        // @label(Outline) @default(false) @advanced
uniform vec3 u_outlineColor;   // @label(Outline color) @color @default(1.0, 1.0, 1.0) @advanced

out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}

/* Domain-warped fbm: feed the field's own output back in as a coordinate
   offset before sampling again — the standard "flow noise" trick, what
   makes this read as liquid rather than static clouds. */
float warpedField(vec2 p, float t, float amount) {
  vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(
    fbm(p + amount * q + vec2(1.7, 9.2) + t),
    fbm(p + amount * q + vec2(8.3, 2.8) + t * 0.8)
  );
  return fbm(p + amount * r);
}

/* Inigo Quilez's rounded-box SDF — signed distance from p to a box of
   half-extent b with corner radius r, centred at the origin. Negative
   inside, positive outside. Every other shape below follows the same
   sign convention so they can share one mask/outline pipeline in main(). */
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdCircle(vec2 p, float r) { return length(p) - r; }

/* IQ's equilateral-triangle SDF, pointing up. */
float sdTriangle(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

/* Chamfered box: an axis-aligned box intersected with a 45-degree cut on
   every corner. A regular octagon is exactly this SDF at one specific
   chamfer amount (b.x*(sqrt(2)-1)) — Octagon below is Cut Corner with
   that amount computed rather than a separate shape entirely, since an
   octagon genuinely IS a special case of a chamfered square, not a
   coincidence worth hiding. */
float sdChamferBox(vec2 p, vec2 b, float c) {
  vec2 q = abs(p) - b;
  float d = max(q.x, q.y);
  d = max(d, (q.x + q.y + c) * 0.70710678);
  return d;
}

/* A bar rotated to read as a diagonal stripe filling most of the panel. */
float sdStripe(vec2 p, vec2 b, float angle) {
  float c = cos(angle), s = sin(angle);
  vec2 rp = mat2(c, -s, s, c) * p;
  vec2 q = abs(rp) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

/* Right triangle filling one half of the box, split along a diagonal —
   the box SDF intersected with a half-plane. `flip` mirrors which half,
   used to alternate orientation per cell for a woven/herringbone look. */
float sdRightTriangle(vec2 p, vec2 b, float flip) {
  vec2 q = abs(p) - b;
  float boxD = max(q.x, q.y);
  float diag = (p.x * flip + p.y) * 0.70710678;
  return max(boxD, diag);
}

/* Dispatches to whichever shape u_panelShape selects. Mixed (7) picks a
   shape per-cell from a hash of the cell index and u_shapeSeed — nudging
   the seed reshuffles which shape lands where, without needing a native
   "button" control GLSL uniforms don't have (see u_shapeSeed's own hint). */
float panelShapeDist(vec2 p, vec2 b, float amount, int shapeType, vec2 cell, float shapeSeed) {
  int type = shapeType;
  if (type == 7) {
    float roll = hash(cell + shapeSeed * 17.0);
    type = int(floor(roll * 7.0));
  }

  float minB = min(b.x, b.y);
  float chamfer = clamp(amount, 0.0, minB);
  float octChamfer = minB * 0.41421356; // b*(sqrt(2)-1) -- the true regular-octagon amount

  if (type == 1) return sdCircle(p, minB);
  if (type == 2) return sdTriangle(p, minB * 0.72);
  if (type == 3) return sdChamferBox(p, b, chamfer);
  if (type == 4) return sdChamferBox(p, b, octChamfer);
  if (type == 5) return sdStripe(p, vec2(b.x * 1.6, max(amount, 0.03)), 0.7854);
  if (type == 6) {
    float flip = mod(cell.x + cell.y, 2.0) < 1.0 ? 1.0 : -1.0;
    return sdRightTriangle(p, b, flip);
  }
  return sdRoundBox(p, b, chamfer); // 0: Rounded Rect
}

void main() {
  vec2 fragUv = gl_FragCoord.xy / u_resolution;

  float cols = float(max(1, u_cols));
  float rows = float(max(1, u_rows));

  vec2 grid = fragUv * vec2(cols, rows);
  vec2 cell = floor(grid);
  vec2 local = fract(grid) - 0.5; // -0.5..0.5, centred in the panel

  // Mirror layout: reflect the cell index AND the local shape coordinate
  // for cells past the grid's centre line, so the second half is a true
  // geometric+colour reflection of the first — not just "the same random
  // seed reused," which would keep the pattern but not the actual mirror
  // symmetry the shape geometry itself needs (a Stripe's diagonal, a
  // Right Triangle's flip, all need their COORDINATE mirrored, not just
  // their seed).
  vec2 shapeLocal = local;
  vec2 patternCell = cell;
  if (u_mirrorX && cell.x > (cols - 1.0) * 0.5) {
    patternCell.x = cols - 1.0 - cell.x;
    shapeLocal.x = -shapeLocal.x;
  }
  if (u_mirrorY && cell.y > (rows - 1.0) * 0.5) {
    patternCell.y = rows - 1.0 - cell.y;
    shapeLocal.y = -shapeLocal.y;
  }

  vec2 halfSize = vec2(0.5 - u_gap * 0.5);
  float panelDist = panelShapeDist(shapeLocal, halfSize, u_shapeAmount, u_panelShape, patternCell, u_shapeSeed);

  // Antialiasing width computed from fwidth(grid) — the CONTINUOUS
  // pre-fract coordinate — rather than fwidth(panelDist) directly.
  // fract() has a hard discontinuity at every cell boundary (local jumps
  // from +0.5 to -0.5 between two adjacent screen pixels that straddle a
  // seam), and any derivative computed downstream of that jump inherits
  // a spuriously huge value at exactly that row/column of pixels — which
  // is exactly where the reported bleed-through appeared. fwidth(grid)
  // has no such jump (grid is smooth everywhere), so it gives a stable
  // per-pixel step size to derive the AA width from instead.
  float aa = length(fwidth(grid)) * 0.7 + 1e-4;
  float panelMask = 1.0 - smoothstep(-aa, aa, panelDist);

  // Per-panel seed and phase — keeps every panel's flow visibly out of
  // sync with its neighbours rather than all breathing in lockstep.
  float seed = hash(patternCell);
  float phase = seed * u_phaseSpread * 6.2831;
  float t = u_time * u_flowSpeed + phase;

  // PANEL-LOCAL warp coordinate (not the global fragUv) — every panel
  // shows a similarly-scaled pattern regardless of its position in the
  // grid, just phase/seed-shifted from its neighbours.
  vec2 warpUv = (shapeLocal + 0.5) * u_warpScale + seed * 41.7;
  float field = warpedField(warpUv, t, u_warpAmount);
  float g = clamp(field * u_paletteSpread, 0.0, 1.0);

  vec3 col = mix(u_colorC, u_colorA, smoothstep(0.15, 0.55, g));
  col = mix(col, u_colorB, smoothstep(0.5, 0.95, g));

  vec3 outCol = mix(u_gapColor, col, panelMask);

  if (u_outline) {
    float edge = 1.0 - smoothstep(0.0, aa * 2.0 + 0.002, abs(panelDist));
    outCol = mix(outCol, u_outlineColor, edge * panelMask);
  }

  fragColor = vec4(clamp(outCol, 0.0, 1.0), 1.0);
}
