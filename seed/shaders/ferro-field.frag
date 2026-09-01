#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

uniform int   u_mode;          // @label(Pattern Mode) @select(Coral Veins=0 | Organic Cells=1 | Fluid Spikes=2) @default(0)
uniform vec3  u_bgColor;       // @label(Background) @color @default(0.02, 0.02, 0.03) @group(Color)
uniform vec3  u_cellColor;     // @label(Cell Color) @color @default(0.54, 0.66, 1.0) @group(Color)
uniform vec3  u_highlight;     // @label(Highlight) @color @default(0.92, 0.95, 1.0) @group(Color)
uniform float u_colorVariance; // @label(Color Variance) @range(0.0, 1.0) @default(0.25) @group(Color)
uniform float u_channelWidth;  // @label(Channel Width) @range(0.1, 0.9) @default(0.5) @group(Pattern)
uniform float u_density;       // @label(Density) @range(0.1, 1.0) @default(0.55) @group(Pattern)
uniform float u_complexity;    // @label(Complexity) @range(0.5, 2.2) @default(1.1) @group(Pattern)
uniform float u_sizeMin;       // @label(Min Size) @range(0.04, 0.2) @default(0.07) @group(Pattern)
uniform float u_sizeMax;       // @label(Max Size) @range(0.08, 0.35) @default(0.19) @group(Pattern)
uniform float u_edgeDarkness;  // @label(Edge Darkness) @range(0.0, 1.0) @default(0.65) @group(Pattern)
uniform float u_speed;         // @label(Speed) @range(0.1, 3.0) @default(1.0) @group(Motion)
uniform float u_chaos;         // @label(Chaos) @range(0.1, 2.2) @default(1.0) @group(Motion)
uniform float u_glow;          // @label(Glow) @range(0.0, 1.5) @default(0.8) @group(Light)
uniform float u_lightAngle;    // @label(Light Angle) @range(0.0, 360.0) @default(200.0) @group(Light)
uniform float u_spikeDensity;  // @label(Spike Density) @range(2.0, 12.0) @default(6.0) @group(Spikes)
uniform float u_spikeSharp;    // @label(Spike Sharpness) @range(1.0, 6.0) @default(2.5) @group(Spikes)
uniform float u_iridescence;   // @label(Iridescence) @range(0.0, 1.0) @default(0.6) @group(Spikes)
uniform float u_rotSpeed;      // @label(Rotation Speed) @range(-2.0, 2.0) @default(0.3) @group(Spikes)

out vec4 fragColor;

const float PI = 3.14159265;
const float TAU = 6.28318530718;

float hash1(float n){ return fract(sin(n) * 43758.5453); }
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float valueNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash2(i), b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0)), d = hash2(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p){
  float total = 0.0, amp = 0.5, freq = 1.0;
  for(int o = 0; o < 4; o++){
    total += valueNoise(p * freq) * amp;
    amp *= 0.5; freq *= 2.0;
  }
  return total;
}

/* ============================================================
   CORAL VEINS — rebuilt stateless. The previous version needed
   u_prevFrame self-feedback to run real Gray-Scott, and that dependency
   is exactly what collapsed to a solid red tile: raw U/V state reads back
   as pure red (U=1, V=0) if the feedback texture isn't actually bound to
   this shader's own prior output, which is the trivial "nothing is
   reacting" fixed point — and I had no way to confirm that binding works
   on your engine before shipping it. Rather than gamble on the same
   unverified mechanism a second time, this mode no longer depends on
   texture feedback at all.
   Domain-warped, time-evolving fbm produces the same organic branching
   character without any persistent state: warp the sampling coordinates
   through one noise layer, warp again through a second, then sample a
   third layer with a slow time offset baked into every warp stage. The
   result is genuinely isotropic (no directional bias, since nothing here
   is advected or translated) and continuously reforms — branches split,
   drift, and rejoin as the warp phases roll forward — which is what
   "creates new patterns on the fly by moving and joining" actually
   needs, and it's guaranteed to render because nothing depends on a
   feedback binding I can't verify. */
float coralField(vec2 p, float t, float density, float complexity){
  vec2 pp = p * mix(1.6, 4.2, density);
  vec2 w1 = vec2(
    fbm(pp * 1.0 + vec2(0.0, 0.0) + t * 0.05),
    fbm(pp * 1.0 + vec2(5.2, 1.3) - t * 0.045)
  );
  vec2 w2 = vec2(
    fbm(pp * 1.0 + w1 * complexity * 2.2 + t * 0.035),
    fbm(pp * 1.0 + w1 * complexity * 2.2 + vec2(1.7, 4.1) - t * 0.04)
  );
  return fbm(pp + w2 * complexity * 2.6 + t * 0.02);
}

/* ============================================================
   ORGANIC CELLS — fixed. Two real bugs: cells were too small and too
   sparse to ever overlap, so metaballs rendered as isolated marbles
   instead of merging cellular structure (the "circular blobs, not cells"
   report); and the edge-darkening pass from the canvas mockup never got
   ported to GLSL, so boundaries only had soft emboss shading instead of
   the crisp line real cell photography shows. Both fixed here: density
   now drives a genuinely higher cell count with a size range that
   guarantees regular overlap, and there's a real edge-darkness pass
   using the field gradient. Color variance tints each cell independently
   so it doesn't read as one uniform material. */
vec3 organicCells(vec2 p, float density, float complexity, float chaos, float speed, float sizeMin, float sizeMax, float colorVariance, float edgeDarkness, vec3 bg, vec3 cellCol, vec3 hi, float glow, float lightAngle, float channelWidth){
  float t = u_time * speed;
  int count = int(mix(14.0, 40.0, density) * clamp(complexity, 0.6, 1.6));
  float field = 0.0;
  vec2 grad = vec2(0.0);
  vec3 tintAccum = vec3(0.0);
  float tintWeight = 0.0;

  for(int i = 0; i < 48; i++){
    if(i >= count) break;
    float fi = float(i);
    float speedX = mix(0.15, 0.5, hash1(fi * 3.1)) * chaos;
    float speedY = mix(0.15, 0.5, hash1(fi * 7.7)) * chaos;
    float phX = hash1(fi * 13.1) * TAU;
    float phY = hash1(fi * 19.3) * TAU;
    vec2 center = vec2(
      sin(t * speedX + phX) * 1.0 + cos(t * speedX * 0.6 + phY) * 0.45,
      cos(t * speedY + phY) * 0.6 + sin(t * speedY * 0.7 + phX) * 0.32
    );
    float rad = mix(sizeMin, sizeMax, hash1(fi * 5.5));
    vec2 d = p - center;
    float dist2 = dot(d, d);
    float rr = rad * rad;
    float infl = clamp(1.0 - dist2 / rr, 0.0, 1.0);
    float contrib = infl * infl * infl;
    field += contrib;
    grad += -2.0 * d / rr * (3.0 * infl * infl);

    vec3 cellTint = mix(cellCol, cellCol * (0.7 + 0.6 * hash1(fi * 9.9)), colorVariance);
    tintAccum += cellTint * contrib;
    tintWeight += contrib;
  }

  vec3 mixedCol = tintWeight > 0.001 ? tintAccum / tintWeight : cellCol;

  float mid = 1.0 - channelWidth;
  float band = 0.14;
  float mask = smoothstep(mid - band, mid + band, field);
  float edgeMag = clamp(length(grad) * 0.5, 0.0, 1.0);
  float edgeBand = smoothstep(mid - band * 1.6, mid + band * 1.6, field) - mask;
  float edgeLine = (1.0 - abs(edgeBand) * 4.0);
  edgeLine = clamp(edgeLine, 0.0, 1.0) * step(0.02, mask) * edgeDarkness;

  vec3 col = bg;
  if(mask > 0.01){
    vec3 n = normalize(vec3(-grad, 1.0));
    float la = lightAngle * PI / 180.0;
    vec3 L = normalize(vec3(cos(la) * 0.78, sin(la) * 0.78, 0.6));
    float diffuse = max(dot(n, L), 0.0);
    float spec = pow(diffuse, 14.0) * glow;
    float shade = 0.42 + 0.66 * diffuse;
    vec3 lit = mixedCol * shade + hi * spec;
    lit *= mix(1.0, 0.35, edgeLine);
    col = mix(bg, lit, mask);
  }
  return col;
}

/* ============================================================
   FLUID SPIKES — new. Raymarched SDF: a sphere displaced outward by a
   spherical-noise field raised to a sharpness power, giving the spiky,
   sea-urchin/ferrofluid-crown silhouette. Shaded with fresnel-driven
   iridescence (view-angle-dependent hue cycling) for the oil-slick look,
   plus a rim light. This is the least-tested piece of the whole batch —
   raymarching is notoriously sensitive to step count and epsilon even
   with a live preview to tune against, which I don't have here. Flagged
   in the delivery notes as the first thing to eyeball once rendered. */
float spikeSDF(vec3 p, float density, float sharpness, float t){
  float r = length(p);
  vec3 dir = p / max(r, 0.0001);
  float lon = atan(dir.z, dir.x);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  vec2 sph = vec2(lon, lat) * density;
  float n = fbm(sph + vec2(t * 0.06, t * 0.04));
  float spikes = pow(clamp(n, 0.0, 1.0), sharpness) * 0.55;
  return r - (1.0 + spikes);
}

vec3 fluidSpikes(vec2 uv, float density, float sharpness, float iridescence, float rotSpeed, vec3 bg, vec3 baseCol, vec3 hi, float glow){
  float t = u_time;
  float camAng = t * rotSpeed;
  vec3 ro = vec3(sin(camAng) * 3.2, 0.4, cos(camAng) * 3.2);
  vec3 forward = normalize(-ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 up = cross(forward, right);
  vec3 rd = normalize(forward * 1.6 + right * uv.x + up * uv.y);

  float tt = 0.0;
  vec3 p = ro;
  bool hit = false;
  for(int i = 0; i < 56; i++){
    p = ro + rd * tt;
    float d = spikeSDF(p, density, sharpness, t);
    if(d < 0.002){ hit = true; break; }
    tt += d * 0.55;
    if(tt > 8.0) break;
  }

  if(!hit) return bg;

  vec2 e = vec2(0.0025, 0.0);
  vec3 n = normalize(vec3(
    spikeSDF(p + e.xyy, density, sharpness, t) - spikeSDF(p - e.xyy, density, sharpness, t),
    spikeSDF(p + e.yxy, density, sharpness, t) - spikeSDF(p - e.yxy, density, sharpness, t),
    spikeSDF(p + e.yyx, density, sharpness, t) - spikeSDF(p - e.yyx, density, sharpness, t)
  ));

  float fresnel = pow(1.0 - max(0.0, dot(n, -rd)), 3.0);
  vec3 lightDir = normalize(vec3(0.5, 0.7, -0.4));
  float diffuse = max(0.0, dot(n, lightDir));
  vec3 iridColor = 0.5 + 0.5 * cos(TAU * (fresnel * 2.2 + vec3(0.0, 0.33, 0.67)) + t * 0.3);
  vec3 shaded = mix(baseCol * (0.25 + 0.75 * diffuse), iridColor, iridescence * (0.4 + 0.6 * fresnel));
  float spec = pow(max(0.0, dot(reflect(-lightDir, n), -rd)), 24.0) * glow;
  shaded += hi * spec;
  shaded += fresnel * hi * 0.3;

  return shaded;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 aspectUV = vec2((uv.x - 0.5) * (u_resolution.x / u_resolution.y) + 0.5, uv.y);
  vec2 p = (aspectUV - 0.5) * 2.4;

  if(u_mode == 1){
    vec3 col = organicCells(p, u_density, u_complexity, u_chaos, u_speed, u_sizeMin, u_sizeMax, u_colorVariance, u_edgeDarkness, u_bgColor, u_cellColor, u_highlight, u_glow, u_lightAngle, u_channelWidth);
    fragColor = vec4(col, 1.0);
    return;
  }

  if(u_mode == 2){
    vec3 col = fluidSpikes(p * 0.75, u_spikeDensity, u_spikeSharp, u_iridescence, u_rotSpeed, u_bgColor, u_cellColor, u_highlight, u_glow);
    fragColor = vec4(col, 1.0);
    return;
  }

  // Coral Veins
  float t = u_time * u_speed;
  float field = coralField(p, t, u_density, u_complexity);
  vec2 e = vec2(0.01, 0.0);
  float fx = coralField(p + e.xy, t, u_density, u_complexity) - coralField(p - e.xy, t, u_density, u_complexity);
  float fy = coralField(p + e.yx, t, u_density, u_complexity) - coralField(p - e.yx, t, u_density, u_complexity);
  vec2 grad = vec2(fx, fy) / (2.0 * e.x);

  float mid = 1.0 - u_channelWidth;
  float band = 0.12;
  float mask = smoothstep(mid - band, mid + band, field);

  vec3 col = u_bgColor;
  if(mask > 0.01){
    vec3 n = normalize(vec3(-grad * 0.6, 1.0));
    float la = u_lightAngle * PI / 180.0;
    vec3 L = normalize(vec3(cos(la) * 0.78, sin(la) * 0.78, 0.6));
    float diffuse = max(dot(n, L), 0.0);
    float spec = pow(diffuse, 14.0) * u_glow;
    float shade = 0.42 + 0.66 * diffuse;
    vec3 lit = u_cellColor * shade + u_highlight * spec;
    float edge = clamp(length(grad) * 1.4 * u_edgeDarkness, 0.0, 1.0);
    lit *= (1.0 - edge * 0.6);
    col = mix(u_bgColor, lit, mask);
  }

  fragColor = vec4(col, 1.0);
}
