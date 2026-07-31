#version 300 es
precision highp float;

/*
 * pulse-lines — Visual Mood Lab seed asset 33
 *
 * Ported from a supplied "Pulse Lines" component (WaveBg) built on real
 * CSS @keyframes animating stroke-dashoffset on SVG lines — a fundamentally
 * different animation model (browser-driven CSS timing, not a per-frame
 * render loop) with no direct shader equivalent. The visible effect —
 * evenly spaced lines with a bright pulse travelling along each one,
 * staggered so the wave reads as a sweep across the whole field — is
 * rebuilt procedurally: each line's brightness is a travelling sine pulse
 * with a phase offset proportional to its position, the same staggering
 * the original achieved via a per-line CSS animation-delay.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_lineCount;    // @label(Line count) @range(4, 80) @default(24) @log
uniform float u_lineWidth;    // @label(Line width) @range(0.5, 8) @default(2) @unit(px)
uniform int u_direction;      // @label(Direction) @select(Vertical=0 | Horizontal=1) @default(0)
uniform float u_speed;        // @label(Pulse speed) @range(0.05, 3) @default(0.6) @mod
uniform float u_pulseWidth;   // @label(Pulse width) @range(0.02, 0.6) @default(0.16) @hint(How much of each line is lit at once.)
uniform float u_stagger;      // @label(Stagger) @range(0, 2) @default(1) @hint(Phase offset between neighbouring lines — zero pulses them all in unison.)

uniform vec3 u_lineColor;     // @label(Base line) @color @default(0.13, 0.13, 0.13)
uniform vec3 u_pulseColor;    // @label(Pulse) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_bg;            // @label(Background) @color @default(0.0, 0.0, 0.0)

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = u_direction == 1 ? uv.yx : uv;

  float n = max(2.0, u_lineCount);
  float lane = p.x * n;
  float laneIdx = floor(lane);
  float laneUv = fract(lane);

  float lineHalf = (u_lineWidth / u_resolution.x) * n * 0.5;
  float distToCentre = abs(laneUv - 0.5);
  float onLine = 1.0 - smoothstep(lineHalf, lineHalf + 0.02, distToCentre);

  // Travelling pulse along the line's own length, phase-staggered by lane.
  float phase = laneIdx / n * u_stagger * 6.28318;
  float travel = fract(p.y - u_time * u_speed);
  float pulse = 1.0 - smoothstep(0.0, max(u_pulseWidth, 0.001), abs(travel - 0.5) * 2.0 - (1.0 - u_pulseWidth));
  float glow = smoothstep(0.0, 1.0, sin(travel * 6.28318 + phase) * 0.5 + 0.5);
  float intensity = max(pulse, glow * 0.35);

  vec3 col = mix(u_bg, u_lineColor, onLine);
  col = mix(col, u_pulseColor, onLine * intensity);

  fragColor = vec4(col, 1.0);
}
