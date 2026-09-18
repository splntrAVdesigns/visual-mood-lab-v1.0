#version 300 es
precision highp float;

/*
 * cyber-glitch — a domain-repeated grid of independently-timed HUD-style
 * shape fragments (filled blocks, corner brackets, targeting reticles,
 * abstract glyph strokes, chevrons, diamond outlines, segmented readout
 * bars). Each active cell runs its own short lifecycle — grow in, hold,
 * fade out — with a hashed jitter offset, rotation, and per-frame-channel
 * RGB fringe. This is a different technique from this library's other
 * glitch tiles: glitch-scan.frag and chromatic-glitch.frag both corrupt
 * a continuous signal/field (scanline jitter, block displacement over a
 * drifting colour base); this one never has a base field to corrupt at
 * all — it's discrete shape debris materializing and dissolving against
 * black, which is a generative-shape technique, not a broken-signal one.
 *
 * Performance: single pass, no raymarch, no texture reads. Each pixel
 * checks a fixed 3x3 neighbourhood of grid cells (so a shape can bleed
 * across its own cell boundary without needing a second pass), and each
 * cell's shape distance function is a handful of segment/box distance
 * checks bounded by small fixed-iteration loops (max 4). All loop bounds
 * are compile-time constants.
 */

uniform float u_time;
uniform vec2 u_resolution;

// Composition
uniform vec2 u_center;          // @label(Center) @range(-1, 1) @group(Composition)
uniform float u_rotation;       // @label(Rotation) @range(-180, 180) @default(0) @unit(deg) @group(Composition)
uniform float u_scale;          // @label(Scale) @range(0.4, 2.5) @default(1.0) @group(Composition)

// Grid & lifecycle
uniform float u_cellSize;       // @label(Cell size) @range(0.05, 0.25) @default(0.11) @hint(Smaller values pack more, smaller fragments into the frame.)
uniform float u_cycleSpeed;     // @label(Cycle speed) @range(0.2, 3.0) @default(1.0) @mod @hint(How fast each fragment's assemble-hold-dissolve lifecycle runs.)
uniform float u_density;        // @label(Density) @range(0.1, 1.0) @default(0.5) @mod @hint(Fraction of grid cells active at any given moment.)
uniform float u_jitterAmount;   // @label(Jitter amount) @range(0, 1) @default(0.3) @mod @hint(How far a fragment can drift from its cell center.)
uniform float u_chromaOffset;   // @label(Chroma offset) @range(0, 0.1) @default(0.045) @mod @hint(RGB channel misalignment per fragment — the chromatic-fringe read.)

// Color
uniform vec3 u_colorA;          // @label(Color A) @color @default(0.27, 1.0, 1.0)
uniform vec3 u_colorB;          // @label(Color B) @color @default(1.0, 0.27, 0.86)
uniform vec3 u_colorC;          // @label(Color C) @color @default(0.51, 1.0, 0.47)
uniform vec3 u_colorD;          // @label(Color D) @color @default(1.0, 1.0, 1.0)

out vec4 fragColor;

float hash1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float shapeGlow(vec2 p, int stype, float size, float seed) {
  float lw = max(size * 0.06, 0.004);

  if (stype == 0) {
    vec2 b = vec2(size * 0.5, size * 0.35);
    float d = sdBox(p, b);
    return smoothstep(0.01, -0.01, d);
  }

  if (stype == 1) {
    float bl = size * 0.32;
    float hs = size * 0.5;
    float d = 1e5;
    d = min(d, sdSegment(p, vec2(-hs, -hs + bl), vec2(-hs, -hs)));
    d = min(d, sdSegment(p, vec2(-hs, -hs), vec2(-hs + bl, -hs)));
    d = min(d, sdSegment(p, vec2(hs - bl, -hs), vec2(hs, -hs)));
    d = min(d, sdSegment(p, vec2(hs, -hs), vec2(hs, -hs + bl)));
    d = min(d, sdSegment(p, vec2(hs, hs - bl), vec2(hs, hs)));
    d = min(d, sdSegment(p, vec2(hs, hs), vec2(hs - bl, hs)));
    d = min(d, sdSegment(p, vec2(-hs + bl, hs), vec2(-hs, hs)));
    d = min(d, sdSegment(p, vec2(-hs, hs), vec2(-hs, hs - bl)));
    return exp(-d * d / (lw * lw) * 4.0);
  }

  if (stype == 2) {
    float d = abs(length(p) - size * 0.4);
    d = min(d, sdSegment(p, vec2(-size * 0.55, 0.0), vec2(-size * 0.25, 0.0)));
    d = min(d, sdSegment(p, vec2(size * 0.25, 0.0), vec2(size * 0.55, 0.0)));
    d = min(d, sdSegment(p, vec2(0.0, -size * 0.55), vec2(0.0, -size * 0.25)));
    d = min(d, sdSegment(p, vec2(0.0, size * 0.25), vec2(0.0, size * 0.55)));
    return exp(-d * d / (lw * lw) * 4.0);
  }

  if (stype == 3) {
    float d = 1e5;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float a1 = hash1(seed + fi * 3.1) * 6.2831853;
      float a2 = hash1(seed + fi * 3.1 + 1.5) * 6.2831853;
      float r2 = size * 0.5 * (0.3 + hash1(seed + fi * 7.7) * 0.7);
      vec2 p1 = vec2(cos(a1), sin(a1)) * size * 0.1;
      vec2 p2 = vec2(cos(a2), sin(a2)) * r2;
      d = min(d, sdSegment(p, p1, p2));
    }
    return exp(-d * d / (lw * lw) * 4.0);
  }

  if (stype == 4) {
    float d = 1e5;
    d = min(d, sdSegment(p, vec2(-size * 0.35, -size * 0.4), vec2(size * 0.4, 0.0)));
    d = min(d, sdSegment(p, vec2(size * 0.4, 0.0), vec2(-size * 0.35, size * 0.4)));
    return exp(-d * d / (lw * lw) * 4.0);
  }

  if (stype == 5) {
    vec2 p0 = vec2(0.0, -size * 0.5);
    vec2 p1 = vec2(size * 0.5, 0.0);
    vec2 p2 = vec2(0.0, size * 0.5);
    vec2 p3 = vec2(-size * 0.5, 0.0);
    float d = 1e5;
    d = min(d, sdSegment(p, p0, p1));
    d = min(d, sdSegment(p, p1, p2));
    d = min(d, sdSegment(p, p2, p3));
    d = min(d, sdSegment(p, p3, p0));
    return exp(-d * d / (lw * lw) * 4.0);
  }

  // stype == 6: segmented readout bar
  float segs = 4.0;
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    if (hash1(seed + fi * 1.7) > 0.3) {
      vec2 c = vec2(-size * 0.5 + (fi + 0.5) * (size / segs), 0.0);
      vec2 b = vec2(size / segs * 0.45, size * 0.12);
      float d = sdBox(p - c, b);
      total = max(total, smoothstep(0.01, -0.01, d));
    }
  }
  return total;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  uv -= u_center;
  uv /= max(u_scale, 0.001);
  uv = rot2(radians(u_rotation)) * uv;

  float cell = u_cellSize;
  vec2 gp = uv / cell;
  vec2 cellId = floor(gp);
  vec2 cellUv = fract(gp) - 0.5;

  vec3 col = vec3(0.0);

  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 offset = vec2(float(ox), float(oy));
      vec2 nId = cellId + offset;
      vec2 nUv = (cellUv - offset) * cell;

      float seed = nId.x * 12.9898 + nId.y * 78.233;
      float hx = hash1(seed);
      float hy = hash1(seed + 11.7);

      float period = 0.16 + hx * 0.35;
      float t2 = u_time * u_cycleSpeed / period + hy * 30.0;
      float cycleIdx = floor(t2);
      float ph = t2 - cycleIdx;

      float activeSeed = nId.x * 7.1 + nId.y * 3.3 + cycleIdx;
      float isActive = step(1.0 - u_density, hash1(activeSeed));
      float show = isActive * step(ph, 0.65);

      if (show > 0.5) {
        float growPh = clamp(ph / 0.15, 0.0, 1.0);
        float fadePh = mix(1.0, clamp(1.0 - (ph - 0.5) / 0.15, 0.0, 1.0), step(0.5, ph));
        float alpha = min(growPh, fadePh);

        if (alpha > 0.02) {
          float size = cell * 0.55 * (0.6 + 0.4 * growPh);
          float jitterX = (hash1(activeSeed + 2.2) - 0.5) * cell * u_jitterAmount;
          float jitterY = (hash1(activeSeed + 4.4) - 0.5) * cell * u_jitterAmount;
          vec2 shapePos = nUv - vec2(jitterX, jitterY);
          float sang = hash1(activeSeed + 6.6) * 6.2831853;
          vec2 rp = rot2(sang) * shapePos;

          int stype = int(floor(hash1(activeSeed + 8.8) * 7.0));
          float colSel = hash1(activeSeed + 9.9);

          vec3 tint = u_colorD;
          if (colSel < 0.35) { tint = u_colorA; }
          else if (colSel < 0.65) { tint = u_colorB; }
          else if (colSel < 0.85) { tint = u_colorC; }

          float chOff = u_chromaOffset * cell;
          float gR = shapeGlow(rp - vec2(chOff, 0.0), stype, size, activeSeed);
          float gG = shapeGlow(rp, stype, size, activeSeed);
          float gB = shapeGlow(rp + vec2(chOff, 0.0), stype, size, activeSeed);

          col.r += tint.r * gR * alpha * 0.9;
          col.g += tint.g * gG * alpha * 0.9;
          col.b += tint.b * gB * alpha * 0.9;
        }
      }
    }
  }

  float grain = fract(sin(dot(floor(gl_FragCoord.xy / 2.0), vec2(12.9898, 78.233)) + u_time * 45.0) * 43758.5453);
  col *= (0.8 + 0.35 * grain);

  fragColor = vec4(col, 1.0);
}
