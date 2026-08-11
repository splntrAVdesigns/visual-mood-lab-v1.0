#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;

// --- controls ---
uniform int u_pieces;         // @label(Debris Pieces) @range(2, 8) @default(5)
uniform float u_orbitRadius;  // @label(Orbit Radius) @range(0.5, 3) @default(1.6)
uniform float u_decayRate;    // @label(Decay Rate) @range(0, 1) @default(0.06) @mod
uniform float u_tumbleSpeed;  // @label(Tumble Speed) @range(0, 2) @default(0.7) @mod
uniform int u_debrisType;     // @label(Debris Type) @select(Boxes=0 | Shards=1 | Rings=2 | X-Mark=3 | Cylinder=4 | Peace=5 | Three Dots=6 | Mixed=7) @default(0)
uniform vec3 u_debrisColor;   // @label(Debris Color) @color @default(0.55, 0.6, 0.65)
uniform vec3 u_secondaryColor; // @label(Secondary Color) @color @default(0.75, 0.35, 0.2) @hint(Alternates per piece.)

out vec4 fragColor;

mat3 rotX(float a) {
  float s = sin(a), c = cos(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}
mat3 rotY(float a) {
  float s = sin(a), c = cos(a);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// A thin, elongated box — reads as a jagged shard rather than a block.
float sdShard(vec3 p, vec3 b) {
  return sdBox(p, vec3(b.x * 2.2, b.y * 0.35, b.z * 0.35));
}

float sdTorus(vec3 p, float r1, float r2) {
  vec2 q = vec2(length(p.xz) - r1, p.y);
  return length(q) - r2;
}

float sdCylinder(vec3 p, float r, float h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

vec3 rotZ(vec3 p, float a) {
  float s = sin(a), c = cos(a);
  return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
}

// Two crossed thin boxes in the local xy-plane.
float sdXMark(vec3 p, float scale) {
  vec3 thin = vec3(scale * 1.3, scale * 0.22, scale * 0.22);
  float a = sdBox(rotZ(p, 0.785398), thin);
  float b = sdBox(rotZ(p, -0.785398), thin);
  return min(a, b);
}

float sdSegment2D(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// A flattened "coin" peace sign: ring + three internal lines, clamped to a
// thin z-slab so it reads as a disc rather than a true 3D symbol.
float sdPeace(vec3 p, float scale) {
  float ring = abs(length(p.xy) - scale) - scale * 0.14;
  float vert = sdSegment2D(p.xy, vec2(0.0, -scale), vec2(0.0, scale)) - scale * 0.1;
  float diagA = sdSegment2D(p.xy, vec2(0.0, 0.0), vec2(-scale * 0.75, -scale * 0.65)) - scale * 0.1;
  float diagB = sdSegment2D(p.xy, vec2(0.0, 0.0), vec2(scale * 0.75, -scale * 0.65)) - scale * 0.1;
  float flat = min(ring, min(vert, min(diagA, diagB)));
  float zSlab = abs(p.z) - scale * 0.16;
  return max(flat, zSlab);
}

// Three small spheres in a triangular arrangement — reads as a futuristic
// crosshair / targeting reticle.
float sdThreeDots(vec3 p, float scale) {
  float r = scale * 0.32;
  float spacing = scale * 0.9;
  float a = length(p - vec3(0.0, spacing, 0.0)) - r;
  float b = length(p - vec3(-spacing * 0.87, -spacing * 0.5, 0.0)) - r;
  float c = length(p - vec3(spacing * 0.87, -spacing * 0.5, 0.0)) - r;
  return min(a, min(b, c));
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float sdPieceShape(int shapeType, vec3 lp, vec3 size) {
  if (shapeType == 1) return sdShard(lp, size);
  if (shapeType == 2) return sdTorus(lp, size.x * 1.1, size.y * 0.5);
  if (shapeType == 3) return sdXMark(lp, size.x);
  if (shapeType == 4) return sdCylinder(lp, size.x * 0.8, size.y * 1.4);
  if (shapeType == 5) return sdPeace(lp, size.x * 1.2);
  if (shapeType == 6) return sdThreeDots(lp, size.x * 1.6);
  return sdBox(lp, size);
}

float map(vec3 p) {
  float radius = u_orbitRadius * (0.75 + 0.25 * sin(u_time * u_decayRate + u_seed));
  float d = 1e5;
  for (int i = 0; i < 8; i++) {
    if (i >= u_pieces) break;
    float fi = float(i);
    float orbitAngle = u_time * (0.15 + 0.05 * fi) + fi * 2.4 + u_seed;
    vec3 center = radius * vec3(cos(orbitAngle), sin(orbitAngle * 0.6), sin(orbitAngle));

    vec3 lp = p - center;
    float tumble = u_time * u_tumbleSpeed * (0.5 + hash11(fi)) + fi * 5.0;
    lp = rotY(tumble) * rotX(tumble * 0.7) * lp;

    vec3 size = vec3(0.12 + 0.06 * hash11(fi + 1.0),
                      0.08 + 0.05 * hash11(fi + 2.0),
                      0.1 + 0.04 * hash11(fi + 3.0));

    int shapeType = u_debrisType;
    if (u_debrisType == 7) { // Mixed — pick per piece from all 7 shapes
      shapeType = int(floor(hash11(fi + 9.0) * 7.0));
    }

    float pieceDist = sdPieceShape(shapeType, lp, size);
    d = min(d, pieceDist);
  }
  return d;
}

// Duplicates map()'s loop to find which piece owns the surface at a hit
// point, so color can alternate per piece. A second pass at the single
// hit point is cheap next to the 64-step raymarch that found it.
float pieceMaterial(vec3 p) {
  float radius = u_orbitRadius * (0.75 + 0.25 * sin(u_time * u_decayRate + u_seed));
  float best = 1e5;
  float bestIdx = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= u_pieces) break;
    float fi = float(i);
    float orbitAngle = u_time * (0.15 + 0.05 * fi) + fi * 2.4 + u_seed;
    vec3 center = radius * vec3(cos(orbitAngle), sin(orbitAngle * 0.6), sin(orbitAngle));

    vec3 lp = p - center;
    float tumble = u_time * u_tumbleSpeed * (0.5 + hash11(fi)) + fi * 5.0;
    lp = rotY(tumble) * rotX(tumble * 0.7) * lp;

    vec3 size = vec3(0.12 + 0.06 * hash11(fi + 1.0),
                      0.08 + 0.05 * hash11(fi + 2.0),
                      0.1 + 0.04 * hash11(fi + 3.0));

    int shapeType = u_debrisType;
    if (u_debrisType == 7) shapeType = int(floor(hash11(fi + 9.0) * 7.0));

    float pieceDist = sdPieceShape(shapeType, lp, size);
    if (pieceDist < best) { best = pieceDist; bestIdx = fi; }
  }
  return mod(bestIdx, 2.0);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)
  ));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

  vec3 ro = vec3(0.0, 0.0, -4.0);
  vec3 rd = normalize(vec3(uv, 1.4));

  float t = 0.0;
  vec3 col = mix(vec3(0.01, 0.01, 0.015), vec3(0.04, 0.05, 0.07), length(uv));
  bool hit = false;

  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.001) { hit = true; break; }
    t += d;
    if (t > 12.0) break;
  }

  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    vec3 lightDir = normalize(vec3(0.5, 0.8, -0.4));
    float diff = clamp(dot(n, lightDir), 0.0, 1.0);
    float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.0);
    vec3 pieceColor = mix(u_debrisColor, u_secondaryColor, pieceMaterial(p));
    col = pieceColor * (0.15 + diff * 0.85) + vec3(0.3, 0.4, 0.5) * rim * 0.3;
  }

  fragColor = vec4(col, 1.0);
}
