#version 300 es
precision highp float;

// Reserved / host-driven uniforms — do not annotate as controls.
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;

// --- controls ---
uniform int u_columns;      // @label(Columns) @range(8, 64) @default(32)
uniform int u_rows;         // @label(Rows) @range(8, 48) @default(24)
uniform float u_fallSpeed;  // @label(Fall Speed) @range(0.1, 4) @default(1.4) @mod
uniform float u_swapRate;   // @label(Glyph Swap Rate) @range(0.5, 12) @default(4.0) @mod
uniform float u_trailLen;   // @label(Trail Length) @range(0.05, 1) @default(0.35)
uniform vec3 u_tint;        // @label(Tint) @color @default(0.1, 1.0, 0.4)
uniform bool u_headGlow;    // @label(Head Glow) @default(true)

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

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y;

  float cols = float(u_columns);
  float rows = float(u_rows);

  vec2 grid = uv * vec2(cols, rows);
  float colIdx = floor(grid.x);
  vec2 cellUv = fract(grid);

  // Per-column fall speed + phase offset.
  float colSeed = hash11(colIdx + u_seed * 13.7);
  float speed = u_fallSpeed * (0.6 + 0.8 * colSeed);
  float phase = colSeed * 100.0;

  float scrollPos = fract((u_time * speed + phase) / rows) * rows;
  float rowFromHead = mod(grid.y - (rows - scrollPos), rows);

  float trailRows = u_trailLen * rows;
  float brightness = clamp(1.0 - rowFromHead / max(trailRows, 0.001), 0.0, 1.0);
  brightness = pow(brightness, 1.6);

  float rowIdx = floor(grid.y);
  float glyphId = floor(u_time * u_swapRate + hash21(vec2(colIdx, rowIdx)) * 37.0);
  float g = glyphMask(cellUv, glyphId + colIdx * 91.0 + rowIdx * 17.0);

  vec3 col = u_tint * g * brightness;

  if (u_headGlow) {
    float headBoost = smoothstep(0.15, 0.0, rowFromHead);
    col += vec3(1.0) * g * headBoost * 0.6;
  }

  fragColor = vec4(col, 1.0);
}
