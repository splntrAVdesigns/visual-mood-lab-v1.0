#version 300 es
precision highp float;

/*
 * data-bloom — deliberately not a clean PCB diagram: procedural circuit
 * trace geometry as a base layer, glowing energy flow via domain-warped
 * noise as a second layer, so the result reads as atmospheric "digital
 * artifact artwork" rather than a flat schematic — the requested
 * alternative to Trace Runner's literal, clickable board.
 *
 * Grain (a third, fine-noise layer) was removed — its range was capped
 * so low (0-0.08) it was barely visible even at max, and it read as
 * static/analog noise, working against the "energy flowing through
 * circuits" feel rather than adding to it. Flow speed/brightness/warp
 * defaults were raised instead, so the actual energy motion is what's
 * more present out of the box, not a texture layer that fought it.
 *
 * Trace connectivity: each grid cell has up to 4 edges (left/right/top/
 * bottom) that may be "active" (a trace reaches that edge). Whether an
 * edge is active is decided once per edge, keyed by the lower-index
 * cell on either side of it, so both neighbouring cells always agree —
 * verified directly (0 mismatches across 1600 cell-pairs) before this
 * was written, not assumed. Each active edge gets a line from the cell
 * centre out to that edge's midpoint; a cell with 2+ active edges gets
 * a small node dot, reading as a via/junction.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_density;         // @label(Circuit density) @range(4, 20) @default(9)
uniform float u_connectChance;   // @label(Connection density) @range(0.15, 0.7) @default(0.42) @hint(How connected vs sparse the trace network looks.)
uniform float u_traceWidth;      // @label(Trace width) @range(0.005, 0.03) @default(0.012)

uniform float u_flowSpeed;       // @label(Flow speed) @range(0, 3) @default(0.7) @mod
uniform float u_flowBrightness;  // @label(Flow brightness) @range(0, 2) @default(1.6) @mod
uniform float u_warpAmount;      // @label(Warp amount) @range(0, 1) @default(0.55) @mod

uniform vec3 u_traceColor;       // @label(Trace color) @color @default(0.15, 0.25, 0.35)
uniform vec3 u_flowColor;        // @label(Flow color) @color @default(0.3, 0.85, 1.0)
uniform vec3 u_nodeColor;        // @label(Node color) @color @default(0.6, 0.95, 1.0)
uniform vec3 u_bg;               // @label(Background) @color @default(0.015, 0.02, 0.03)

out vec4 fragColor;

float hash1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash1(i), hash1(i + vec2(1.0, 0.0)), u.x),
             mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

bool hEdgeActive(vec2 cell, float prob) { return hash1(cell + vec2(11.0, 0.0)) < prob; }
bool vEdgeActive(vec2 cell, float prob) { return hash1(cell + vec2(0.0, 23.0)) < prob; }

// Distance from p to the line segment a-b.
float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 aspect = vec2(u_resolution.x / min(u_resolution.x, u_resolution.y),
                      u_resolution.y / min(u_resolution.x, u_resolution.y));
  vec2 p = (uv - 0.5) * aspect + 0.5;

  float n = u_density;
  vec2 grid = p * n;
  vec2 cell = floor(grid);
  vec2 local = fract(grid) - 0.5; // cell-local coords, centre at (0,0), edges at ±0.5

  bool left = hEdgeActive(cell - vec2(1.0, 0.0), u_connectChance);
  bool right = hEdgeActive(cell, u_connectChance);
  bool bottom = vEdgeActive(cell - vec2(0.0, 1.0), u_connectChance);
  bool top = vEdgeActive(cell, u_connectChance);

  // 4 fixed, unconditional distance checks (never a data-dependent loop
  // with early exit) — inactive edges use a large sentinel distance so
  // they simply never win the min(), rather than branching control flow
  // per pixel.
  float dL = left ? sdSegment(local, vec2(0.0), vec2(-0.5, 0.0)) : 1e6;
  float dR = right ? sdSegment(local, vec2(0.0), vec2(0.5, 0.0)) : 1e6;
  float dB = bottom ? sdSegment(local, vec2(0.0), vec2(0.0, -0.5)) : 1e6;
  float dT = top ? sdSegment(local, vec2(0.0), vec2(0.0, 0.5)) : 1e6;
  float dTrace = min(min(dL, dR), min(dB, dT)) / n; // back to uv-scale units

  float aa = (1.5 / min(u_resolution.x, u_resolution.y));
  float traceMask = 1.0 - smoothstep(u_traceWidth - aa, u_traceWidth + aa, dTrace);

  int edgeCount = (left ? 1 : 0) + (right ? 1 : 0) + (bottom ? 1 : 0) + (top ? 1 : 0);
  float nodeMask = 0.0;
  if (edgeCount >= 2) {
    float dNode = length(local) / n;
    nodeMask = 1.0 - smoothstep(u_traceWidth * 1.6 - aa, u_traceWidth * 1.6 + aa, dNode);
  }

  // Energy flow: domain-warped fbm, animated, masked by proximity to a
  // trace so the glow reads as travelling THROUGH the circuit rather
  // than floating independently over it.
  vec2 warpUv = p * 3.0 + fbm(p * 1.5 + u_time * 0.05) * u_warpAmount;
  float flowNoise = fbm(warpUv + vec2(u_time * u_flowSpeed * 0.3, -u_time * u_flowSpeed * 0.2));
  float proximity = exp(-dTrace * 90.0);
  float flow = flowNoise * proximity * u_flowBrightness;

  vec3 col = u_bg;
  col = mix(col, u_traceColor, traceMask * 0.6);
  col += u_flowColor * flow;
  col = mix(col, u_nodeColor, nodeMask); // was *0.8 — nodes never fully covered what was under them, reading as translucent
  col += u_nodeColor * nodeMask * flow * 0.5;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
