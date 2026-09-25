#version 300 es
precision highp float;

/*
 * Shapeshift — mood tile #100.
 *
 * A shape (typed text, an uploaded SVG / PNG / JPG, or a library shape) is
 * turned into a signed distance field by lib/shape-source and fed in as
 * u_shape. This shader then:
 *
 *   Motion    displaces WHERE the shape is read from — Strip warp (slit-scan
 *             strips at any axis angle), Column step (quantised columns, each
 *             with its own gradient segment) or Shard shift (random cut lines,
 *             each region translated / rotated, re-cut on trigger or beat)
 *   Transform maps the displaced point into shape space (tilt -> rotate ->
 *             scale -> mirror)
 *   Fill      colours the covered area: gradient, element grid (repeated
 *             dots / pills / bars / rings / diamonds / zeros sized by depth
 *             into the shape), metaballs, noise mesh or solid
 *   Depth     optional pseudo-extrusion stack and chromatic split
 *
 * Distance texture: R = fine field (±16 px at 1024², crisp edges), G = coarse
 * field (±128 px, depth effects). Both encode 0.5 + d / (2 * spread), + inside.
 * In shape space s ∈ [-1, 1] across the 1024² raster, one texel = 2/1024, so:
 *   fine   d_s = (r - 0.5) * 0.0625
 *   coarse d_s = (g - 0.5) * 0.5
 *
 * No fwidth() anywhere (fixed antialias width from u_resolution); every trig
 * input on time is wrapped with mod(…, TAU).
 *
 * PERFORMANCE (100.1). The depth stack used to re-run motion, wobble noise and
 * the whole fill for every layer — ~70 noise evaluations per pixel at the
 * default of 10 layers, enough to stall the shared GL stage and with it the
 * main thread (every card's drawImage waits on the GPU). Now: motion runs
 * ONCE; only the front layer is filled; back layers are silhouettes (one
 * texture read, extrusion-shaded) composited front-to-back with an early exit
 * as soon as a pixel is opaque. Cost is ~flat in stack depth.
 */

out vec4 fragColor;

uniform vec2  u_resolution;
uniform float u_time;
uniform float u_bass;
uniform float u_mid;
uniform float u_high;

// ── Source ──
uniform sampler2D u_shape;     // @shape @label(Source) @group(Source) @default(SHAPE SHIFT)
uniform float u_shapeDepth;    // @hidden  deepest inside distance, shape space — set by the host

// ── Transform ──
uniform float u_rotation;      // @label(Angle) @range(-180, 180) @default(0) @unit(°) @group(Transform) @mod
uniform float u_scale;         // @label(Scale) @range(0.2, 3) @default(0.9) @group(Transform) @mod
uniform vec2  u_offset;        // @label(Position) @range(-1, 1) @default(0.0, 0.0) @group(Transform)
uniform vec2  u_tilt;          // @label(Tilt) @range(-1, 1) @default(0.0, 0.0) @group(Transform) @mod
uniform int   u_mirror;        // @label(Mirror) @select(None=0 | Horizontal=1 | Vertical=2 | Quad=3) @strip @default(0) @group(Transform)
uniform bool  u_invert;        // @label(Invert shape) @default(false) @group(Transform)

// ── Fill ──
uniform int   u_fill;          // @label(Fill) @select(Gradient=0 | Elements=1 | Metaballs=2 | Mesh=3 | Solid=4) @strip @default(0) @group(Fill)
uniform vec3  u_color1;        // @label(Color A) @color @default(1.0, 0.62, 0.11) @group(Fill)
uniform vec3  u_color2;        // @label(Color B) @color @default(1.0, 0.18, 0.53) @group(Fill) @showIf(u_fill!=Solid)
uniform vec3  u_color3;        // @label(Color C) @color @default(0.23, 0.05, 0.64) @group(Fill) @showIf(u_fill!=Solid)
uniform vec3  u_bg;            // @label(Background) @color @default(0.99, 0.96, 0.89) @group(Fill)
uniform float u_gradAngle;     // @label(Gradient angle) @range(-180, 180) @default(-90) @unit(°) @group(Fill) @mod @showIf(u_fill!=Solid)
uniform float u_gradScroll;    // @label(Gradient drift) @range(0, 4) @default(0.2) @step(0.005) @group(Fill) @mod @showIf(u_fill!=Solid)
uniform int   u_element;       // @label(Element) @select(Dot=0 | Pill=1 | Bar=2 | Ring=3 | Diamond=4 | Zero=5) @strip @default(1) @group(Fill) @showIf(u_fill=Elements)
uniform int   u_density;       // @label(Density) @range(12, 120) @default(46) @roll(24, 80) @group(Fill) @hint(Element rows across the tile.) @showIf(u_fill=Elements)
uniform float u_cellAspect;    // @label(Cell aspect) @range(0.25, 4) @default(0.7) @group(Fill) @hint(Cell width ÷ height. Below 1 packs elements tighter across.) @showIf(u_fill=Elements)
uniform float u_elemSize;      // @label(Element size) @range(0.1, 1.5) @default(1.1) @group(Fill) @mod @showIf(u_fill=Elements)
uniform float u_depthSize;     // @label(Depth sizing) @range(0, 1) @default(0.35) @group(Fill) @mod @hint(Elements grow toward the middle of the shape.) @showIf(u_fill=Elements)
uniform bool  u_gridLocal;     // @label(Grid follows shape) @default(false) @group(Fill) @hint(The grid rotates, scales and tilts with the shape.) @showIf(u_fill=Elements)
uniform bool  u_elemExtrude;   // @label(Extrude elements) @default(false) @group(Fill) @hint(Apply the depth stack to elements.) @showIf(u_fill=Elements)
uniform int   u_ballCount;     // @label(Blob count) @range(2, 12) @default(6) @roll(3, 9) @group(Fill) @showIf(u_fill=Metaballs)
uniform float u_ballSize;      // @label(Blob size) @range(0.1, 1) @default(0.5) @group(Fill) @mod @showIf(u_fill=Metaballs)
uniform float u_ballMerge;     // @label(Merge) @range(0, 1) @default(0.5) @group(Fill) @mod @hint(Separate orbs at 0, one fused mass at 1.) @showIf(u_fill=Metaballs)
uniform float u_ballSpeed;     // @label(Drift speed) @range(0, 2) @default(1) @group(Fill) @mod @showIf(u_fill=Metaballs)
uniform int   u_ballRings;     // @label(Rings) @range(0, 12) @default(3) @group(Fill) @hint(0 is a smooth glow; higher adds contour bands.) @showIf(u_fill=Metaballs)
uniform float u_ballPump;      // @label(Audio pump) @range(0, 2) @default(1) @group(Fill) @hint(Bass swells the blobs, highs tighten the rings.) @showIf(u_fill=Metaballs)
uniform int   u_lineDensity;   // @label(Mesh lines) @range(2, 60) @default(14) @group(Fill) @hint(Contour lines across the mesh.) @showIf(u_fill=Mesh)
uniform float u_meshTurb;      // @label(Turbulence) @range(0, 1) @default(0.5) @group(Fill) @mod @hint(0 slides the mesh; higher churns it like liquid.) @showIf(u_fill=Mesh)
uniform float u_meshFlow;      // @label(Flow speed) @range(0, 2) @default(1) @group(Fill) @mod @showIf(u_fill=Mesh)

// ── Motion ──
uniform int   u_motion;        // @label(Motion) @select(None=0 | Strip warp=1 | Column step=2 | Shard shift=3) @strip @default(1) @group(Motion)
uniform float u_amount;        // @label(Amount) @range(0, 1) @default(0.2) @group(Motion) @mod
uniform float u_speed;         // @label(Speed) @range(0, 3) @default(0.5) @group(Motion) @mod
uniform int   u_count;         // @label(Count) @range(2, 96) @default(28) @roll(6, 40) @group(Motion) @hint(Strips, columns, or cut lines — shards use up to 8.)
uniform float u_axis;          // @label(Axis) @range(-90, 90) @default(0) @unit(°) @group(Motion) @mod
uniform float u_frequency;     // @label(Frequency) @range(0, 8) @default(1.5) @group(Motion)
uniform float u_softness;      // @label(Softness) @range(0, 1) @default(1) @group(Motion) @hint(Hard strips at 0, a continuous smear at 1.)
uniform float u_audioDrive;    // @label(Audio drive) @range(0, 2) @default(1) @group(Motion) @hint(How strongly bass, mid and high push the motion.)
uniform bool  u_cutLines;      // @label(Cut lines) @default(false) @group(Motion)
uniform float u_cutWidth;      // @label(Line width) @range(0.5, 12) @default(1) @step(0.1) @unit(px) @group(Motion) @showIf(u_cutLines)
uniform vec2  u_recut;         // @label(Re-cut) @trigger(u_beatCut) @group(Motion)
uniform bool  u_beatCut;       // @label(Re-cut on beat) @default(false) @group(Motion)

// ── Depth & edge ──
uniform int   u_stack;         // @label(Depth stack) @range(1, 16) @default(4) @roll(1, 6) @group(Depth)
uniform vec2  u_stackOffset;   // @label(Stack offset) @range(-0.1, 0.1) @default(0.01, -0.012) @group(Depth) @mod
uniform float u_chroma;        // @label(Chroma split) @range(0, 0.05) @default(0) @group(Depth) @mod
uniform float u_inflate;       // @label(Breathe) @range(-0.2, 0.2) @default(0) @group(Depth) @mod
uniform float u_wobble;        // @label(Edge wobble) @range(0, 0.2) @default(0.01) @group(Depth) @mod
uniform float u_outline;       // @label(Outline) @range(0, 0.05) @default(0) @group(Depth)

const float PI  = 3.14159265359;
const float TAU = 6.28318530718;

float T;      // wrapped time for noise inputs
float g_seg;  // per-strip / column / shard id in 0..1, for gradient segments
float PX;     // one pixel in screen units

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash11(float n) { n = fract(n * 0.1031); n *= n + 33.33; n *= n + n; return fract(n); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float bandAt(float f) {
  f = clamp(f, 0.0, 1.0);
  float b = f < 0.5 ? mix(u_bass, u_mid, f * 2.0) : mix(u_mid, u_high, (f - 0.5) * 2.0);
  return b * u_audioDrive;
}

vec3 palette(float t) {
  t = fract(t) * 3.0;
  if (t < 1.0) return mix(u_color1, u_color2, smoothstep(0.0, 1.0, t));
  if (t < 2.0) return mix(u_color2, u_color3, smoothstep(0.0, 1.0, t - 1.0));
  return mix(u_color3, u_color1, smoothstep(0.0, 1.0, t - 2.0));
}

/* ---------------- Motion: displaces where the shape is read from ---------------- */

vec2 shardCenter(float fi) { return (vec2(hash11(fi * 1.7), hash11(fi * 2.9)) - 0.5) * 1.6; }
float shardAngle(float fi) { return hash11(fi * 5.3) * PI + radians(u_axis); }

vec2 motion(vec2 p) {
  g_seg = 0.0;
  float a = radians(u_axis);
  float ph = mod(u_time * u_speed * 2.0, TAU * 64.0);

  if (u_motion == 1) {                                   // Strip warp
    vec2 q = rot(-a) * p;
    float n = float(u_count);
    float band = (q.y * 0.5 + 0.5) * n;
    float hard = floor(band);
    float idx = mix(hard, band, u_softness);
    float lvl = bandAt(idx / n);
    float wave = sin(mod(idx * u_frequency * 0.7 + ph, TAU)) * 0.55
               + (noise(vec2(idx * 0.37, T * u_speed * 0.8)) - 0.5) * 0.9;
    q.x += wave * u_amount * (0.6 + lvl * 0.9);
    // Slit-scan stretch: a few strips at a time pull out into streaks.
    float st = max(0.0, noise(vec2(idx * 0.61 + 3.0, T * u_speed * 0.6)) - 0.55) * u_amount * 7.0 * (0.6 + lvl);
    q.x /= 1.0 + st;
    // Hard strips each carry their own gradient segment; a soft smear keeps
    // the gradient continuous (per-strip segments read as banding there).
    g_seg = hard / n * (1.0 - u_softness);
    return rot(a) * q;
  }

  if (u_motion == 2) {                                   // Column step
    vec2 q = rot(-a) * p;
    float n = float(u_count);
    float col = floor(q.x * n * 0.5);
    float tt = u_time * u_speed * 1.5 + hash11(col * 3.7) * 4.0;
    float st = floor(tt), fr = fract(tt);
    float e = smoothstep(0.0, 0.18, fr);
    float o0 = hash11(col * 13.1 + mod(st, 97.0)) - 0.5;
    float o1 = hash11(col * 13.1 + mod(st + 1.0, 97.0)) - 0.5;
    float lvl = bandAt(fract(col / n * 0.5 + 0.5));
    q.y += mix(o0, o1, e) * 2.0 * u_amount * (0.6 + lvl * 0.8);
    g_seg = hash11(col * 7.3);
    return rot(a) * q;
  }

  if (u_motion == 3) {                                   // Shard shift
    float seed = u_recut.x;
    float snap = 1.0 - pow(1.0 - clamp(u_recut.y / 0.25, 0.0, 1.0), 3.0);
    int n = min(u_count, 8);
    float code = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= n) break;
      float fi = float(i) + seed * 8.0;
      float th = shardAngle(fi);
      if (dot(p - shardCenter(fi), vec2(cos(th), sin(th))) > 0.0) code += exp2(float(i));
    }
    float r = hash11(code * 1.13 + seed * 17.0);
    float k = u_amount * snap * (0.7 + u_bass * u_audioDrive * 0.8);
    vec2 off = (vec2(hash11(r * 91.0), hash11(r * 47.0)) - 0.5) * 0.9 * k;
    off += vec2(sin(mod(ph * 0.5 + r * TAU, TAU)), cos(mod(ph * 0.4 + r * TAU, TAU))) * 0.04 * u_amount;
    float ang = (hash11(r * 23.0) - 0.5) * 1.1 * k;
    g_seg = r;
    return rot(ang) * p + off;
  }

  return p;
}

float cutDist(vec2 p) {
  float a = radians(u_axis);
  if (u_motion == 1 && u_softness < 0.5) {
    vec2 q = rot(-a) * p; float n = float(u_count);
    float b = fract((q.y * 0.5 + 0.5) * n);
    return min(b, 1.0 - b) * 2.0 / n;
  }
  if (u_motion == 2) {
    vec2 q = rot(-a) * p; float n = float(u_count);
    float b = fract(q.x * n * 0.5);
    return min(b, 1.0 - b) * 2.0 / n;
  }
  if (u_motion == 3) {
    float d = 1e3; int n = min(u_count, 8);
    for (int i = 0; i < 8; i++) {
      if (i >= n) break;
      float fi = float(i) + u_recut.x * 8.0;
      float th = shardAngle(fi);
      d = min(d, abs(dot(p - shardCenter(fi), vec2(cos(th), sin(th)))));
    }
    return d;
  }
  return 1e3;
}

/* ---------------- Shape: screen -> shape space -> signed distance ---------------- */

vec2 toShape(vec2 p) {
  p -= u_offset;
  float w = 1.0 + dot(p, u_tilt) * 0.9;
  p /= max(w, 0.15);
  p = rot(-radians(u_rotation)) * p;
  p /= u_scale;
  if (u_mirror == 1 || u_mirror == 3) p.x = -abs(p.x);
  if (u_mirror == 2 || u_mirror == 3) p.y = abs(p.y);
  return p;
}

/** Raw signed distance at a SHAPE-space point, in screen units, + inside.
    One texture read — no noise — so silhouettes and grid centres stay cheap. */
float rawDistS(vec2 s) {
  vec2 uv = s * 0.5 + 0.5;
  float d;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    d = -0.5;
  } else {
    vec4 t = texture(u_shape, uv);
    // Fine channel near the edge (exact contour), coarse channel beyond.
    d = abs(t.r - 0.5) < 0.47 ? (t.r - 0.5) * 0.0625 : (t.g - 0.5) * 0.5;
  }
  return d * u_scale + u_inflate;
}

float signFix(float d) { return u_invert ? -d : d; }

/** Edge wobble offset — evaluated once per pixel and reused by every layer. */
float wobbleAt(vec2 s) { return u_wobble > 0.0 ? u_wobble * (noise(s * 4.0 + T * 0.5) - 0.5) : 0.0; }

/* ---------------- Elements ---------------- */

float elementSDF(vec2 l, float sz) {
  if (u_element == 0) return length(l) - 0.48 * sz;
  if (u_element == 1) { vec2 q = abs(l); float h = 0.2 * sz; q.x = max(q.x - max(0.48 * sz - h, 0.0), 0.0); return length(q) - h; }
  if (u_element == 2) { vec2 q = abs(l) - vec2(0.48 * sz, 0.1 * sz); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
  if (u_element == 3) return abs(length(l) - 0.34 * sz) - 0.08 * sz;
  if (u_element == 4) return (abs(l.x) + abs(l.y)) - 0.5 * sz;
  return abs(length(l * vec2(1.7, 1.0)) - 0.36 * sz) - 0.075 * sz;   // Zero glyph
}

/**
 * Element coverage at `g` (grid space). Returns vec4(bestDepth, cellCentre.xy,
 * alpha). Neighbouring cells are searched whenever an element can overhang its
 * own cell (size > ~1), so large elements overlap cleanly instead of being
 * chopped flat at the cell border (the 100.0 bug). Pills and bars only
 * overhang sideways; round elements need both axes.
 */
vec4 elements(vec2 g, bool local) {
  vec2 cs = vec2(2.0 / float(u_density)) * vec2(u_cellAspect, 1.0);
  vec2 base = floor(g / cs);
  int rx = u_elemSize > 0.98 ? 1 : 0;
  int ry = (u_element == 1 || u_element == 2) ? 0 : rx;
  // Depth normalised to THIS shape's deepest point (thin text and fat logos
  // both span 0..1). Falls back to a fixed scale before the host reports it.
  float maxD = (u_shapeDepth > 0.0 ? u_shapeDepth : 0.22) * u_scale;
  float px = local ? PX / u_scale : PX;
  float best = 1e3;
  vec4 hit = vec4(0.0);
  for (int j = -1; j <= 1; j++) {
    if (j < -ry || j > ry) continue;
    for (int i = -1; i <= 1; i++) {
      if (i < -rx || i > rx) continue;
      vec2 cc = (base + vec2(i, j) + 0.5) * cs;
      float dc = signFix(rawDistS(local ? cc : toShape(cc)));
      if (dc <= 0.0) continue;
      float depth = clamp(dc / maxD, 0.0, 1.0);
      float sz = u_elemSize * mix(1.0, 0.25 + 0.75 * sqrt(depth), u_depthSize);
      float e = elementSDF((g - cc) / cs, sz);
      if (e < best) { best = e; hit.xyz = vec3(depth, cc); }
    }
  }
  float aal = px / min(cs.x, cs.y) * 1.5;
  hit.w = smoothstep(aal, -aal, best);
  return hit;
}

/* ---------------- Layers ---------------- */

/** Full fill for the front layer only. `pm` is already motion-displaced. */
vec4 frontLayer(vec2 pm, out float wob) {
  vec2 s = toShape(pm);
  wob = wobbleAt(s);
  float d = signFix(rawDistS(s) + wob);
  vec2 dir = vec2(cos(radians(u_gradAngle)), sin(radians(u_gradAngle)));
  float drift = mod(u_time * u_gradScroll * 0.12, 1.0);
  float gt = dot(pm, dir) * 0.35 + 0.5 + g_seg * 0.6 + drift;
  float cov = smoothstep(-PX, PX, d);
  vec3 col;
  float a;

  if (u_fill == 1) {                                     // Elements
    bool local = u_gridLocal;
    vec4 e = elements(local ? s : pm, local);
    vec2 ccScreen = local ? pm : e.yz;
    a = e.w;
    col = palette(dot(ccScreen, dir) * 0.35 + 0.5 + g_seg * 0.6 + drift) * (0.75 + 0.25 * e.x);
  } else if (u_fill == 2) {                              // Metaballs
    // Field f = Σ r²/d². Threshold `th` sets where a blob's surface sits:
    // Merge 0.5 -> th 1 (the 100.x look), 0 -> 2 (tight separate orbs),
    // 1 -> 0.5 (one fused mass). Colour is read from v = log2(f/th), clamped:
    // the old palette(f * 0.18) grew without bound toward each centre and
    // aliased into a moiré "mandala" in the cores (~22 palette cycles per
    // pixel at 500 px); the clamped log keeps even Rings 12 under ~0.6.
    int nb = clamp(u_ballCount, 2, 12);
    float rr = 0.32 * u_ballSize * (1.0 + 0.5 * u_bass * u_ballPump);
    float f = 0.0;
    for (int i = 0; i < 12; i++) {
      if (i >= nb) break;
      float fi = float(i);
      vec2 b = vec2(sin(mod(u_time * 0.4 * u_ballSpeed * (1.0 + fi * 0.17) + fi * 2.1, TAU)),
                    cos(mod(u_time * 0.33 * u_ballSpeed * (1.0 + fi * 0.11) + fi * 1.3, TAU))) * 0.55;
      vec2 dv = s - b;
      f += rr * rr / max(dot(dv, dv), 1e-4);
    }
    float th = exp2(1.0 - 2.0 * u_ballMerge);
    float v = clamp(log2(max(f / th, 1e-6)), 0.0, 2.5);
    vec3 blob;
    if (u_ballRings > 0) {
      float rf = float(u_ballRings) * 0.2 * (1.0 + 0.6 * u_high * u_ballPump);
      blob = palette(gt + v * rf);
    } else {
      blob = palette(gt + v * 0.08) * (1.0 + 0.25 * smoothstep(0.0, 2.5, v));
    }
    col = mix(u_color3 * 0.35, blob, smoothstep(th * 0.7, th * 1.3, f));
    a = cov;
  } else if (u_fill == 3) {                              // Mesh
    // Liquid turbulence (100.3): the mesh noise is read through a second,
    // time-evolving noise field (one level of domain warp), so the contours
    // churn instead of only sliding. Turbulence 0 + Flow 1 is exactly the
    // 100.2 formula. Numerically: best-translation frame correlation over 2 s
    // drops from 0.998 (rigid slide) to 0.92 at the 0.5 default, 0.79 at 1.
    // Costs two extra fbm on the front layer, Mesh fill only.
    vec2 q = s * 2.5;
    float ft = T * u_meshFlow;
    if (u_meshTurb > 0.0) {
      vec2 w = vec2(fbm(q * 0.7 + vec2(ft * 0.23, 0.0)),
                    fbm(q * 0.7 + vec2(4.3, 4.3 - ft * 0.19))) - 0.5;
      q += w * u_meshTurb * 2.4;
    }
    float v = fbm(q + vec2(ft * 0.15, -ft * 0.1));
    float b = fract(v * float(u_lineDensity));
    float line = smoothstep(0.12, 0.0, abs(b - 0.5) - 0.28);
    col = palette(v + gt * 0.5);
    a = cov * mix(0.18, 1.0, line);
  } else if (u_fill == 4) {                              // Solid
    col = u_color1;
    a = cov;
  } else {                                               // Gradient
    col = palette(gt);
    a = cov;
  }

  if (u_outline > 0.0) {
    float o = smoothstep(PX, -PX, abs(d) - u_outline);
    col = mix(col, palette(gt + 0.5), o);
    a = max(a, o);
  }
  return vec4(col, a);
}

/** Back-layer coverage: a silhouette (or the element pattern when extruded). */
float backCoverage(vec2 q, float wob) {
  if (u_fill == 1) {
    bool local = u_gridLocal;
    return elements(local ? toShape(q) : q, local).w;
  }
  return smoothstep(-PX, PX, signFix(rawDistS(toShape(q)) + wob));
}

vec3 composite(vec2 p) {
  int n = clamp(u_stack, 1, 16);
  if (u_fill == 1 && !u_elemExtrude) n = 1;              // elements stay flat by default
  vec2 step = u_stackOffset * (1.0 + u_bass * u_audioDrive * 0.6);
  // Centre the stack as a group: the front layer sits half the extrusion
  // depth forward, so the shape + its extrusion is centred in the frame.
  p += step * float(n - 1) * 0.5;

  vec2 pm = motion(p);                                   // ONE motion pass
  float wob;
  vec4 F = frontLayer(pm, wob);

  vec3 acc = F.rgb * F.a;
  float A = F.a;

  if (n > 1 && A < 0.995) {
    vec2 dir = vec2(cos(radians(u_gradAngle)), sin(radians(u_gradAngle)));
    float drift = mod(u_time * u_gradScroll * 0.12, 1.0);
    for (int k = 1; k < 16; k++) {
      if (k >= n) break;
      float fk = float(k);
      vec2 q = pm - step * fk;
      float a = backCoverage(q, wob);
      if (a <= 0.0) continue;
      float shade = mix(1.0, 0.3, fk / float(n - 1));
      vec3 c = (u_fill == 4 ? u_color1 : palette(dot(q, dir) * 0.35 + 0.5 + g_seg * 0.6 + drift + fk * 0.025)) * shade;
      acc += (1.0 - A) * a * c;
      A += (1.0 - A) * a;
      if (A > 0.995) break;                              // opaque: nothing behind shows
    }
  }
  return acc + (1.0 - A) * u_bg;
}

void main() {
  T = mod(u_time, 1000.0);
  PX = 1.0 / u_resolution.y;
  vec2 p = (gl_FragCoord.xy * 2.0 - u_resolution) / u_resolution.y;
  // ShaderRenderer blits the GL frame with a vertical flip (see its
  // setTransform(1, 0, 0, -1, …)), so in this app gl_FragCoord.y runs DOWN
  // the card. Everything below is written y-up — the shape texture, tilt,
  // stack offset, gradient angle — so flip once here. (100.0/100.1 missed
  // this: text and uploads rendered upside down in the app while the test
  // harness, which had no blit flip, looked correct.)
  p.y = -p.y;

  vec3 col;
  if (u_chroma > 0.0005) {
    vec2 o = vec2(u_chroma, 0.0);
    col = vec3(composite(p + o).r, composite(p).g, composite(p - o).b);
  } else {
    col = composite(p);
  }

  if (u_cutLines) {
    float bgL = dot(u_bg, vec3(0.299, 0.587, 0.114));
    vec3 lc = bgL > 0.5 ? vec3(0.15) : vec3(0.55);
    float halfWidth = u_cutWidth * PX;
    col = mix(col, lc, (1.0 - smoothstep(halfWidth - PX, halfWidth + PX, cutDist(p))) * 0.8);
  }

  fragColor = vec4(col, 1.0);
}
