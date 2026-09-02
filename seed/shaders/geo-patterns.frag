#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

// ===== GLOBAL =====
uniform int   u_algorithm;   // @label(Algorithm) @select(Iso Cubes=0 | Y-Tribar Weave=1 | Fractal Subdivide=2) @default(0) @group(Global)
uniform float u_scale;       // @label(Scale) @range(0.4, 1.8) @default(1.0) @group(Global)
uniform float u_stroke;      // @label(Stroke Weight) @range(0.2, 3.0) @default(1.0) @group(Global)
uniform float u_rotation;    // @label(Rotation) @range(0.0, 360.0) @default(0.0) @group(Global)
uniform float u_oscRate;     // @label(Oscillation Rate) @range(0.0, 2.0) @default(0.0) @group(Global)
uniform float u_oscAmount;   // @label(Oscillation Amount) @range(0.0, 1.0) @default(0.0) @group(Global)

// ===== COLOR =====
uniform vec3  u_colorA;      // @label(Color A) @color @default(0.95, 0.95, 0.95) @group(Color)
uniform vec3  u_colorB;      // @label(Color B) @color @default(0.04, 0.04, 0.05) @group(Color)

// ===== CUBES =====
uniform int   u_faceStyle;    // @label(Face Style) @select(Solid=0 | Nested Diamond=1 | Hatched=2) @default(0) @group(Cubes) @showIf(u_algorithm=0)
uniform float u_gap;          // @label(Gap) @range(0.0, 0.6) @default(0.0) @group(Cubes) @showIf(u_algorithm=0)
uniform float u_faceContrast; // @label(Face Contrast) @range(0.0, 1.0) @default(0.6) @group(Cubes) @showIf(u_algorithm=0)
uniform float u_bevelStrength;// @label(Bevel Strength) @range(0.0, 1.0) @default(0.4) @group(Cubes) @showIf(u_algorithm=0)
uniform float u_facetDetail;  // @label(Facet Detail) @range(0.0, 1.0) @default(0.3) @group(Cubes) @showIf(u_algorithm=0)

// ===== WEAVE =====
uniform float u_weaveCurl;   // @label(Weave Curl) @range(0.0, 1.0) @default(0.65) @group(Weave) @showIf(u_algorithm=1)
uniform float u_layers;      // @label(Harmonic Layers) @range(1.0, 4.0) @default(1.0) @group(Weave) @showIf(u_algorithm=1)
uniform int   u_weaveStyle;  // @label(Weave Style) @select(Chevron=0 | S-Curve=1 | Diamond=2) @default(0) @group(Weave) @showIf(u_algorithm=1)
uniform float u_armTaper;    // @label(Arm Taper) @range(0.0, 1.0) @default(0.0) @group(Weave) @showIf(u_algorithm=1)

// ===== FRACTAL =====
uniform int   u_baseShape;   // @label(Base Shape) @select(Triangle=0 | Square=1 | Hexagon=2) @default(0) @group(Fractal) @showIf(u_algorithm=2)
uniform int   u_depth;       // @label(Recursion Depth) @range(2, 7) @default(5) @group(Fractal) @showIf(u_algorithm=2)
uniform float u_fillRatio;   // @label(Fill Ratio) @range(0.3, 0.7) @default(0.5) @group(Fractal) @showIf(u_algorithm=2)
uniform float u_tiling;      // @label(Tiling) @range(1.0, 6.0) @default(1.0) @group(Fractal) @showIf(u_algorithm=2)
uniform bool  u_tilingInvert;// @label(Invert Tiling) @default(false) @group(Fractal) @showIf(u_algorithm=2)

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
   Cell selection rebuilt as a genuine nearest-neighbor search. The prior
   version picked a cell via independent row-then-column rounding, which
   is only valid for a plain grid — this is a row-offset brick pattern,
   where the true nearest cell center near a diagonal boundary can belong
   to a different row than the naive formula assumes. That mismatch is
   consistent with exactly the reported symptom: a diagonal seam where
   some pixels render as part of the wrong, more-distant cube. This checks
   three candidate rows and picks whichever center is actually closest by
   real distance, the same "check real neighbors, don't assume the
   formula" principle already proven correct in Y-Tribar Weave. */
vec2 nearestCubeCenter(vec2 p, float dx, float dy){
  float rowGuess = p.y / dy;
  float bestDist = 1e18;
  vec2 bestCenter = vec2(0.0);
  for(int dr = -1; dr <= 1; dr++){
    float row = floor(rowGuess + 0.5) + float(dr);
    float rowOffset = mod(abs(row), 2.0) * dx * 0.5;
    float col = floor((p.x - rowOffset) / dx + 0.5);
    vec2 center = vec2(col * dx + rowOffset, row * dy);
    float d = length(p - center);
    if(d < bestDist){ bestDist = d; bestCenter = center; }
  }
  return bestCenter;
}

vec3 isoCubes(vec2 p, float scale, float gap, int faceStyle, float stroke, float faceContrast, float bevelStrength, float facetDetail, vec3 colA, vec3 colB){
  float s = 46.0 * scale;
  float dx = s * 1.74, dy = s * 1.5;
  vec2 cellCenter = nearestCubeCenter(p, dx, dy);
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

  // Real stroke-controlled outline, now present in BOTH face styles —
  // previously u_stroke was only read inside the Nested Diamond branch,
  // which is exactly why it had no effect on the far more common Solid
  // mode. This draws an actual outline whose width tracks the slider.
  float strokeW = mix(0.015, 0.09, clamp(stroke / 3.0, 0.0, 1.0));
  float outline = 1.0 - smoothstep(1.0 - strokeW*2.0, 1.0 - strokeW*0.4, dd);
  float outlineMask = 1.0 - outline; // 1 = outline pixel

  float facetRings = fract(dd * mix(2.0, 12.0, facetDetail));
  // Facet Detail was previously multiplied by 0.08 AND gated by an
  // unrelated slider (bevelStrength), which capped its visible effect at
  // roughly 3% blend regardless of setting — confirmed dead-weak, not a
  // tuning issue. Now a real, independently-controlled line overlay.
  float facetLine = (1.0 - smoothstep(0.0, 0.035, min(facetRings, 1.0 - facetRings))) * facetDetail;

  if(faceStyle == 1){
    float ring = fract(dd * 5.0);
    float lineW = 0.05 * mix(0.4, 1.6, clamp(stroke/2.0, 0.0, 1.0));
    float line = 1.0 - smoothstep(0.0, lineW, min(ring, 1.0 - ring));
    float faceMix = inTop ? 1.0 : (inLeft ? (1.0 - faceContrast*0.4) : (1.0 - faceContrast*0.85));

    // Bevel Strength now applies here too, identically to the Solid-mode
    // math below — previously this branch returned before bevelStrength
    // was ever read at all, so the slider had no effect whenever Nested
    // Diamond was the active Face Style. Same shading model, same face
    // diagonal, just applied to this branch's own tint instead of Solid's.
    vec2 diag1 = normalize(faceC - faceA);
    float bevelGrad = dot(normalize(localShrunk - faceCenter + 1e-6), diag1);
    float bevelShade = 1.0 + bevelGrad * bevelStrength * 0.5;

    // Full-strength faceMix blend, matching Solid mode's own faceCol
    // exactly, then bevel-shaded on top. The previous
    // mix(colB, mix(colB, colA, faceMix), 0.4) capped every nested face at
    // 40% of its intended saturation no matter what Face Contrast or the
    // color pickers were set to — a hardcoded damping constant, not a
    // rendering weakness, and the actual cause of "barely visible."
    vec3 bgTint = mix(colB, colA, clamp(faceMix, 0.0, 1.0)) * clamp(bevelShade, 0.3, 1.6);
    vec3 outCol = mix(bgTint, colA, line);
    // Facet Detail's weight raised slightly (0.5 -> 0.6) now that it's no
    // longer sitting on a washed-out background — it was already wired in
    // here, but read as weak partly because of what it was blending onto.
    outCol = mix(outCol, colA, facetLine * 0.6);
    outCol = mix(outCol, colB, outlineMask * 0.7);
    return outCol;
  } else if(faceStyle == 2){
    // Hatched: parallel directional stripes, one direction per face — the
    // classic isometric-cube shading trick. Each face's hatch direction
    // runs along that face's own real edge (faceB - faceA), which is what
    // makes the three faces read as distinct planes rather than a single
    // flat pattern with a shared angle. Verified as a standalone render
    // before this was written (three-face isometric cube, correct per-
    // face direction) rather than tuned blind.
    vec2 dir = normalize(faceB - faceA);
    vec2 perp = vec2(-dir.y, dir.x);
    float density = mix(4.0, 14.0, facetDetail);
    float hatchW = mix(0.10, 0.30, clamp(stroke / 3.0, 0.0, 1.0));
    float coord = dot(localShrunk - faceCenter, perp) * (density / s);
    float frac = fract(coord);
    float d = min(frac, 1.0 - frac);
    float hatch = 1.0 - smoothstep(0.0, hatchW, d);

    vec2 diag1 = normalize(faceC - faceA);
    float bevelGrad = dot(normalize(localShrunk - faceCenter + 1e-6), diag1);
    float bevelShade = 1.0 + bevelGrad * bevelStrength * 0.5;

    float faceMix = inTop ? 1.0 : (inLeft ? (1.0 - faceContrast*0.4) : (1.0 - faceContrast*0.85));
    // Background dimmed to ~35% of the face's own tint so the stripes
    // themselves carry the contrast, matching the reference look (a dense
    // line pattern reading as the shape) rather than a filled cell with
    // lines drawn on top of it at full brightness.
    vec3 bg = mix(colB, colA, clamp(faceMix, 0.0, 1.0)) * clamp(bevelShade, 0.3, 1.6) * 0.35;
    vec3 outCol = mix(bg, colA, hatch);
    outCol = mix(outCol, colA, facetLine * 0.3);
    outCol = mix(outCol, colB, outlineMask * 0.75);
    return outCol;

  }

  // Bevel Strength rebuilt as real directional shading across each face
  // (a linear gradient along the face's own "up" diagonal, like a light
  // catching a beveled edge) instead of a small additive nudge to
  // faceContrast's already-small effect — that's what made it read as
  // doing almost nothing regardless of setting.
  vec2 diag1 = normalize(faceC - faceA);
  float bevelGrad = dot(normalize(localShrunk - faceCenter + 1e-6), diag1);
  float bevelShade = 1.0 + bevelGrad * bevelStrength * 0.5;

  float faceMix = inTop ? 1.0 : (inLeft ? (1.0 - faceContrast*0.4) : (1.0 - faceContrast*0.85));
  vec3 faceCol = mix(colB, colA, clamp(faceMix, 0.0, 1.0)) * clamp(bevelShade, 0.3, 1.6);
  float edgeLine = smoothstep(0.86, 1.0, dd);
  faceCol = mix(faceCol, colB, edgeLine * 0.35);
  faceCol = mix(faceCol, colA, facetLine * 0.4);
  faceCol = mix(faceCol, colB, outlineMask * 0.75);
  return faceCol;
}

/* ============================================================
   Y-TRIBAR WEAVE
   Arm Taper rebuilt: the previous version tapered stroke width based on
   raw grid-fraction distance, a value with no real relationship to
   position along the actual rendered arm — that's why it read as no
   change at all, it was varying width somewhat randomly relative to what
   was visible. This version tracks the true parametric position (0 at
   center, 1 at the tip) of whichever segment produced the winning
   distance, so taper now genuinely follows each arm from thick-at-center
   to thin-at-tip.
   Third weave style, Diamond: a sharp, asymmetric kite silhouette (bend
   point close to center with a large perpendicular offset) instead of a
   symmetric bend — a genuinely different look, still exactly two
   segments (same cost as Chevron), still terminating at the same fixed,
   connectivity-guaranteeing edge midpoint. */
vec2 segDistT(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return vec2(length(pa - ba * h), h);
}

vec3 yTribarWeave(vec2 p, float scale, float stroke, float curl, float layersF, int weaveStyle, float armTaper, vec3 colA, vec3 colB){
  int layers = int(clamp(layersF, 1.0, 4.0));
  float L = 46.0 * scale * 0.9;
  vec2 gp = p / L;
  float j0 = floor(gp.y / (sqrt(3.0) * 0.5));
  float i0 = floor(gp.x - 0.5 * j0);
  float minD = 1e5;
  float minT = 0.0;

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

            if(weaveStyle == 1){
              vec2 bendPt2 = mix(bendPt, target, 0.5) + perp * bendOff * 0.4;
              vec2 tL = mix(cen, target, sL), bL = mix(cen, bendPt, sL), bL2 = mix(cen, bendPt2, sL);
              vec2 dt1 = segDistT(p, cen, bL), dt2 = segDistT(p, bL, bL2), dt3 = segDistT(p, bL2, tL);
              if(dt1.x < minD){ minD = dt1.x; minT = dt1.y * 0.33; }
              if(dt2.x < minD){ minD = dt2.x; minT = 0.33 + dt2.y * 0.33; }
              if(dt3.x < minD){ minD = dt3.x; minT = 0.66 + dt3.y * 0.34; }
            } else if(weaveStyle == 2){
              vec2 midSkew = mix(cen, target, 0.32);
              vec2 bendPtSkew = midSkew + perp * bendOff * 1.6;
              vec2 tL = mix(cen, target, sL), bL = mix(cen, bendPtSkew, sL);
              vec2 dt1 = segDistT(p, cen, bL), dt2 = segDistT(p, bL, tL);
              if(dt1.x < minD){ minD = dt1.x; minT = dt1.y * 0.5; }
              if(dt2.x < minD){ minD = dt2.x; minT = 0.5 + dt2.y * 0.5; }
            } else {
              vec2 tL = mix(cen, target, sL), bL = mix(cen, bendPt, sL);
              vec2 dt1 = segDistT(p, cen, bL), dt2 = segDistT(p, bL, tL);
              if(dt1.x < minD){ minD = dt1.x; minT = dt1.y * 0.5; }
              if(dt2.x < minD){ minD = dt2.x; minT = 0.5 + dt2.y * 0.5; }
            }
          }
        }
      }
    }
  }

  float taperMul = mix(1.0, mix(1.35, 0.3, minT), armTaper);
  float w = max(0.6, stroke) * L * 0.045 * taperMul;
  float line = 1.0 - smoothstep(w*0.5, w*0.5 + L*0.02, minD);
  return mix(colB, colA, line);
}

/* ============================================================
   FRACTAL SUBDIVIDE
   Square's size bug, found and fixed: last round I described shrinking
   "all three base shapes ~20%" as a safety margin. For triangle/hexagon
   I reduced their radius (2.1 -> 1.7), a genuine shrink. For square I
   changed the box-mapping multiplier from 0.28 to 0.225 — but in
   uv = q*k + 0.5, a SMALLER k produces a LARGER effective pattern (the
   q-range needed to cover [0,1] grows as k shrinks). I did the opposite
   of what I described and reported doing. Square's q-reach was ~2.22
   after that "fix," meaningfully bigger than triangle/hexagon's 1.7 —
   which tracks exactly with only square continuing to show edge/corner
   issues after the other two were fixed. Corrected here to k=0.294,
   which gives square the same ±1.7 reach as the other two shapes.
   Tiling, new: repeats the fractal across an NxN grid instead of one
   large centered copy, each tile independently sized to fit — a genuine
   compositional option, not a parameter tweak on the existing look. */
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

vec3 fractalShape(vec2 q, int baseShape, int depth, float fillRatio, vec3 colA, vec3 colB){
  if(baseShape == 1){
    float R = 1.7;
    if(max(abs(q.x), abs(q.y)) > R) return colB;
    vec2 center = vec2(0.0);
    float half_ = R;
    // Fill Ratio now genuinely reshapes this carpet — previously ignored
    // entirely by Square, the only base shape that didn't read it.
    // extraSkip is a small additional per-cell hole chance layered on top
    // of the guaranteed center-hole below: high Fill Ratio -> ~0 extra
    // (denser, close to a classic Sierpinski Carpet), low Fill Ratio ->
    // up to 22% extra per non-center cell (sparser, more broken-up).
    // Verified before writing this (see PLACEMENT.md) that this only
    // changes which cells survive — center/half_ update identically
    // regardless of the outcome — so the centering fix above is
    // completely unaffected by this.
    float extraSkip = 0.22 * (1.0 - clamp((fillRatio - 0.3) / 0.4, 0.0, 1.0));
    float seedAcc = 0.0;
    for(int d = 0; d < 7; d++){
      if(d >= depth) break;
      vec2 rel = (q - center) / half_;               // [-1, 1] within the current cell
      vec2 cell = clamp(floor((rel * 0.5 + 0.5) * 3.0), 0.0, 2.0); // which of 3x3 sub-cells
      bool isCenterCell = (cell.x == 1.0 && cell.y == 1.0);
      float cellIdx = cell.x + cell.y * 3.0;
      seedAcc += cellIdx * 17.0 + float(d) * 131.0;
      bool extraHole = !isCenterCell && hash1(seedAcc) < extraSkip;
      if(isCenterCell || extraHole) return colB;      // center cell always excluded, real carpet
      center += (cell - 1.0) * (half_ * 2.0 / 3.0);
      half_ /= 3.0;
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

vec3 fractalSubdivide(vec2 screenQ, int baseShape, int depth, float fillRatio, float scale, float rotation, float tiling, bool tilingInvert, vec3 colA, vec3 colB){
  vec2 q = rot2(rotation * PI / 180.0) * screenQ;
  float tileN = max(1.0, floor(tiling + 0.5));
  float effScale = max(0.2, scale) / tileN;
  q = q / effScale;
  if(tileN > 1.5){
    float period = 3.6;
    q = mod(q + period * 0.5, period) - period * 0.5;
  }
  // Invert Tiling: mirrors everything below the local y=0 line back onto
  // the upper half, applied after the tile wrap above so it reflects
  // within each tile at Tiling > 1, not just once across the whole canvas.
  if(tilingInvert && q.y < 0.0) q.y = -q.y;
  return fractalShape(q, baseShape, depth, fillRatio, colA, colB);
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
    col = fractalSubdivide(uv, u_baseShape, u_depth, u_fillRatio, scaleLive, rotationLive, u_tiling, u_tilingInvert, u_colorA, u_colorB);
  }

  fragColor = vec4(col, 1.0);
}
