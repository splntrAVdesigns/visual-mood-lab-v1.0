#version 300 es
precision highp float;

// Reserved / host-driven uniforms — do not annotate as controls.
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;

// --- controls ---
uniform int u_columns;      // @label(Columns) @range(8, 64) @default(32)
uniform int u_rows;         // @label(Rows) @range(8, 48) @default(24)
uniform int u_direction;    // @label(Fall Direction) @select(Down=0 | Up=1 | Left=2 | Right=3) @default(0)
uniform float u_fallSpeed;  // @label(Fall Speed) @range(0.1, 5) @default(1.4) @mod
uniform float u_swapRate;   // @label(Glyph Swap Rate) @range(0.5, 12) @default(4.0) @mod
uniform float u_trailLen;   // @label(Trail Length) @range(0.05, 1) @default(0.35)
uniform int u_symbolSet;    // @label(Symbol Shape) @select(Blocks=0 | Dashes=1 | Dots=2 | Arrows=3 | Mixed=4) @default(0)
uniform vec3 u_tint;        // @label(Tint) @color @default(0.1, 1.0, 0.4)
uniform bool u_headGlow;    // @label(Head Glow) @default(true)
uniform vec3 u_waveColor;   // @label(Color Wave Tint) @color @default(1.0, 0.2, 0.8) @advanced
uniform float u_waveSpeed;  // @label(Color Wave Speed) @range(0, 4) @default(0) @mod @advanced @hint(0 disables it. Travels the opposite direction of the fall.)

out vec4 fragColor;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Fakes a "character" by thresholding a few hashed horizontal bars inside a cell.
// Cheap stand-in for a glyph atlas lookup — no texture asset required.
float glyphMask(vec2 cellUv, float glyphId) {
  float mask = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float barY = (fi + 0.5) / 5.0;
    float on = step(0.5, hash21(vec2(glyphId, fi + u_seed)));
    float barWidth = 0.15 + 0.5 * hash21(vec2(glyphId + fi, fi * 1.7));
    float xCenter = 0.5 + (hash21(vec2(fi, glyphId)) - 0.5) * 0.4;
    float bar = on * smoothstep(barWidth * 0.5, 0.0, abs(cellUv.x - xCenter))
                    * smoothstep(0.09, 0.0, abs(cellUv.y - barY));
    mask = max(mask, bar);
  }
  return mask;
}

// A single horizontal dash — distinct from the multi-bar "glyph" look,
// deliberately abstract rather than character-like so this stays
// visually different from Digital Matrix's actual-glyph aesthetic.
float dashMask(vec2 cellUv, float glyphId) {
  float on = step(0.4, hash21(vec2(glyphId, 11.0)));
  float w = 0.3 + 0.4 * hash21(vec2(glyphId, 12.0));
  return on * smoothstep(w * 0.5, 0.0, abs(cellUv.x - 0.5))
             * smoothstep(0.12, 0.0, abs(cellUv.y - 0.5));
}

// A single dot per cell.
float dotMask(vec2 cellUv, float glyphId) {
  float on = step(0.35, hash21(vec2(glyphId, 13.0)));
  float r = 0.12 + 0.1 * hash21(vec2(glyphId, 14.0));
  float d = length(cellUv - 0.5);
  return on * smoothstep(r, r * 0.6, d);
}

// Distance from point p to segment (a,b) — standard SDF building block.
float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// A ">" chevron — two short strokes meeting at a point. Reads as an
// arrow/direction glyph, distinct from the other three abstract shapes.
float arrowMask(vec2 cellUv, float glyphId) {
  float on = step(0.4, hash21(vec2(glyphId, 16.0)));
  float w = 0.05;
  float d1 = sdSegment(cellUv, vec2(0.28, 0.2), vec2(0.68, 0.5));
  float d2 = sdSegment(cellUv, vec2(0.68, 0.5), vec2(0.28, 0.8));
  float d = min(d1, d2);
  return on * smoothstep(w, w * 0.3, d);
}

// Dispatches to whichever symbol shape is selected — Mixed picks one
// of the four per-cell, deterministically from the cell's own glyphId
// so it doesn't flicker between shapes on the same cell frame to frame.
float symbolMask(vec2 cellUv, float glyphId) {
  if (u_symbolSet == 1) return dashMask(cellUv, glyphId);
  if (u_symbolSet == 2) return dotMask(cellUv, glyphId);
  if (u_symbolSet == 3) return arrowMask(cellUv, glyphId);
  if (u_symbolSet == 4) {
    float pick = hash21(vec2(glyphId, 15.0));
    if (pick < 0.25) return glyphMask(cellUv, glyphId);
    if (pick < 0.5) return dashMask(cellUv, glyphId);
    if (pick < 0.75) return dotMask(cellUv, glyphId);
    return arrowMask(cellUv, glyphId);
  }
  return glyphMask(cellUv, glyphId);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y;

  float cols = float(u_columns);
  float rows = float(u_rows);

  vec2 grid = uv * vec2(cols, rows);
  vec2 cellUv = fract(grid);
  float colIdx = floor(grid.x);
  float rowIdx = floor(grid.y);

  // Fall direction: pick which axis is "along" the fall (the one the
  // trail measures distance along) and which is "across" it (the one
  // that gets its own per-lane speed/phase, same role u_columns'
  // per-column variation played before this was direction-agnostic).
  // Down/Up use the original y-based fall; Left/Right reuse the exact
  // same math with x as the falling axis instead. Note: this canvas's
  // rendering treats increasing y as moving DOWN the screen (not the
  // bottom-left-origin GL convention gl_FragCoord.y would otherwise
  // suggest) — the branches below are assigned to match that, not raw
  // axis direction. Confirmed by testing: the original assignment had
  // Down and Up rendering swapped.
  float alongCoord;
  float acrossIdx;
  float alongCount;
  if (u_direction == 1) {
    alongCoord = grid.y; acrossIdx = colIdx; alongCount = rows;
  } else if (u_direction == 2) {
    alongCoord = cols - grid.x; acrossIdx = rowIdx; alongCount = cols;
  } else if (u_direction == 3) {
    alongCoord = grid.x; acrossIdx = rowIdx; alongCount = cols;
  } else {
    alongCoord = rows - grid.y; acrossIdx = colIdx; alongCount = rows;
  }

  // Per-lane fall speed + phase offset.
  float laneSeed = hash11(acrossIdx + u_seed * 13.7);
  float speed = u_fallSpeed * (0.6 + 0.8 * laneSeed);
  float phase = laneSeed * 100.0;

  float scrollPos = fract((u_time * speed + phase) / alongCount) * alongCount;
  float rowFromHead = mod(alongCoord - (alongCount - scrollPos), alongCount);

  float trailRows = u_trailLen * alongCount;
  float brightness = clamp(1.0 - rowFromHead / max(trailRows, 0.001), 0.0, 1.0);
  brightness = pow(brightness, 1.6);

  // Head glow needs to be computed before the symbol mask now, not
  // after — it used to only ADD a bit of white constrained inside the
  // glyph's own mask boundary, which is why it never visibly changed
  // anything (multiplying by a shape that was already there doesn't
  // grow it). Real fix: shrink the sampled UV toward cell-center for
  // head cells, which makes the shape itself render larger, plus a
  // separate additive halo that isn't masked by the glyph shape at
  // all — that's what makes it read as "glowing" rather than "slightly
  // brighter within its own outline."
  float headAmt = u_headGlow ? smoothstep(0.18, 0.0, rowFromHead) : 0.0;
  float headPulse = 0.6 + 0.4 * sin(u_time * 5.0 + acrossIdx * 1.7);
  vec2 sampleUv = mix(cellUv, (cellUv - 0.5) * 0.6 + 0.5, headAmt * headPulse);

  float glyphId = floor(u_time * u_swapRate + hash21(vec2(colIdx, rowIdx)) * 37.0);
  float g = symbolMask(sampleUv, glyphId + colIdx * 91.0 + rowIdx * 17.0);

  vec3 col = u_tint * g * brightness;

  if (headAmt > 0.0) {
    col += vec3(1.0) * g * headAmt * 0.7;
    float haloDist = length(cellUv - 0.5);
    float halo = headAmt * headPulse * smoothstep(0.55, 0.05, haloDist);
    col += u_tint * halo * 0.8;
  }

  // Color wave: a band that sweeps along the same axis the rain falls
  // on, moving the OPPOSITE direction from the fall itself, flashing
  // u_waveColor over whatever's currently lit. u_waveSpeed at 0 makes
  // wavePos static and the mask never reach full strength in a moving
  // way, so it's an effectively-off default without a separate toggle.
  if (u_waveSpeed > 0.0) {
    float wavePos = mod(-(u_time * u_waveSpeed) * (alongCount / 4.0), alongCount);
    float waveDist = abs(mod(alongCoord - wavePos + alongCount * 0.5, alongCount) - alongCount * 0.5);
    float waveMask = smoothstep(alongCount * 0.1, 0.0, waveDist);
    col = mix(col, u_waveColor, waveMask * 0.85 * g);
  }

  fragColor = vec4(col, 1.0);
}
