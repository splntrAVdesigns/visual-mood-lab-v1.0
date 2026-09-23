#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

// ===== GLOBAL =====
uniform int   u_mode;          // @label(Pattern Mode) @select(Coral Veins=0 | Organic Cells=1 | Fluid Spikes=2) @default(0) @group(Global)
uniform float u_speed;         // @label(Speed) @range(0.1, 3.0) @default(1.0) @group(Global)
uniform float u_chaos;         // @label(Chaos) @range(0.1, 2.2) @default(1.0) @group(Global)
uniform float u_glow;          // @label(Glow) @range(0.0, 1.5) @default(0.8) @group(Global)
uniform float u_lightAngle;    // @label(Light Angle) @range(0.0, 360.0) @default(200.0) @group(Global)
uniform float u_crtAmount;     // @label(CRT Amount) @range(0.0, 1.0) @default(0.0) @group(Global)
uniform float u_crtScanline;   // @label(Scanline Density) @range(0.3, 3.0) @default(1.0) @group(Global) @showIf(u_crtAmount!=0)
uniform float u_chromaticAberration; // @label(Chromatic Aberration) @range(0.0, 1.0) @default(0.0) @group(Global)

// ===== COLOR =====
uniform vec3  u_bgColor;       // @label(Background) @color @default(0.02, 0.02, 0.03) @group(Color)
uniform vec3  u_cellColor;     // @label(Cell Color) @color @default(0.54, 0.66, 1.0) @group(Color)
uniform vec3  u_highlight;     // @label(Highlight) @color @default(0.92, 0.95, 1.0) @group(Color)

// ===== CORAL & CELLS =====
uniform float u_channelWidth;  // @label(Channel Width) @range(0.1, 0.9) @default(0.5) @group(Coral & Cells)
uniform float u_density;       // @label(Density) @range(0.1, 1.0) @default(0.55) @group(Coral & Cells)
uniform float u_complexity;    // @label(Complexity) @range(0.5, 2.2) @default(1.1) @group(Coral & Cells)
uniform float u_edgeDarkness;  // @label(Edge Darkness) @range(0.0, 1.0) @default(0.65) @group(Coral & Cells)

// ===== CELLS ONLY =====
uniform float u_sizeMin;       // @label(Min Size) @range(0.04, 0.2) @default(0.07) @group(Cells) @showIf(u_mode=1)
uniform float u_sizeMax;       // @label(Max Size) @range(0.08, 0.35) @default(0.19) @group(Cells) @showIf(u_mode=1)
uniform float u_colorVariance; // @label(Color Variance) @range(0.0, 1.0) @default(0.25) @group(Cells) @showIf(u_mode=1)
uniform float u_innerTexture;  // @label(Inner Texture) @range(0.0, 1.0) @default(0.55) @group(Cells) @showIf(u_mode=1)

// ===== SPIKES ONLY =====
uniform float u_spikeDensity;  // @label(Spike Density) @range(2.0, 12.0) @default(6.0) @group(Spikes) @showIf(u_mode=2)
uniform float u_spikeSharp;    // @label(Spike Sharpness) @range(1.0, 6.0) @default(2.5) @group(Spikes) @showIf(u_mode=2)
uniform float u_iridescence;   // @label(Iridescence) @range(0.0, 1.0) @default(0.6) @group(Spikes) @showIf(u_mode=2)
uniform float u_rotSpeed;      // @label(Rotation Speed) @range(-2.0, 2.0) @default(0.3) @group(Spikes) @showIf(u_mode=2)

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
float fbm(vec2 p, int octaves){
  float total = 0.0, amp = 0.5, freq = 1.0;
  for(int o = 0; o < 3; o++){
    if(o >= octaves) break;
    total += valueNoise(p * freq) * amp;
    amp *= 0.5; freq *= 2.0;
  }
  return total;
}
float fbm(vec2 p){ return fbm(p, 3); }

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

vec3 renderCoral(vec2 p, float t, float density, float complexity, float channelWidth, float edgeDarkness, float lightAngle, float glow, vec3 bg, vec3 cellColor, vec3 hi){
  float field = coralField(p, t, density, complexity);
  vec2 e = vec2(0.01, 0.0);
  float fx = coralField(p + e.xy, t, density, complexity) - coralField(p - e.xy, t, density, complexity);
  float fy = coralField(p + e.yx, t, density, complexity) - coralField(p - e.yx, t, density, complexity);
  vec2 grad = vec2(fx, fy) / (2.0 * e.x);

  float mid = 1.0 - channelWidth;
  float band = 0.12;
  float mask = smoothstep(mid - band, mid + band, field);

  vec3 col = bg;
  if(mask > 0.01){
    vec3 n = normalize(vec3(-grad * 0.6, 1.0));
    float la = lightAngle * PI / 180.0;
    vec3 L = normalize(vec3(cos(la) * 0.78, sin(la) * 0.78, 0.6));
    float diffuse = max(dot(n, L), 0.0);
    float spec = pow(diffuse, 14.0) * glow;
    float shade = 0.42 + 0.66 * diffuse;
    vec3 lit = cellColor * shade + hi * spec;
    float edge = clamp(length(grad) * 1.4 * edgeDarkness, 0.0, 1.0);
    lit *= (1.0 - edge * 0.6);
    col = mix(bg, lit, mask);
  }
  return col;
}

vec3 organicCells(vec2 p, float density, float complexity, float chaos, float speed, float sizeMin, float sizeMax, float colorVariance, float edgeDarkness, float innerTexture, vec3 bg, vec3 cellCol, vec3 hi, float glow, float lightAngle, float channelWidth){
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
  float edgeBand = smoothstep(mid - band * 1.6, mid + band * 1.6, field) - mask;
  float edgeLine = clamp(1.0 - abs(edgeBand) * 4.0, 0.0, 1.0) * step(0.02, mask) * edgeDarkness;

  vec3 col = bg;
  if(mask > 0.01){
    vec3 n = normalize(vec3(-grad, 1.0));
    float la = lightAngle * PI / 180.0;
    vec3 L = normalize(vec3(cos(la) * 0.78, sin(la) * 0.78, 0.6));
    float diffuse = max(dot(n, L), 0.0);
    float ndotv = n.z;
    float rim = pow(clamp(1.0 - ndotv, 0.0, 1.0), 2.2) * glow;

    vec2 driftUV = p * 9.0 + vec2(t * 0.07, -t * 0.05);
    float tex = fbm(driftUV);
    float tex2 = fbm(driftUV * 2.1 + 17.0 - t * 0.03);
    float texMod = mix(1.0, 0.55 + 0.75 * (tex * 0.6 + tex2 * 0.4), innerTexture);

    float shade = (0.45 + 0.5 * diffuse) * texMod;
    vec3 lit = mixedCol * shade + hi * rim * 0.4;
    lit *= mix(1.0, 0.32, edgeLine);
    col = mix(bg, lit, mask);
  }
  return col;
}

float spikeSDF(vec3 p, float density, float sharpness, float t, int octaves){
  float r = length(p);
  vec3 dir = p / max(r, 0.0001);
  float lon = atan(dir.z, dir.x);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  vec2 sph = vec2(lon, lat) * density;
  float n = fbm(sph + vec2(t * 0.06, t * 0.04), octaves);
  float spikes = pow(clamp(n, 0.0, 1.0), sharpness) * 0.55;
  return r - (1.0 + spikes);
}
float spikeSDF(vec3 p, float density, float sharpness, float t){ return spikeSDF(p, density, sharpness, t, 3); }

vec3 fluidSpikes(vec2 uv, float density, float sharpness, float iridescence, float rotSpeed, float speed, float lightAngle, vec3 bg, vec3 baseCol, vec3 hi, float glow, int maxSteps, int octaves){
  float t = u_time * speed;
  float camAng = u_time * rotSpeed;
  vec3 ro = vec3(sin(camAng) * 3.2, 0.4, cos(camAng) * 3.2);
  vec3 forward = normalize(-ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 up = cross(forward, right);
  vec3 rd = normalize(forward * 1.6 + right * uv.x + up * uv.y);

  float tt = 0.0;
  vec3 p = ro;
  bool hit = false;
  for(int i = 0; i < 56; i++){
    if(i >= maxSteps) break;
    p = ro + rd * tt;
    float d = spikeSDF(p, density, sharpness, t, octaves);
    if(d < 0.002){ hit = true; break; }
    tt += d * 0.55;
    if(tt > 8.0) break;
  }

  if(!hit) return bg;

  vec2 e = vec2(0.0025, 0.0);
  vec3 n = normalize(vec3(
    spikeSDF(p + e.xyy, density, sharpness, t, octaves) - spikeSDF(p - e.xyy, density, sharpness, t, octaves),
    spikeSDF(p + e.yxy, density, sharpness, t, octaves) - spikeSDF(p - e.yxy, density, sharpness, t, octaves),
    spikeSDF(p + e.yyx, density, sharpness, t, octaves) - spikeSDF(p - e.yyx, density, sharpness, t, octaves)
  ));

  float fresnel = pow(1.0 - max(0.0, dot(n, -rd)), 3.0);
  float la = lightAngle * PI / 180.0;
  vec3 lightDir = normalize(vec3(cos(la) * 0.7, sin(la) * 0.5 + 0.4, -0.5));
  float diffuse = max(0.0, dot(n, lightDir));
  vec3 iridColor = 0.5 + 0.5 * cos(TAU * (fresnel * 2.2 + vec3(0.0, 0.33, 0.67)) + t * 0.3);
  vec3 shaded = mix(baseCol * (0.25 + 0.75 * diffuse), iridColor, iridescence * (0.4 + 0.6 * fresnel));
  float spec = pow(max(0.0, dot(reflect(-lightDir, n), -rd)), 24.0) * glow;
  shaded += hi * spec;
  shaded += fresnel * hi * 0.3;

  return shaded;
}
vec3 fluidSpikes(vec2 uv, float density, float sharpness, float iridescence, float rotSpeed, float speed, float lightAngle, vec3 bg, vec3 baseCol, vec3 hi, float glow){
  return fluidSpikes(uv, density, sharpness, iridescence, rotSpeed, speed, lightAngle, bg, baseCol, hi, glow, 56, 3);
}

vec3 applyCRT(vec3 col, vec2 fragCoord, vec2 resolution, float amount, float scanlineDensity){
  if(amount <= 0.001) return col;
  float scan = sin(fragCoord.y * 3.14159 * scanlineDensity * 0.9);
  float scanMask = mix(1.0, 0.82 + 0.18 * scan, amount);
  vec2 uv = fragCoord / resolution;
  float vig = 1.0 - smoothstep(0.55, 1.05, length(uv - 0.5) * 1.3);
  vec3 out_ = col * scanMask;
  out_ *= mix(1.0, vig, amount * 0.7);
  out_ += amount * 0.02 * vec3(1.0);
  return out_;
}

/* CHROMATIC ABERRATION — genuine per-channel resampling, not a tint.
   The CRT pass above fakes a color fringe with a flat per-channel
   weight because a literal version there would mean re-rendering the
   whole scene three times just for a background scanline effect. This
   is different: it's the actual requested effect, so it earns the real
   cost. Each color channel is computed by re-evaluating the SAME pattern
   function at a slightly different sample position (Coral Veins, Organic
   Cells) or by re-raymarching with a slightly offset ray direction
   (Fluid Spikes) — the way real lens chromatic aberration works, where
   different wavelengths refract at slightly different angles.
   Cost note, worth knowing before this ships: Fluid Spikes already
   raymarches up to 56 steps once per pixel; with aberration enabled it
   raymarches up to three separate times (once per channel offset). That
   is a real, non-trivial GPU cost increase specifically in the mode this
   was requested for — worth a frame-time check on target hardware before
   defaulting it on, which is exactly why it defaults to 0. */
void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 aspectUV = vec2((uv.x - 0.5) * (u_resolution.x / u_resolution.y) + 0.5, uv.y);
  vec2 p = (aspectUV - 0.5) * 2.4;

  vec3 col;
  // Throttled from 0.045 — Chromatic Aberration's offset was reaching
  // further than the effect needed to read clearly, which is both a
  // visual and (via Fluid Spikes' raymarch cost below) a performance
  // problem for no real benefit.
  float caAmt = u_chromaticAberration * 0.03;
  bool doCA = u_chromaticAberration > 0.003;

  if(u_mode == 1){
    col = organicCells(p, u_density, u_complexity, u_chaos, u_speed, u_sizeMin, u_sizeMax, u_colorVariance, u_edgeDarkness, u_innerTexture, u_bgColor, u_cellColor, u_highlight, u_glow, u_lightAngle, u_channelWidth);
    if(doCA){
      vec3 colR = organicCells(p + vec2(caAmt,0.0), u_density, u_complexity, u_chaos, u_speed, u_sizeMin, u_sizeMax, u_colorVariance, u_edgeDarkness, u_innerTexture, u_bgColor, u_cellColor, u_highlight, u_glow, u_lightAngle, u_channelWidth);
      vec3 colB2 = organicCells(p - vec2(caAmt,0.0), u_density, u_complexity, u_chaos, u_speed, u_sizeMin, u_sizeMax, u_colorVariance, u_edgeDarkness, u_innerTexture, u_bgColor, u_cellColor, u_highlight, u_glow, u_lightAngle, u_channelWidth);
      col = vec3(colR.r, col.g, colB2.b);
    }

  } else if(u_mode == 2){
    col = fluidSpikes(p * 0.75, u_spikeDensity, u_spikeSharp, u_iridescence, u_rotSpeed, u_speed, u_lightAngle, u_bgColor, u_cellColor, u_highlight, u_glow);
    if(doCA){
      // Adaptive quality: these two samples are a thin color fringe, not
      // the hero image — the eye doesn't need full raymarch precision or
      // fbm detail here the way it does for the primary pass above. This
      // is what actually removes most of Chromatic Aberration's extra
      // cost in this mode specifically (56-step raymarch x3 was the real
      // bottleneck, not CRT, which is O(1) per pixel and cheap on its
      // own). Main pass above is untouched — 56 steps, 3 octaves — so
      // rendering with Chromatic Aberration off is completely unaffected.
      vec3 colR = fluidSpikes(p * 0.75 + vec2(caAmt,0.0), u_spikeDensity, u_spikeSharp, u_iridescence, u_rotSpeed, u_speed, u_lightAngle, u_bgColor, u_cellColor, u_highlight, u_glow, 24, 2);
      vec3 colB2 = fluidSpikes(p * 0.75 - vec2(caAmt,0.0), u_spikeDensity, u_spikeSharp, u_iridescence, u_rotSpeed, u_speed, u_lightAngle, u_bgColor, u_cellColor, u_highlight, u_glow, 24, 2);
      col = vec3(colR.r, col.g, colB2.b);
    }

  } else {
    float t = u_time * u_speed;
    col = renderCoral(p, t, u_density, u_complexity, u_channelWidth, u_edgeDarkness, u_lightAngle, u_glow, u_bgColor, u_cellColor, u_highlight);
    if(doCA){
      vec3 colR = renderCoral(p + vec2(caAmt,0.0), t, u_density, u_complexity, u_channelWidth, u_edgeDarkness, u_lightAngle, u_glow, u_bgColor, u_cellColor, u_highlight);
      vec3 colB2 = renderCoral(p - vec2(caAmt,0.0), t, u_density, u_complexity, u_channelWidth, u_edgeDarkness, u_lightAngle, u_glow, u_bgColor, u_cellColor, u_highlight);
      col = vec3(colR.r, col.g, colB2.b);
    }
  }

  col = applyCRT(col, gl_FragCoord.xy, u_resolution, u_crtAmount, u_crtScanline);
  fragColor = vec4(col, 1.0);
}
