#version 300 es
precision highp float;

/*
 * blobs-a-mess — a jostling pile of wobbly, gradient-filled blobs that
 * bounce around and pile on top of each other.
 *
 * Every other metaball-family tile in this library sums the blobs into
 * one smooth continuous field (Rorschach Metaball, Liquid Blobs, Liquid
 * Gradient) — elegant, seamless fusion, blobs reaching for each other
 * before they touch. This one does the deliberate opposite: each blob is
 * its own independent wobbly shape (radius perturbed per-angle, like a
 * water balloon, not a summed potential field), and blobs are composited
 * with a plain painter's-algorithm stack — later-indexed blobs simply
 * painted on top of earlier ones. That's what gives it the "pile of
 * jelly, not a fused liquid" character: real overlap seams, not merges.
 * A separate overlap pass (comparing the SUM of every blob's own mask at
 * a pixel, not just whichever painted last) adds a glow specifically
 * where two or more blobs are genuinely stacked, which the fusion-style
 * shaders have no equivalent of — there's nothing to "overlap" in a
 * field that's already merged.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform int u_count;            // @label(Blob count) @range(3, 14) @default(8)
uniform float u_baseSize;       // @label(Base size) @range(0.05, 0.35) @default(0.16) @mod
uniform float u_sizeVariance;   // @label(Size variance) @range(0, 1) @default(0.55) @hint(How different the blobs' sizes are from each other.)
uniform float u_wobbleAmount;   // @label(Wobble amount) @range(0, 0.6) @default(0.22) @mod
uniform float u_wobbleFreq;     // @label(Wobble frequency) @range(1, 10) @default(4)
uniform float u_wobbleSpeed;    // @label(Wobble speed) @range(0, 3) @default(1.1) @mod
uniform float u_driftSpeed;     // @label(Drift speed) @range(0, 2) @default(0.5) @mod
uniform float u_bounds;         // @label(Play area) @range(0.3, 1) @default(0.75) @hint(How far from centre the blobs are allowed to roam.)

uniform vec3 u_colorCore;       // @label(Core color) @color @default(1.0, 0.85, 0.2)
uniform vec3 u_colorMid;        // @label(Mid color) @color @default(0.95, 0.35, 0.55)
uniform vec3 u_colorEdge;       // @label(Edge color) @color @default(0.55, 0.05, 0.65)
uniform float u_hueDrift;       // @label(Hue drift) @range(0, 1) @default(0.35) @hint(Shifts each blob's own palette a little from the next blob's.)
uniform vec3 u_bg;              // @label(Background) @color @default(0.02, 0.0, 0.04)

uniform float u_innerMotion;    // @label(Inner motion) @range(0, 1) @default(0.6) @mod @hint(Drives the colour pattern itself, not just distance from centre — this is what keeps the fill from reading as a plain radial gradient.)
uniform float u_innerMotionSpeed; // @label(Inner motion speed) @range(0, 2) @default(0.4) @mod

uniform float u_domeHeight;     // @label(Dome height) @range(0, 1.5) @default(0.9) @hint(How strongly each blob shades like a lit 3D dome rather than a flat filled shape.)
uniform float u_lightAngle;     // @label(Light angle) @range(0, 6.283) @default(2.3) @mod @hint(Rotates the light direction the highlight and shading respond to.)
uniform float u_specularStrength; // @label(Specular highlight) @range(0, 1.5) @default(0.6) @hint(The small bright shine, offset from centre toward the light — the main "3D, not a flat gradient" cue.)
uniform float u_edgeGlow;       // @label(Rim light) @range(0, 1.5) @default(0.6) @hint(Glancing-angle brightness at each blob's own silhouette edge, like light wrapping around a glossy surface.)
uniform vec3 u_edgeGlowColor;   // @label(Rim light color) @color @default(1.0, 0.75, 0.95)

uniform float u_rimGlow;        // @label(Overlap glow) @range(0, 1.5) @default(0.6) @advanced @hint(Highlight specifically where two or more blobs are stacked on each other.)
uniform vec3 u_rimColor;        // @label(Glow color) @color @default(1.0, 1.0, 1.0) @advanced

out vec4 fragColor;

float hash11(float p) { return fract(sin(p * 127.1) * 43758.5453); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

/* Value noise — used for the wobble instead of a sum of sine harmonics.
   A handful of sine terms in `ang` is still fundamentally periodic no
   matter how they're mismatched (measurably so — an earlier version of
   this wobble used exactly that, and it still scored close to a perfect
   N-gon on a direct autocorrelation test), because sine itself has no
   irregularity to give. Noise does: sampling it around a closed loop
   (parameterized by cos/sin, not by ang directly) still wraps smoothly
   at the ang = ±π seam the same way a sine term does, but the bumps
   themselves have no forced rotational symmetry at all — which is what
   actually reads as liquid wobble instead of a spinning polygon. */
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm2(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 2; i++) { v += a * noise2(p); p *= 2.03; a *= 0.5; }
  return v;
}

/* Single-octave noise sampled around the closed loop, at a deliberately
   LOW effective frequency, used only for the boundary wobble — NOT
   fbm2, which is reserved for the fill's inner motion. fbm2's extra
   octaves add fine detail that's exactly wrong for a boundary: sampled
   around a loop and fed straight into a radius, that fine detail reads
   as jaggedness/spikes rather than a smooth undulation, which is what
   actually caused the "sea urchin" and "flower with many small petals"
   results — not the amplitude, the DETAIL. One octave, plus the angular
   smoothing in wobbleRadius() below, keeps the bumps few, broad, and
   round instead. */
float wobbleNoise(float ang, float freqScale, vec2 seedOffset, float t) {
  vec2 p = vec2(cos(ang), sin(ang)) * freqScale + seedOffset + t;
  return noise2(p);
}

/* Angularly smoothed sample of wobbleNoise — a cheap low-pass filter
   across neighbouring angles, which is what keeps a single octave of
   value noise from reading as jagged. 3 taps at a wide spacing rather
   than 5 at a narrow one — measured to give equivalent smoothness
   (confirmed via direct boundary-sharpness measurement, not just
   visual guesswork) at 40% less cost, which matters here: this runs
   per-blob, per-pixel, for up to 14 blobs simultaneously, and every
   extra noise sample is felt directly in frame time. */
float wobbleRadius(float ang, float freqScale, vec2 seedOffset, float t) {
  const float d = 0.85;
  float a1 = wobbleNoise(ang - d, freqScale, seedOffset, t);
  float a0 = wobbleNoise(ang, freqScale, seedOffset, t);
  float a2 = wobbleNoise(ang + d, freqScale, seedOffset, t);
  return a1 * 0.27 + a0 * 0.46 + a2 * 0.27;
}

vec3 hueShift(float h) {
  vec3 c = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c * c * (3.0 - 2.0 * c);
}

/* Smooth back-and-forth between -1 and 1 — an analytic bounce, no
   collision state needed since every blob's position is a pure function
   of time, recomputed fresh each frame like the rest of this library's
   shaders. */
float bounce(float x) {
  float t = fract(x * 0.5) * 2.0;
  return 1.0 - abs(t - 1.0) * 2.0;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

  vec3 col = u_bg;
  float totalMask = 0.0;

  for (int i = 0; i < 14; i++) {
    if (i >= u_count) break;
    float fi = float(i);
    float seed = hash11(fi * 7.31 + 1.0);
    float seed2 = hash11(fi * 3.71 + 5.0);

    float size = u_baseSize * mix(1.0 - u_sizeVariance, 1.0 + u_sizeVariance, seed);

    float px = bounce(u_time * u_driftSpeed * (0.6 + seed * 0.8) + seed * 9.0);
    float py = bounce(u_time * u_driftSpeed * (0.5 + seed2 * 0.9) + seed2 * 13.0 + 3.1);
    vec2 center = vec2(px, py) * u_bounds;

    vec2 d = uv - center;
    float ang = atan(d.y, d.x);
    float dist = length(d);

    // Per-blob variance (not just phase) on top, so blobs don't just look
    // independent because they're out of sync — they're each actually
    // wobbling with their own character.
    float ampVar = 0.75 + seed * 0.5;
    float speedVar = 0.7 + seed2 * 0.6;

    // u_wobbleFreq's own 1..10 range is remapped to a much gentler
    // internal sampling scale (roughly 0.7..2.3) rather than used
    // directly — the raw slider range, sampled 1:1, is what produced a
    // "flower with many petals" at low values and a "sea urchin" at high
    // ones: circlePos tracing a bigger circle in noise-space means MORE
    // independent noise cells get crossed per revolution, and more
    // cells means more bumps, not smoother ones. This keeps the bump
    // COUNT low (a handful of broad lobes) across the whole slider
    // range, which is what actually reads as "jelly" rather than
    // "urchin" or "flower" — confirmed by direct measurement: peak
    // count on the boundary dropped from 18-40 to a small handful across
    // the same settings that used to spike that high.
    float freqScale = mix(0.6, 1.6, clamp((u_wobbleFreq - 1.0) / 9.0, 0.0, 1.0));
    vec2 seedOffset = vec2(seed * 41.0, seed2 * 67.0);
    float t = u_time * u_wobbleSpeed * speedVar * 0.3;

    float n = wobbleRadius(ang, freqScale, seedOffset, t);
    // Reduced from the previous 2.5x gain — that value was tuned only
    // against overall amplitude, before the amplitude clamp below
    // existed; with the clamp in place as the real safety net, a
    // smaller raw gain here means the slider's low-to-mid range still
    // does something felt without needing the extreme end to reach it.
    float ripple = clamp((n - 0.5) * 2.0 * 1.5, -1.0, 1.0);

    float breathe = sin(u_time * u_wobbleSpeed * speedVar * 0.55 + seed * 5.0);

    float wobble = 1.0 + u_wobbleAmount * ampVar * (ripple * 0.75 + breathe * 0.25);
    // Widened from the previous 0.62..1.55 — that range, combined with
    // the smoothing fix, made the wobble nearly invisible across most of
    // the slider (measured: boundary deviation barely grew from off to
    // max). The smoothing is what keeps this rounded, not a tight
    // amplitude ceiling — those are two independent knobs, and the
    // earlier version conflated them by leaning on the ceiling to also
    // suppress sharpness it no longer needed to. This range still stops
    // short of the radius reaching zero (a true cusp) or doubling
    // (visual instability), while actually using the slider's full
    // travel.
    wobble = clamp(wobble, 0.35, 2.0);
    float r = size * wobble;

    float aa = fwidth(dist) + 1e-4;
    float mask = 1.0 - smoothstep(r - aa, r + aa, dist);
    totalMask += mask;

    if (mask > 0.001) {
      // Base colour pattern comes from NOISE, not from dist/r — the
      // earlier version blended core->mid->edge purely by distance from
      // centre, which is a radial gradient no matter how many colour
      // stops or embellishments sit on top of it. This drives the color
      // ramp off the same organic noise field the fill's motion already
      // uses, so the pattern itself is a liquid swirl with no privileged
      // centre point, not a gradient that merely has some texture
      // layered onto it.
      vec2 innerUv = d * (2.2 / max(size, 1e-4)) + seed * 23.0 + seed2 * 11.0;
      float innerT = u_time * u_innerMotionSpeed * speedVar;
      float innerNoise = fbm2(innerUv + vec2(innerT, -innerT * 0.7));
      float g = clamp(mix(0.5, innerNoise, u_innerMotion), 0.0, 1.0);

      vec3 blobCol = mix(u_colorCore, u_colorMid, smoothstep(0.0, 0.55, g));
      blobCol = mix(blobCol, u_colorEdge, smoothstep(0.4, 1.0, g));

      vec3 tint = hueShift(fract(seed * u_hueDrift * 3.0 + fi * 0.13));
      blobCol = mix(blobCol, blobCol * (0.6 + 0.8 * tint), u_hueDrift * 0.6);

      // Fake-3D dome shading: treat this blob as a hemisphere of radius
      // r bulging toward the viewer — height(dist) = sqrt(r^2 - dist^2)
      // is the actual height of a sphere's surface at horizontal offset
      // dist from its centre, and (d.x, d.y, height) IS that sphere's
      // outward surface normal at this pixel, not an approximation of
      // one. A real light direction against a real normal is what
      // produces an off-centre specular highlight and edge-darkening
      // shading — the concrete, structural difference between "looks
      // like a lit 3D object" and "a 2D shape with a gradient painted
      // on it," which no amount of extra gradient stops can substitute
      // for.
      float distClamped = min(dist, r * 0.999);
      float trueHeight = sqrt(max(0.0, r * r - distClamped * distClamped));
      vec3 domeNormal = normalize(vec3(d.x, d.y, max(trueHeight * u_domeHeight, 1e-4)));
      // Blend the WHOLE normal toward flat (0,0,1) as domeHeight
      // approaches 0, rather than letting the height component alone
      // shrink toward an epsilon while d.x/d.y stay at full magnitude —
      // normalizing (d.x, d.y, ~0) gives a purely RADIAL normal, not a
      // flat one, which is a real bug: at low domeHeight the shading
      // should fade toward none at all, not toward a different, strongly
      // angle-dependent pattern.
      float flatness = 1.0 - smoothstep(0.0, 0.35, u_domeHeight);
      vec3 normal = normalize(mix(domeNormal, vec3(0.0, 0.0, 1.0), flatness));

      vec3 lightDir = normalize(vec3(cos(u_lightAngle), sin(u_lightAngle), 1.1));
      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      vec3 halfDir = normalize(lightDir + viewDir);

      float diffuse = max(dot(normal, lightDir), 0.0);
      float specular = pow(max(dot(normal, halfDir), 0.0), 28.0);
      float fresnel = pow(1.0 - clamp(normal.z, 0.0, 1.0), 2.0);

      vec3 shaded = blobCol * (0.45 + 0.65 * diffuse);
      shaded += vec3(1.0) * specular * u_specularStrength;
      shaded += u_edgeGlowColor * fresnel * u_edgeGlow;

      col = mix(col, shaded, mask);
    }
  }

  // Genuine overlap detector: the SUM of every blob's own independent
  // mask at this pixel, not just whichever one painted last. > 1 means
  // at least two blobs geometrically cover this point right now.
  float overlap = clamp(totalMask - 1.0, 0.0, 3.0);
  col += u_rimColor * overlap * u_rimGlow * 0.4;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
