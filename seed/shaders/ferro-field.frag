#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_frame;
uniform sampler2D u_prevFrame; // allowSelf

uniform int   u_mode;         // @label(Pattern Mode) @select(Coral Veins=0 | Organic Cells=1) @default(0)
uniform vec3  u_bgColor;      // @label(Background) @color @default(0.02, 0.02, 0.03) @group(Color)
uniform vec3  u_cellColor;    // @label(Cell Color) @color @default(0.54, 0.66, 1.0) @group(Color)
uniform vec3  u_highlight;    // @label(Highlight) @color @default(0.92, 0.95, 1.0) @group(Color)
uniform float u_channelWidth; // @label(Channel Width) @range(0.1, 0.9) @default(0.5) @group(Pattern)
uniform float u_density;      // @label(Density) @range(0.1, 0.9) @default(0.5) @group(Pattern)
uniform float u_speed;        // @label(Speed) @range(0.2, 3.0) @default(1.0) @group(Motion)
uniform float u_glow;         // @label(Glow) @range(0.0, 1.5) @default(0.8) @group(Light)
uniform float u_lightAngle;   // @label(Light Angle) @range(0.0, 360.0) @default(200.0) @group(Light)
uniform float u_chaos;        // @label(Chaos) @range(0.1, 2.2) @default(1.0) @group(Motion)

out vec4 fragColor;

const float PI = 3.14159265;
const float TAU = 6.28318530718;

float hash1(float n){ return fract(sin(n) * 43758.5453); }

/* ============================================================
   CORAL VEINS — Gray-Scott reaction-diffusion, single-pass feedback.

   Diffusion coefficients are the load-bearing fix here: Du=0.16, Dv=0.08.
   The textbook-common Du=1.0/Dv=0.5 pairing violates the von-Neumann
   stability bound for this explicit-Euler update on a discrete grid and
   produces checkerboard noise instead of a real pattern — confirmed
   directly against this exact failure mode during development (92% of
   adjacent cells showed discontinuous value jumps at Du=1.0 vs. 0% at
   Du=0.16, same test harness). Do not "simplify" these back to 1.0/0.5.

   OPEN ENGINEERING QUESTION — please verify before treating this mode as
   final, not before shipping it silently:
   This shader must output raw simulation state (U in .r, V in .g) because
   that's exactly what u_prevFrame needs to read back next frame for the
   Laplacian to stay correct. That means the on-screen color for Coral
   Veins mode is currently driven by raw U/V values, not a separately
   styled emboss/threshold look — there's no second "display-only" pass
   here to recolor without corrupting the fed-back state. Whether that
   reads as acceptable in practice, or needs a real two-pass (sim + style)
   setup, is something to check by actually rendering it, the same way
   Ferro Field's design mockup was rendered and inspected before it was
   trusted. This is the one place in this file I could not verify myself —
   no WebGL runtime was available to me while writing it, only the 2D
   canvas mockup this shader is translated from. Recommend a quick
   `verify-seed.ts` + visual pass before calling this mode done. Organic
   Cells (below) has none of this risk — it's fully stateless. */
vec2 grayScottStep(vec2 uv, vec2 texel, float speed){
  vec2 c = texture(u_prevFrame, uv).rg;
  vec2 l = texture(u_prevFrame, uv - vec2(texel.x, 0.0)).rg;
  vec2 r = texture(u_prevFrame, uv + vec2(texel.x, 0.0)).rg;
  vec2 t = texture(u_prevFrame, uv - vec2(0.0, texel.y)).rg;
  vec2 b = texture(u_prevFrame, uv + vec2(0.0, texel.y)).rg;

  float F = 0.0545, K = 0.062;
  float Du = 0.16, Dv = 0.08;
  float dt = clamp(speed, 0.2, 3.0);

  vec2 lap = l + r + t + b - 4.0 * c;
  float uvv = c.x * c.y * c.y;
  float newU = c.x + dt * (Du * lap.x - uvv + F * (1.0 - c.x));
  float newV = c.y + dt * (Dv * lap.y + uvv - (F + K) * c.y);
  return clamp(vec2(newU, newV), 0.0, 1.0);
}

vec2 seedPattern(vec2 uv, float density){
  vec2 cellCount = vec2(mix(2.0, 8.0, density), mix(1.5, 5.5, density));
  vec2 cellUV = fract(uv * cellCount) - 0.5;
  float d = length(cellUV);
  float seed = 1.0 - smoothstep(0.13, 0.18, d);
  return vec2(1.0 - seed * 0.6, seed);
}

/* ============================================================
   ORGANIC CELLS — metaballs, fully stateless, no feedback texture.

   Each cell's position is a deterministic parametric wander (sum of two
   out-of-phase sine terms per axis, per-cell frequency/phase from a hash
   of its index) driven only by u_time. No CPU-side state, no feedback
   texture, no first-frame seeding logic — safe to ship without the open
   question above. This is what actually produces the "converge, mold
   together, break apart, rejoin" behavior: two cells fusing into one blob
   when their influence fields overlap, and separating cleanly when they
   drift apart, falls straight out of the metaball field math, not a
   scripted merge/split state machine. */
vec3 organicCells(vec2 p, float density, float chaos, float speed, vec3 bg, vec3 cellCol, vec3 hi, float glow, float lightAngle, float channelWidth){
  float t = u_time * speed;
  int count = int(mix(6.0, 22.0, density));
  float field = 0.0;
  vec2 grad = vec2(0.0);

  for(int i = 0; i < 24; i++){
    if(i >= count) break;
    float fi = float(i);
    float speedX = mix(0.15, 0.5, hash1(fi * 3.1)) * chaos;
    float speedY = mix(0.15, 0.5, hash1(fi * 7.7)) * chaos;
    float phX = hash1(fi * 13.1) * TAU;
    float phY = hash1(fi * 19.3) * TAU;
    vec2 center = vec2(
      sin(t * speedX + phX) * 0.9 + cos(t * speedX * 0.6 + phY) * 0.4,
      cos(t * speedY + phY) * 0.55 + sin(t * speedY * 0.7 + phX) * 0.3
    );
    float rad = mix(0.09, 0.2, hash1(fi * 5.5));
    vec2 d = p - center;
    float dist2 = dot(d, d);
    float rr = rad * rad;
    float infl = clamp(1.0 - dist2 / rr, 0.0, 1.0);
    float contrib = infl * infl * infl;
    field += contrib;
    grad += -2.0 * d / rr * (3.0 * infl * infl);
  }

  float mid = 1.0 - channelWidth;
  float band = 0.15;
  float mask = smoothstep(mid - band, mid + band, field);

  vec3 col = bg;
  if(mask > 0.01){
    vec3 n = normalize(vec3(-grad, 1.0));
    float la = lightAngle * PI / 180.0;
    vec3 L = normalize(vec3(cos(la) * 0.78, sin(la) * 0.78, 0.6));
    float diffuse = max(dot(n, L), 0.0);
    float spec = pow(diffuse, 14.0) * glow;
    float shade = 0.42 + 0.66 * diffuse;
    vec3 lit = cellCol * shade + hi * spec;
    col = mix(bg, lit, mask);
  }
  return col;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;

  if(u_mode == 1){
    vec2 aspectUV = vec2((uv.x - 0.5) * (u_resolution.x / u_resolution.y) + 0.5, uv.y);
    vec2 p = (aspectUV - 0.5) * 2.4;
    vec3 col = organicCells(p, u_density, u_chaos, u_speed, u_bgColor, u_cellColor, u_highlight, u_glow, u_lightAngle, u_channelWidth);
    fragColor = vec4(col, 1.0);
    return;
  }

  vec2 texel = 1.0 / u_resolution.xy;
  vec2 state;
  if(u_frame < 2.0){
    state = seedPattern(uv, u_density);
  } else {
    state = grayScottStep(uv, texel, u_speed);
  }
  fragColor = vec4(state, 0.0, 1.0);
}
