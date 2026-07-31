#version 300 es
precision highp float;

/*
 * grid-follow — Visual Mood Lab seed asset 32
 *
 * Ported from a supplied React component ("Grid Based Follow" / Prism
 * Grid) that drew one real DOM element per grid cell with CSS 3D
 * transforms and lit whichever cell sat under the cursor. That approach
 * doesn't fit this app — nothing here renders per-cell DOM nodes — but the
 * effect (a tilted grid, one region glowing where the pointer is, fading
 * with distance) maps cleanly onto the per-pixel cell math Ordered Dither
 * and Halftone Screen already do. Rebuilt as a single fragment shader.
 *
 * Two things caught during authoring, not left in: u_mouse is delivered in
 * PIXEL coordinates by the host, not normalised 0..1 — every other shader
 * that reads it divides by u_resolution first, and this one needs to as
 * well. And the pointer position is a single board-wide value with no
 * "currently hovering this card" signal, so an "auto-drift when idle"
 * toggle keyed off that would have been dead code — it can never detect
 * idle, because it never sees anything but a valid position. Replaced with
 * an explicit follow-mode select instead of a heuristic that can't work.
 */

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

uniform float u_cellSize;     // @label(Cell size) @range(8, 120) @default(40) @unit(px)
uniform float u_lineWidth;    // @label(Line width) @range(0, 4) @default(1) @unit(px)
uniform vec3 u_lineColor;     // @label(Grid lines) @color @default(1.0, 1.0, 1.0)
uniform float u_lineAlpha;    // @label(Line opacity) @range(0, 1) @default(0.2)
uniform vec3 u_bg;            // @label(Background) @color @default(0.0, 0.0, 0.0)

uniform vec3 u_litColor;      // @label(Lit region) @color @default(0.0, 0.83, 1.0)
uniform float u_trailLength;  // @label(Glow radius) @range(0, 1) @default(0.4) @hint(How far the glow reaches from the lit cell.)
uniform int u_follow;         // @label(Follow) @select(Pointer=0 | Auto drift=1) @default(1)
uniform float u_driftSpeed;   // @label(Drift speed) @range(0.05, 3) @default(0.6) @mod
uniform float u_shearX;       // @label(Tilt X) @range(-0.6, 0.6) @default(0.15) @group(Perspective)
uniform float u_shearY;       // @label(Tilt Y) @range(-0.6, 0.6) @default(0) @group(Perspective)

out vec4 fragColor;

vec2 cellAt(vec2 uv, float shearX, float shearY, float cellPx, vec2 res) {
  vec2 sheared = uv;
  sheared.x += shearX * (uv.y - 0.5);
  sheared.y += shearY * (uv.x - 0.5);
  vec2 px = sheared * res;
  return floor(px / cellPx);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float cellPx = max(u_cellSize, 4.0);

  vec2 sheared = uv;
  sheared.x += u_shearX * (uv.y - 0.5);
  sheared.y += u_shearY * (uv.x - 0.5);
  vec2 px = sheared * u_resolution;
  vec2 cell = floor(px / cellPx);
  vec2 cellUv = fract(px / cellPx);

  float lw = u_lineWidth / cellPx;
  float lineX = step(cellUv.x, lw) + step(1.0 - lw, cellUv.x);
  float lineY = step(cellUv.y, lw) + step(1.0 - lw, cellUv.y);
  float line = clamp(lineX + lineY, 0.0, 1.0);

  vec3 col = mix(u_bg, u_lineColor, line * u_lineAlpha);

  vec2 pointerUv;
  if (u_follow == 1) {
    float a = u_time * u_driftSpeed;
    pointerUv = vec2(0.5) + 0.32 * vec2(cos(a), sin(a * 1.3));
  } else {
    // u_mouse arrives in pixels — normalise the same way every other
    // pointer-aware shader in this library does.
    pointerUv = u_mouse / u_resolution;
  }
  vec2 pointerCell = cellAt(pointerUv, u_shearX, u_shearY, cellPx, u_resolution);

  float d = distance(cell, pointerCell);
  float radius = mix(0.6, 4.0, u_trailLength);
  float glow = 1.0 - smoothstep(0.0, radius, d);
  col = mix(col, u_litColor, glow);

  fragColor = vec4(col, 1.0);
}
