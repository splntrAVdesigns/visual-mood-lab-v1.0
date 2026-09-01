#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

uniform int   u_algorithm;   // @label(Algorithm) @select(Iso Cubes=0 | Y-Tribar Weave=1 | Fractal Subdivide=2) @default(0)
uniform int   u_baseShape;   // @label(Base Shape) @select(Triangle=0 | Square=1 | Hexagon=2) @default(0) @group(Fractal) @showIf(u_algorithm=2)
uniform int   u_faceStyle;   // @label(Face Style) @select(Solid=0 | Nested Diamond=1) @default(0) @group(Cubes) @showIf(u_algorithm=0)
uniform float u_scale;       // @label(Scale) @range(0.4, 1.8) @default(1.0)
uniform float u_stroke;      // @label(Stroke Weight) @range(0.2, 3.0) @default(1.0)
uniform int   u_depth;       // @label(Recursion Depth) @range(2, 7) @default(5) @group(Fractal) @showIf(u_algorithm=2)
uniform float u_fillRatio;   // @label(Fill Ratio) @range(0.3, 0.7) @default(0.5) @group(Fractal) @showIf(u_algorithm=2)
uniform float u_gap;         // @label(Gap) @range(0.0, 0.6) @default(0.0) @group(Cubes) @showIf(u_algorithm=0)
uniform float u_faceContrast;// @label(Face Contrast) @range(0.0, 1.0) @default(0.6) @group(Cubes) @showIf(u_algorithm=0)
uniform float u_weaveCurl;   // @label(Weave Curl) @range(0.0, 1.0) @default(0.65) @group(Weave) @showIf(u_algorithm=1)
uniform float u_layers;      // @label(Harmonic Layers) @range(1.0, 4.0) @default(1.0) @group(Weave) @showIf(u_algorithm=1)
uniform float u_rotation;    // @label(Rotation) @range(0.0, 360.0) @default(0.0) @group(Transform)
uniform float u_oscRate;     // @label(Oscillation Rate) @range(0.0, 2.0) @default(0.3) @group(Motion)
uniform float u_oscAmount;   // @label(Oscillation Amount) @range(0.0, 1.0) @default(0.3) @group(Motion)
uniform vec3  u_colorA;      // @label(Color A) @color @default(0.95, 0.95, 0.95) @group(Color)
uniform vec3  u_colorB;      // @label(Color B) @color @default(0.04, 0.04, 0.05) @group(Color)

out vec4 fragColor;

const float PI = 3.14159265;
const float PHI_INV = 0.618;

/* NOTE ON @showIf: this is the one syntax detail in this file I'm inferring
   rather than confirming — the docs I have name the feature but not its
   exact grammar. I've matched the `key=value` style your @select tag
   already uses (`@select(Grid=0 | Halftone=1)`), on the theory that's the
   most internally consistent guess. If parse-uniforms.ts expects different
   punctuation, every showIf tag in this file needs the same correction —
   worth confirming before assuming the grouping request from last round
   actually landed. */

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

/* A rhombus IS the unit ball of the L1 (taxicab) norm in a basis aligned
   with its own two diagonals — that's not an approximation, it's exact:
   every point on a rhombus boundary has |u|+|v|=1 in that basis, verified
   by hand at both vertex points and edge midpoints before writing this.
   The bug this replaces used length() (Euclidean/circular distance), which
   is why "nested diamond" rendered as literal circles — confirmed directly
   against the screenshot, this isn't a guess. */
float diamondDist(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d){
  vec2 center = (a + b + c + d) * 0.25;
  vec2 diag1 = c - a;
  vec2 diag2 = d - b;
  float len1 = length(diag1), len2 = length(diag2);
  vec2 dir1 = diag1 / max(0.0001, len1);
  vec2 dir2 = diag2 / max(0.0001, len2);
  vec2 rel = p - center;
  float u = dot(rel, dir1) / max(0.0001, len1 * 0.5);
  float v = dot(rel, dir2) / max(0.0001, len2 * 0.5);
  return abs(u) + abs(v);
}

/* ============================================================
   ISO CUBES */
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

  vec2 faceA, faceB, faceC, faceD;
  if(inTop){ faceA=topA; faceB=topB; faceC=topC; faceD=topD; }
  else if(inLeft){ faceA=leftA; faceB=leftB; faceC=leftC; faceD=leftD; }
  else { faceA=rightA; faceB=rightB; faceC=rightC; faceD=rightD; }

  float dd = diamondDist(local, faceA, faceB, faceC, faceD);

  if(faceStyle == 1){
    float ring = fract(dd * 5.0);
    float lineW = 0.05 * stroke;
    float line = 1.0 - smoothstep(0.0, lineW, min(ring, 1.0 - ring));
    return mix(colB, colA, line);
  }

  float faceMix = inTop ? 1.0 : (inLeft ? (1.0 - faceContrast*0.4) : (1.0 - faceContrast*0.85));
  vec3 faceCol = mix(colB, colA, faceMix);
  // thin inset edge so faces read as distinct facets rather than one flat hexagon
  float edgeLine = smoothstep(0.88, 1.0, dd);
  faceCol = mix(faceCol, colB, edgeLine * 0.45);
  return faceCol;
}

/* ============================================================
   Y-TRIBAR WEAVE — unchanged from last round (no new reports against its
   correctness this round beyond the general perf/UI audit). */
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
   FRACTAL SUBDIVIDE — coordinate handling rewritten to be fully explicit
   and self-contained rather than sharing the outer rotation pipeline.
   Two confirmed fixes: Scale previously had zero effect on this mode (it
   was computed in main() but never actually passed through — a plain
   omission, not a math error); and this rewrite applies rotation and
   scale directly to the fractal's own local coordinate rather than to a
   shared "uv" that also feeds the other two algorithms.
   I could not reproduce the reported "orbits around the frame edge"
   behavior through code review — a shape defined and rotated around a
   shared origin shouldn't be able to drift off-center, mathematically —
   so I'm not claiming this rewrite fixes that specific symptom with
   certainty. What it does fix for certain: Scale now works, and the
   coordinate handling is isolated enough that if the orbit bug persists,
   it's now much easier to tell whether the cause is in this function or
   upstream in the shared transform. */
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

vec3 fractalSubdivide(vec2 screenQ, int baseShape, int depth, float fillRatio, float scale, float rotation, vec3 colA, vec3 colB){
  // Explicit, local transform: rotate then scale the fractal's own sample
  // point, independent of anything computed for Iso Cubes / Y-Tribar.
  vec2 q = rot2(rotation * PI / 180.0) * screenQ;
  q = q / max(0.2, scale);

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

  float osc = sin(u_time * u_oscRate) * u_oscAmount;
  float rotationLive = u_rotation + osc * 25.0;
  float curlLive = clamp(u_weaveCurl + osc * 0.18, 0.0, 1.0);
  float scaleLive = u_scale * (1.0 + osc * 0.08);

  vec3 col;
  if(u_algorithm == 0){
    vec2 rotated = rot2(rotationLive * PI / 180.0) * uv;
    col = isoCubes(rotated * 100.0, scaleLive, u_gap, u_faceStyle, u_stroke, u_faceContrast, u_colorA, u_colorB);
  } else if(u_algorithm == 1){
    vec2 rotated = rot2(rotationLive * PI / 180.0) * uv;
    col = yTribarWeave(rotated * 100.0, scaleLive, u_stroke, curlLive, u_layers, u_colorA, u_colorB);
  } else {
    col = fractalSubdivide(uv, u_baseShape, u_depth, u_fillRatio, scaleLive, rotationLive, u_colorA, u_colorB);
  }

  fragColor = vec4(col, 1.0);
}
