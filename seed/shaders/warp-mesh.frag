#version 300 es
precision highp float;

/*
 * warp-mesh — a wireframe grid whose lines are displaced by a genuine
 * height field, shaded by that same height for a topographic, "deforming
 * 3D surface" read rather than merely wavy 2D lines.
 *
 * The grid is drawn in the classic 2D way (distance to the nearest line
 * in a repeating cell), but the SAMPLE COORDINATE is displaced by a
 * domain-warped noise field before the grid distance is computed — the
 * lines don't just wiggle, they genuinely follow the noise field's own
 * contours, the same way a cloth or terrain mesh follows the surface
 * draped under it. Height also drives per-pixel colour and node size, so
 * the "peaks" and "valleys" read as such rather than just being a
 * texture applied uniformly across flat lines.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_gridScale;      // @label(Grid density) @range(3, 24) @default(10) @hint(How many cells across the tile.)
uniform float u_lineWidth;      // @label(Line width) @range(0.01, 0.15) @default(0.045)
uniform bool u_showNodes;       // @label(Show nodes) @default(true)
uniform float u_nodeSize;       // @label(Node size) @range(0.02, 0.25) @default(0.16) @hint(Radius at each grid intersection — needs to be clearly larger than Line width to actually stand out from where two lines already cross.)
uniform vec3 u_nodeColor;       // @label(Node color) @color @default(1.0, 1.0, 1.0) @hint(Deliberately a distinct colour from the lines — otherwise a node at an intersection is just "a bit more of the same colour already there," which barely reads as a separate marker at all.)

uniform float u_warpAmount;     // @label(Warp amount) @range(0, 0.6) @default(0.28) @mod
uniform float u_warpScale;      // @label(Warp scale) @range(0.5, 5) @default(1.6) @mod
uniform float u_warpSpeed;      // @label(Warp speed) @range(0, 1.5) @default(0.25) @mod
uniform int u_flowDirection;    // @label(Flow direction) @select(Up=0 | Down=1 | Left=2 | Right=3) @strip @default(0)
uniform float u_perspective;    // @label(Perspective tilt) @range(0, 1) @default(0.35) @hint(Skews the grid toward a ground-plane read, like looking down at an angle.)

uniform vec3 u_lineColorLow;    // @label(Line color (low)) @color @default(0.0, 0.6, 1.0)
uniform vec3 u_lineColorHigh;   // @label(Line color (high)) @color @default(1.0, 0.2, 0.75)
uniform vec3 u_bg;              // @label(Background) @color @default(0.02, 0.02, 0.05)
uniform float u_glow;           // @label(Line glow) @range(0, 2) @default(0.8) @advanced

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
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

  // Fake ground-plane perspective: pixels lower on screen sample a
  // larger area (they're "further along the ground"), and the grid
  // compresses toward the top the way a real floor grid would in
  // perspective.
  float persp = mix(1.0, 1.0 + uv.y * 0.9, u_perspective);
  vec2 puv = uv * persp;

  // Height field: the actual surface this mesh is draped over. Sampled
  // once and reused for both the coordinate warp AND the shading, so the
  // displayed relief and the displayed colour always agree with each
  // other — a warped-but-flat-shaded grid would look like a decal, not
  // a surface.
  //
  // Flow direction: previously a fixed vec2(1,1)*time offset, which
  // moves the sampled pattern diagonally up-and-left always, with no way
  // to change that. Now an explicit direction vector selected by
  // u_flowDirection, so the flow can actually point any of the four
  // ways instead of one fixed diagonal.
  vec2 flowDir =
    u_flowDirection == 0 ? vec2(0.0, 1.0) :
    u_flowDirection == 1 ? vec2(0.0, -1.0) :
    u_flowDirection == 2 ? vec2(-1.0, 0.0) :
    vec2(1.0, 0.0);
  vec2 warpUv = puv * u_warpScale + flowDir * u_time * u_warpSpeed;
  float height = fbm(warpUv);

  // Displace the grid-sampling coordinate along the height gradient
  // (approximated via two offset samples) rather than displacing it
  // arbitrarily — this is what makes the lines actually follow the
  // height field's contours instead of just jittering independently of
  // what's being shaded.
  float hx = fbm(warpUv + vec2(0.05, 0.0));
  float hy = fbm(warpUv + vec2(0.0, 0.05));
  vec2 gradient = vec2(hx - height, hy - height) * 20.0;
  vec2 displaced = puv + gradient * u_warpAmount;

  vec2 grid = displaced * u_gridScale;
  vec2 gridFrac = fract(grid);
  // Distance to nearest LINE per axis: lines run along integer grid
  // coordinates (cell edges), so this is distance to the nearer of the
  // two edges bounding this cell in each axis — not distance to the
  // cell's own centre, which is what an earlier version of this
  // measured by mistake (cell = fract(grid) - 0.5; abs(cell)), putting
  // both the lines AND the nodes at cell centres instead of at the
  // actual grid intersections, which made the node toggle produce
  // almost no visible difference since it was drawing on top of where
  // the lines already were.
  vec2 distToEdge = min(gridFrac, 1.0 - gridFrac);
  float lineDist = min(distToEdge.x, distToEdge.y);

  float aa = length(fwidth(grid)) * 1.5 + 1e-4;
  float lineMask = 1.0 - smoothstep(u_lineWidth - aa, u_lineWidth + aa, lineDist);

  float nodeMask = 0.0;
  if (u_showNodes) {
    // Distance to the nearest actual grid INTERSECTION (both axes close
    // to an edge simultaneously), not the nearest edge in isolation —
    // this is what puts a node marker at each corner where lines cross,
    // rather than floating in the middle of a cell or smeared along an
    // entire edge.
    float nodeDist = length(distToEdge);
    nodeMask = 1.0 - smoothstep(u_nodeSize - aa, u_nodeSize + aa, nodeDist);
  }

  float mask = max(lineMask, nodeMask);

  vec3 lineCol = mix(u_lineColorLow, u_lineColorHigh, clamp(height, 0.0, 1.0));
  vec3 col = mix(u_bg, lineCol, lineMask);
  // Composited AFTER the line colour, as its own distinct colour, not
  // blended into lineCol — a node that's drawn in exactly the same
  // colour as the lines crossing at that point is nearly invisible as a
  // separate element even when its mask coverage is technically nonzero,
  // which is exactly what made the toggle read as "not doing anything."
  col = mix(col, u_nodeColor, nodeMask);

  // Soft glow around the lines, scaled by how close a pixel is without
  // actually being on one — reads as the mesh catching light along its
  // edges.
  float glowFalloff = 1.0 - smoothstep(0.0, u_lineWidth * 5.0, lineDist);
  col += lineCol * glowFalloff * u_glow * 0.3 * (1.0 - mask);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
