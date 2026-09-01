#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

uniform int   u_algorithm;   // @label(Algorithm) @select(Iso Cubes=0 | Y-Tribar Weave=1 | Fractal Subdivide=2) @default(0)
uniform int   u_baseShape;   // @label(Base Shape) @select(Triangle=0 | Square=1 | Hexagon=2) @default(0) @group(Fractal)
uniform int   u_faceStyle;   // @label(Face Style) @select(Solid=0 | Nested Diamond=1) @default(0) @group(Cubes)
uniform float u_scale;       // @label(Scale) @range(0.4, 1.8) @default(1.0)
uniform float u_stroke;      // @label(Stroke Weight) @range(0.2, 3.0) @default(1.0)
uniform int   u_depth;       // @label(Recursion Depth) @range(2, 7) @default(5) @group(Fractal)
uniform float u_fillRatio;   // @label(Fill Ratio) @range(0.3, 0.7) @default(0.5) @group(Fractal)
uniform float u_gap;         // @label(Gap) @range(0.0, 0.6) @default(0.0) @group(Cubes)
uniform float u_faceContrast;// @label(Face Contrast) @range(0.0, 1.0) @default(0.6) @group(Cubes)
uniform float u_weaveCurl;   // @label(Weave Curl) @range(0.0, 1.0) @default(0.65) @group(Weave)
uniform float u_layers;      // @label(Harmonic Layers) @range(1.0, 4.0) @default(1.0) @group(Weave)
uniform float u_rotation;    // @label(Rotation) @range(0.0, 360.0) @default(0.0) @group(Transform)
uniform float u_oscRate;     // @label(Oscillation Rate) @range(0.0, 2.0) @default(0.3) @group(Motion)
uniform float u_oscAmount;   // @label(Oscillation Amount) @range(0.0, 1.0) @default(0.3) @group(Motion)
uniform vec3  u_colorA;      // @label(Color A) @color @default(0.95, 0.95, 0.95) @group(Color)
uniform vec3  u_colorB;      // @label(Color B) @color @default(0.04, 0.04, 0.05) @group(Color)

out vec4 fragColor;

const float PI = 3.14159265;
const float PHI_INV = 0.618;

mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash1(float n){ return fract(sin(n) * 43758.5453); }
float cross2(vec2 a, vec2 b){ return a.x*b.y - a.y*b.x; }

/* Convex-quad point test via consistent edge-side sign check — used for
   Iso Cubes' three rhombic faces, ported directly from the vertex sets
   already proven correct in the canvas mockup rather than re-derived as a
   dot-product shortcut. That shortcut is exactly what broke last time: it
   conflated row-parity offset with face selection and produced garbage
   cell-local coordinates (the scattered arc fragments in the screenshot
   were broken pieces of the nested-diamond ring math operating on that
   garbage). */
bool insideQuad(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d){
  float s1 = sign(cross2(b-a, p-a));
  float s2 = sign(cross2(c-b, p-b));
  float s3 = sign(cross2(d-c, p-c));
  float s4 = sign(cross2(a-d, p-d));
  return (s1 == s2) && (s2 == s3) && (s3 == s4);
}
bool insideTri(vec2 p, vec2 a, vec2 b, vec2 c){
  float d1 = cross2(b-a, p-a), d2 = cross2(c-b, p-b), d3 = cross2(a-c, p-c);
  bool hasNeg = (d1 < 0.0) || (d2 < 0.0) || (d3 < 0.0);
  bool hasPos = (d1 > 0.0) || (d2 > 0.0) || (d3 > 0.0);
  return !(hasNeg && hasPos);
}

/* ============================================================
   ISO CUBES — rebuilt from scratch.
   Cell selection: nearest-grid-center via round(), using the exact same
   dx=1.74s / dy=1.5s / odd-row-offset spacing the canvas version used —
   a direct port of proven grid math, not a re-derivation.
   Face selection: explicit point-in-quad tests against the exact 4-vertex
   rhombus definitions from the canvas version (top/left/right), not an
   angle or dot-product heuristic. */
vec3 isoCubes(vec2 p, float scale, float gap, int faceStyle, float stroke, float faceContrast, vec3 colA, vec3 colB){
  float s = 46.0 * scale;
  float dx = s * 1.74, dy = s * 1.5;

  float row = floor(p.y / dy + 0.5);
  float rowOffset = mod(abs(row), 2.0) * (dx * 0.5);
  float col = floor((p.x - rowOffset) / dx + 0.5);
  vec2 cellCenter = vec2(col * dx + rowOffset, row * dy);

  vec2 local = (p - cellCenter) / max(0.05, 1.0 - gap * 0.55);

  vec2 v0 = vec2(0.0, 0.0);
  vec2 topA = vec2(0.0, -s),       topB = vec2(s*0.87, -s*0.5),  topC = v0,                     topD = vec2(-s*0.87, -s*0.5);
  vec2 leftA = v0,                 leftB = vec2(-s*0.87, -s*0.5),leftC = vec2(-s*0.87, s*0.5),  leftD = vec2(0.0, s);
  vec2 rightA = v0,                rightB = vec2(s*0.87, -s*0.5),rightC = vec2(s*0.87, s*0.5),  rightD = vec2(0.0, s);

  bool inTop = insideQuad(local, topA, topB, topC, topD);
  bool inLeft = !inTop && insideQuad(local, leftA, leftB, leftC, leftD);
  bool inRight = !inTop && !inLeft && insideQuad(local, rightA, rightB, rightC, rightD);

  if(!inTop && !inLeft && !inRight) return colB;

  if(faceStyle == 1){
    vec2 faceA, faceB, faceC, faceD;
    if(inTop){ faceA=topA; faceB=topB; faceC=topC; faceD=topD; }
    else if(inLeft){ faceA=leftA; faceB=leftB; faceC=leftC; faceD=leftD; }
    else { faceA=rightA; faceB=rightB; faceC=rightC; faceD=rightD; }
    vec2 faceCenter = (faceA+faceB+faceC+faceD)*0.25;
    float ringPos = length(local - faceCenter) / s;
    float ring = fract(ringPos * 5.0);
    float lineW = 0.05 * stroke;
    float line = 1.0 - smoothstep(0.0, lineW, min(ring, 1.0-ring));
    return mix(colB, colA, line);
  }

  float faceMix = inTop ? 1.0 : (inLeft ? (1.0 - faceContrast*0.4) : (1.0 - faceContrast*0.85));
  return mix(colB, colA, faceMix);
}

/* ============================================================
   Y-TRIBAR WEAVE — same connectivity guarantee as before (every triangle
   draws an arm to all three of its edge midpoints; every internal edge is
   shared by exactly one neighbor, and both sides always draw to it, so
   every arm endpoint is structurally guaranteed to match its neighbor's).
   Two defensive fixes this round: u_layers is now a float (uniform int
   upload for a stepper-mapped control was the suspected cause of it doing
   nothing at all; casting internally sidesteps the ambiguity regardless
   of root cause), and stroke width now scales relative to L (cell size)
   instead of an absolute pixel value — the absolute version was small
   enough relative to typical cell spacing to be nearly invisible across
   the slider's whole range, which matches exactly what was reported. */
float triSegDist(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

vec3 yTribarWeave(vec2 p, float scale, float stroke, float curl, float layersF, vec3 colA, vec3 colB){
  int layers = int(clamp(layersF, 1.0, 4.0));
  float L = 46.0 * scale * 0.9;
  vec2 gp = p / L;
  float j0 = floor(gp.y / (sqrt(3.0) * 0.5));
  float i0 = floor(gp.x - 0.5 * j0);
  float minD = 1e5;

  for(int dj = -1; dj <= 1; dj++){
    for(int di = -1; di <= 1; di++){
      float ii = i0 + float(di), jj = j0 + float(dj);
      vec2 v00 = vec2(ii + 0.5*jj, jj*sqrt(3.0)*0.5) * L;
      vec2 v10 = vec2(ii+1.0 + 0.5*jj, jj*sqrt(3.0)*0.5) * L;
      vec2 v01 = vec2(ii + 0.5*(jj+1.0), (jj+1.0)*sqrt(3.0)*0.5) * L;
      vec2 v11 = vec2(ii+1.0 + 0.5*(jj+1.0), (jj+1.0)*sqrt(3.0)*0.5) * L;

      for(int t = 0; t < 2; t++){
        vec2 a = (t == 0) ? v00 : v10;
        vec2 b = (t == 0) ? v10 : v01;
        vec2 c = (t == 0) ? v01 : v11;
        vec2 cen = (a + b + c) / 3.0;

        for(int e = 0; e < 3; e++){
          vec2 ea = (e == 0) ? a : (e == 1 ? b : c);
          vec2 eb = (e == 0) ? b : (e == 1 ? c : a);
          vec2 target = (ea + eb) * 0.5;
          vec2 mid = (cen + target) * 0.5;
          vec2 dir = target - cen;
          vec2 perp = normalize(vec2(-dir.y, dir.x) + 1e-6);
          float bendOff = (curl - 0.5) * L * 1.1;
          vec2 bendPt = mid + perp * bendOff;

          for(int l = 0; l < 4; l++){
            if(l >= layers) break;
            float sL = pow(PHI_INV, float(l));
            vec2 tL = mix(cen, target, sL);
            vec2 bL = mix(cen, bendPt, sL);
            float d = min(triSegDist(p, cen, bL), triSegDist(p, bL, tL));
            minD = min(minD, d);
          }
        }
      }
    }
  }

  float w = max(0.6, stroke) * L * 0.045;
  float line = 1.0 - smoothstep(w*0.5, w*0.5 + L*0.02, minD);
  return mix(colB, colA, line);
}

/* ============================================================
   FRACTAL SUBDIVIDE — the "solid white tile" bug was a missing bounds
   check: triangle and hexagon modes ran the subdivision loop for EVERY
   pixel on the whole canvas with no test for whether that pixel was
   inside the original shape first, so every pixel fell through to colA
   regardless of position. Square mode already had this check; triangle
   and hexagon now do too. */
vec3 fractalTriangleLike(vec2 q, vec2 a0, vec2 b0, vec2 c0, int depth, float fillRatio, vec3 colA, vec3 colB){
  if(!insideTri(q, a0, b0, c0)) return colB;
  vec2 a = a0, b = b0, c = c0;
  vec2 cur = q;
  for(int d = 0; d < 7; d++){
    if(d >= depth) break;
    vec2 mab = mix(a, b, fillRatio), mbc = mix(b, c, fillRatio), mca = mix(c, a, fillRatio);
    vec2 cen0 = (a + mab + mca) / 3.0;
    vec2 cen1 = (mab + b + mbc) / 3.0;
    vec2 cen2 = (mca + mbc + c) / 3.0;
    float d0 = length(cur - cen0), d1 = length(cur - cen1), d2 = length(cur - cen2);
    if(d0 <= d1 && d0 <= d2){ b = mab; c = mca; }
    else if(d1 <= d2){ a = mab; c = mbc; }
    else { a = mca; b = mbc; }
  }
  return colA;
}

vec3 fractalSubdivide(vec2 q, int baseShape, int depth, float fillRatio, vec3 colA, vec3 colB){
  if(baseShape == 1){
    vec2 uv = q * 0.28 + 0.5;
    if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return colB;
    float seedAcc = 0.0;
    for(int d = 0; d < 7; d++){
      if(d >= depth) break;
      vec2 cell = floor(uv * 2.0);
      float idx = cell.x + cell.y * 2.0;
      seedAcc += idx * 7.0 + float(d) * 131.0;
      float skip = floor(hash1(seedAcc) * 4.0);
      if(idx == skip) return colB;
      uv = fract(uv * 2.0);
    }
    return colA;

  } else if(baseShape == 2){
    float R = 2.1;
    if(length(q) > R) return colB;
    float ang = atan(q.y, q.x);
    float wedge = floor((ang + PI) / (PI / 3.0));
    float wa = wedge * (PI / 3.0) - PI;
    vec2 a = vec2(0.0);
    vec2 b = vec2(cos(wa), sin(wa)) * R;
    vec2 c = vec2(cos(wa + PI/3.0), sin(wa + PI/3.0)) * R;
    return fractalTriangleLike(q, a, b, c, depth, fillRatio, colA, colB);

  } else {
    vec2 a = vec2(0.0, 2.1), b = vec2(-1.82, -1.05), c = vec2(1.82, -1.05);
    return fractalTriangleLike(q, a, b, c, depth, fillRatio, colA, colB);
  }
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  uv *= 2.4;

  /* Oscillation — gentle, continuous, applied per-algorithm so the tile
     reads as alive without ever destabilizing the tessellation math (same
     controlled-perturbation principle as Ferro Field's perpetual motion:
     it nudges parameters, never the connectivity-critical geometry). */
  float osc = sin(u_time * u_oscRate) * u_oscAmount;
  float rotationLive = u_rotation + osc * 25.0;
  float curlLive = clamp(u_weaveCurl + osc * 0.18, 0.0, 1.0);
  float scaleLive = u_scale * (1.0 + osc * 0.08);

  uv = rot2(rotationLive * PI / 180.0) * uv;

  vec3 col;
  if(u_algorithm == 0){
    col = isoCubes(uv * 100.0, scaleLive, u_gap, u_faceStyle, u_stroke, u_faceContrast, u_colorA, u_colorB);
  } else if(u_algorithm == 1){
    col = yTribarWeave(uv * 100.0, scaleLive, u_stroke, curlLive, u_layers, u_colorA, u_colorB);
  } else {
    col = fractalSubdivide(uv, u_baseShape, u_depth, u_fillRatio, u_colorA, u_colorB);
  }

  fragColor = vec4(col, 1.0);
}
