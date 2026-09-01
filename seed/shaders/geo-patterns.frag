#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

// ===== GLOBAL (applies across all algorithms) =====
uniform int   u_algorithm;   // @label(Algorithm) @select(Iso Cubes=0 | Y-Tribar Weave=1 | Fractal Subdivide=2) @default(0) @group(Global)
uniform float u_scale;       // @label(Scale) @range(0.4, 1.8) @default(1.0) @group(Global)
uniform float u_stroke;      // @label(Stroke Weight) @range(0.2, 3.0) @default(1.0) @group(Global)
uniform float u_rotation;    // @label(Rotation) @range(0.0, 360.0) @default(0.0) @group(Global)
uniform float u_oscRate;     // @label(Oscillation Rate) @range(0.0, 2.0) @default(0.3) @group(Global)
uniform float u_oscAmount;   // @label(Oscillation Amount) @range(0.0, 1.0) @default(0.3) @group(Global)

// ===== COLOR =====
uniform vec3  u_colorA;      // @label(Color A) @color @default(0.95, 0.95, 0.95) @group(Color)
uniform vec3  u_colorB;      // @label(Color B) @color @default(0.04, 0.04, 0.05) @group(Color)

// ===== CUBES (Iso Cubes only) =====
uniform int   u_faceStyle;    // @label(Face Style) @select(Solid=0 | Nested Diamond=1) @default(0) @group(Cubes) @showIf(u_algorithm=0)
uniform float u_gap;          // @label(Gap) @range(0.0, 0.6) @default(0.0) @group(Cubes) @showIf(u_algorithm=0)
uniform float u_faceContrast; // @label(Face Contrast) @range(0.0, 1.0) @default(0.6) @group(Cubes) @showIf(u_algorithm=0)
uniform float u_bevelStrength;// @label(Bevel Strength) @range(0.0, 1.0) @default(0.4) @group(Cubes) @showIf(u_algorithm=0)
uniform float u_facetDetail;  // @label(Facet Detail) @range(0.0, 1.0) @default(0.3) @group(Cubes) @showIf(u_algorithm=0)

// ===== WEAVE (Y-Tribar only) =====
uniform float u_weaveCurl;   // @label(Weave Curl) @range(0.0, 1.0) @default(0.65) @group(Weave) @showIf(u_algorithm=1)
uniform float u_layers;      // @label(Harmonic Layers) @range(1.0, 4.0) @default(1.0) @group(Weave) @showIf(u_algorithm=1)
uniform int   u_weaveStyle;  // @label(Weave Style) @select(Chevron=0 | S-Curve=1) @default(0) @group(Weave) @showIf(u_algorithm=1)
uniform float u_armTaper;    // @label(Arm Taper) @range(0.0, 1.0) @default(0.0) @group(Weave) @showIf(u_algorithm=1)

// ===== FRACTAL (Fractal Subdivide only) =====
uniform int   u_baseShape;   // @label(Base Shape) @select(Triangle=0 | Square=1 | Hexagon=2) @default(0) @group(Fractal) @showIf(u_algorithm=2)
uniform int   u_depth;       // @label(Recursion Depth) @range(2, 7) @default(5) @group(Fractal) @showIf(u_algorithm=2)
uniform float u_fillRatio;   // @label(Fill Ratio) @range(0.3, 0.7) @default(0.5) @group(Fractal) @showIf(u_algorithm=2)

out vec4 fragColor;

const float PI = 3.14159265;
const float PHI_INV = 0.618;

mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash1(float n){ return fract(sin(n) * 43758.5453); }
float cross2(vec2 a, vec2 b){ return a.x*b.y - a.y*b.x; }

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
float diamondDist(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d){
  vec2 center = (a + b + c + d) * 0.25;
  vec2 diag1 = c - a, diag2 = d - b;
  float len1 = length(diag1), len2 = length(diag2);
  vec2 dir1 = diag1 / max(0.0001, len1), dir2 = diag2 / max(0.0001, len2);
  vec2 rel = p - center;
  float u = dot(rel, dir1) / max(0.0001, len1 * 0.5);
  float v = dot(rel, dir2) / max(0.0001, len2 * 0.5);
  return abs(u) + abs(v);
}

/* ============================================================
   ISO CUBES
   Gap fix: the previous version shrank the query point uniformly around
   the shared cube-local origin (0,0) — but that point is only a shared
   VERTEX of all three rhombic faces, not any individual face's own
   center. Scaling toward a point that isn't a shape's centroid distorts
   it asymmetrically, which is exactly the "corners cut off on two sides"
   report. Fixed by determining face membership at full size first, then
   shrinking relative to THAT face's own centroid specifically. */
vec3 isoCubes(vec2 p, float scale, float gap, int faceStyle, float stroke, float faceContrast, float bevelStrength, float facetDetail, vec3 colA, vec3 colB){
  float s = 46.0 * scale;
  float dx = s * 1.74, dy = s * 1.5;

  float row = floor(p.y / dy + 0.5);
  float rowOffset = mod(abs(row), 2.0) * (dx * 0.5);
  float col = floor((p.x - rowOffset) / dx + 0.5);
  vec2 cellCenter = vec2(col * dx + rowOffset, row * dy);
  vec2 local = p - cellCenter;

  vec2 v0 = vec2(0.0, 0.0);
  vec2 topA = vec2(0.0, -s),       topB = vec2(s*0.87, -s*0.5),  topC = v0,                     topD = vec2(-s*0.87, -s*0.5);
  vec2 leftA = v0,                 leftB = vec2(-s*0.87, -s*0.5),leftC = vec2(-s*0.87, s*0.5),  leftD = vec2(0.0, s);
  vec2 rightA = v0,                rightB = vec2(s*0.87, -s*0.5),rightC = vec2(s*0.87, s*0.5),  rightD = vec2(0.0, s);

  bool inTop = insideQuad(local, topA, topB, topC, topD);
  bool inLeft = !inTop && insideQuad(local, leftA, leftB, leftC, leftD);
  bool inRight = !inTop && !inLeft && insideQuad(local, rightA, rightB, rightC, rightD);
  if(!inTop && !inLeft && !inRight) return colB;

  vec2 faceA, faceB, faceC, faceD;
  if(inTop){ faceA=topA; faceB=topB; faceC=topC; faceD=topD; }
  else if(inLeft){ faceA=leftA; faceB=leftB; faceC=leftC; faceD=leftD; }
  else { faceA=rightA; faceB=rightB; faceC=rightC; faceD=rightD; }

  vec2 faceCenter = (faceA + faceB + faceC + faceD) * 0.25;
  float shrink = max(0.05, 1.0 - gap * 0.55);
  vec2 localShrunk = faceCenter + (local - faceCenter) / shrink;
  if(!insideQuad(localShrunk, faceA, faceB, faceC, faceD)) return colB;

  float dd = diamondDist(localShrunk, faceA, faceB, faceC, faceD);
  float facetRings = fract(dd * mix(2.0, 10.0, facetDetail));
  float facetLine = 1.0 - smoothstep(0.0, 0.04, min(facetRings, 1.0 - facetRings));
  float faceMix = inTop ? 1.0 : (inLeft ? (1.0 - faceContrast*(0.4+bevelStrength*0.3)) : (1.0 - faceContrast*(0.85+bevelStrength*0.1)));
  faceMix = clamp(faceMix, 0.0, 1.0);

  if(faceStyle == 1){
    // Nested Diamond: previous version drew rings using raw colA/colB with
    // no reference to faceMix at all, which is why Face Contrast had zero
    // effect in this mode and the result read as "barely visible" (thin
    // lines directly on colB with no fill underneath). Now tints the face
    // background with the same faceMix logic Solid mode uses, then draws
    // rings on top of that.
    float ring = fract(dd * 5.0);
    float lineW = 0.05 * stroke;
    float line = 1.0 - smoothstep(0.0, lineW, min(ring, 1.0 - ring));
    vec3 bgTint = mix(colB, mix(colB, colA, faceMix), 0.4);
    vec3 outCol = mix(bgTint, colA, line);
    outCol = mix(outCol, colA, facetLine * 0.15);
    return outCol;
  }

  vec3 faceCol = mix(colB, colA, faceMix);
  float edgeLine = smoothstep(0.88, 1.0, dd);
  faceCol = mix(faceCol, colB, edgeLine * (0.3 + bevelStrength * 0.4));
  faceCol = mix(faceCol, colA, facetLine * 0.08 * bevelStrength);
  return faceCol;
}

/* ============================================================
   Y-TRIBAR WEAVE — connectivity guarantee unchanged (every triangle
   still draws to all three of its own edge midpoints, both sides of every
   shared edge always draw to it). Two additions, both applied only to
   the control-point path between center and endpoint, never to the
   endpoint itself, so neither can break the tessellation: Weave Style
   swaps the single sharp bend for a two-point S-curve; Arm Taper varies
   stroke width by (approximate) distance from cell center. */
float triSegDist(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

vec3 yTribarWeave(vec2 p, float scale, float stroke, float curl, float layersF, int weaveStyle, float armTaper, vec3 colA, vec3 colB){
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
            float d;
            if(weaveStyle == 1){
              vec2 bendPt2 = mix(bendPt, target, 0.5) + perp * bendOff * 0.4;
              vec2 tL = mix(cen, target, sL);
              vec2 bL = mix(cen, bendPt, sL);
              vec2 bL2 = mix(cen, bendPt2, sL);
              d = min(triSegDist(p, cen, bL), min(triSegDist(p, bL, bL2), triSegDist(p, bL2, tL)));
            } else {
              vec2 tL = mix(cen, target, sL);
              vec2 bL = mix(cen, bendPt, sL);
              d = min(triSegDist(p, cen, bL), triSegDist(p, bL, tL));
            }
            minD = min(minD, d);
          }
        }
      }
    }
  }

  vec2 cellFrac = fract(gp) - 0.5;
  float centerProx = 1.0 - clamp(length(cellFrac) * 1.5, 0.0, 1.0);
  float taperMul = mix(1.0, 0.5 + 0.5 * centerProx, armTaper);

  float w = max(0.6, stroke) * L * 0.045 * taperMul;
  float line = 1.0 - smoothstep(w*0.5, w*0.5 + L*0.02, minD);
  return mix(colB, colA, line);
}

/* ============================================================
   FRACTAL SUBDIVIDE — Triangle/Hexagon Sierpinski algorithm was simply
   wrong, not mistuned: real Sierpinski subdivision requires EXCLUDING the
   middle sub-triangle at every level (that's what creates the holes).
   The previous version never tested for that — it always picked the
   nearest of the 3 corner sub-triangles by centroid distance and
   recursed into it, meaning every point eventually resolved to solid
   fill with zero holes, at every depth and fill ratio. That's exactly
   what the "solid blue triangle" screenshot showed. Fixed with the
   textbook algorithm: test the middle triangle first and return
   background immediately if inside it; otherwise determine which of the
   three CORNER triangles actually contains the point and recurse into
   only that one. Square mode already had correct exclusion logic and is
   unchanged.
   Also: all three base shapes sized down about 20% from last round as a
   safety margin against a rotated square's diagonal extent exceeding the
   frame — a square's corner-to-corner distance is ~1.41x its edge-to-edge
   distance, so a shape sized to just fit axis-aligned will clip its own
   corners at 45°/135° rotation. That's a real, separate contributor to
   "sits at the edge" regardless of the coordinate-transform question,
   and cheap to rule out. */
vec3 fractalTriangleLike(vec2 q, vec2 a0, vec2 b0, vec2 c0, int depth, float fillRatio, vec3 colA, vec3 colB){
  if(!insideTri(q, a0, b0, c0)) return colB;
  vec2 a = a0, b = b0, c = c0;
  for(int d = 0; d < 7; d++){
    if(d >= depth) break;
    vec2 mab = mix(a, b, fillRatio), mbc = mix(b, c, fillRatio), mca = mix(c, a, fillRatio);
    if(insideTri(q, mab, mbc, mca)) return colB;
    if(insideTri(q, a, mab, mca)){ b = mab; c = mca; }
    else if(insideTri(q, mab, b, mbc)){ a = mab; c = mbc; }
    else { a = mca; b = mbc; }
  }
  return colA;
}

vec3 fractalSubdivide(vec2 screenQ, int baseShape, int depth, float fillRatio, float scale, float rotation, vec3 colA, vec3 colB){
  vec2 q = rot2(rotation * PI / 180.0) * screenQ;
  q = q / max(0.2, scale);

  if(baseShape == 1){
    vec2 uv = q * 0.225 + 0.5;
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
    float R = 1.7;
    if(length(q) > R) return colB;
    float ang = atan(q.y, q.x);
    float wedge = floor((ang + PI) / (PI / 3.0));
    float wa = wedge * (PI / 3.0) - PI;
    vec2 a = vec2(0.0);
    vec2 b = vec2(cos(wa), sin(wa)) * R;
    vec2 c = vec2(cos(wa + PI/3.0), sin(wa + PI/3.0)) * R;
    return fractalTriangleLike(q, a, b, c, depth, fillRatio, colA, colB);

  } else {
    vec2 a = vec2(0.0, 1.7), b = vec2(-1.47, -0.85), c = vec2(1.47, -0.85);
    return fractalTriangleLike(q, a, b, c, depth, fillRatio, colA, colB);
  }
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  uv *= 2.4;

  float osc = sin(u_time * u_oscRate) * u_oscAmount;
  float rotationLive = u_rotation + osc * 25.0;
  float curlLive = clamp(u_weaveCurl + osc * 0.18, 0.0, 1.0);
  float scaleLive = u_scale * (1.0 + osc * 0.08);

  vec3 col;
  if(u_algorithm == 0){
    vec2 rotated = rot2(rotationLive * PI / 180.0) * uv;
    col = isoCubes(rotated * 100.0, scaleLive, u_gap, u_faceStyle, u_stroke, u_faceContrast, u_bevelStrength, u_facetDetail, u_colorA, u_colorB);
  } else if(u_algorithm == 1){
    vec2 rotated = rot2(rotationLive * PI / 180.0) * uv;
    col = yTribarWeave(rotated * 100.0, scaleLive, u_stroke, curlLive, u_layers, u_weaveStyle, u_armTaper, u_colorA, u_colorB);
  } else {
    col = fractalSubdivide(uv, u_baseShape, u_depth, u_fillRatio, scaleLive, rotationLive, u_colorA, u_colorB);
  }

  fragColor = vec4(col, 1.0);
}
