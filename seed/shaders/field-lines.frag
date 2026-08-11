#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
// Host-fed pointer position — assumed 0-1 UV space matching every other
// coordinate convention in this codebase (see gl_FragCoord/u_resolution
// usage throughout). Not yet confirmed against a working reference shader,
// since this is the first seed asset to use it. If the bend appears
// offset or inverted once deployed, this assumption is the first place to
// check — same kind of one-line fix as Digital Matrix's flow direction.
uniform vec2 u_pointer;

// --- controls ---
uniform int u_density;        // @label(Grid Density) @range(8, 48) @default(20)
uniform float u_lineLength;   // @label(Line Length) @range(0.005, 0.05) @default(0.018)
uniform float u_bendStrength; // @label(Bend Strength) @range(0, 3) @default(1.2) @mod
uniform float u_fieldRadius;  // @label(Field Radius) @range(0.1, 1.5) @default(0.6) @mod
uniform int u_polarity;       // @label(Polarity) @select(Attract=0 | Repel=1) @default(0)
uniform float u_lineWidth;    // @label(Line Width) @range(0.0005, 0.004) @default(0.0015)
uniform vec3 u_lineColor;     // @label(Line Color) @color @default(0.0, 0.83, 1.0)
uniform float u_glow;         // @label(Glow) @range(0, 1) @default(0.4)

out vec4 fragColor;

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  vec2 pointer = (u_pointer - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

  vec2 grid = uv * float(u_density);
  vec2 cellId = floor(grid);
  vec2 cellCenter = (cellId + 0.5) / float(u_density);
  cellCenter = (cellCenter - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

  vec2 toPointer = pointer - cellCenter;
  float dist = length(toPointer);
  float influence = smoothstep(u_fieldRadius, 0.0, dist) * u_bendStrength;

  // Base orientation: a gentle static swirl so the grid isn't just a flat
  // field of horizontal dashes when nothing is nearby.
  float baseAngle = sin(cellId.x * 0.4 + u_seed) * 0.3 + cos(cellId.y * 0.4 + u_seed * 1.3) * 0.3;

  float pointerAngle = atan(toPointer.y, toPointer.x);
  if (u_polarity == 1) pointerAngle += 3.14159265; // Repel — line points away instead of toward

  float angle = mix(baseAngle, pointerAngle, clamp(influence, 0.0, 1.0));

  vec2 dir = vec2(cos(angle), sin(angle)) * u_lineLength * (1.0 + influence * 0.6);
  vec2 a = cellCenter - dir;
  vec2 b = cellCenter + dir;

  float d = sdSegment(uv, a, b);
  float line = smoothstep(u_lineWidth, 0.0, d);
  float glow = smoothstep(u_lineWidth * 8.0, 0.0, d) * u_glow;

  vec3 col = u_lineColor * (line + glow * 0.5);

  fragColor = vec4(col, 1.0);
}
