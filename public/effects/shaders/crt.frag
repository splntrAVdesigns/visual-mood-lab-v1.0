// CRT — public/effects/shaders/crt.frag
//
// Barrel-distorted UV, scanlines, an RGB subpixel mask, and edge vignette
// — the standard four-ingredient CRT look. Stateless, single pass, no
// feedback buffer. Where the curved sample falls outside the frame, this
// falls back to the flat (undistorted) source rather than a hard black
// border, so curvature reads as a lens over the tile rather than a crop.
//
// BUGFIX (post-Tier-1+2 field testing): the original scanline formula
// locked the line period to exactly 2 source pixels — `sin(warped.y *
// u_resolution.y * pi)` — which is the absolute Nyquist limit for the
// render resolution: alternating brightness every single pixel row.
// Any periodic pattern at that frequency is guaranteed to alias against
// vertical motion in the underlying tile, which read as the tile's own
// drift reversing direction (a real, well-known category of visual
// artifact — the same reason real interlaced/scanned CRTs show this
// with moving content, not a code bug reversing anything). Fixed by
// exposing the line period as `u_scanlineDensity` instead of hardcoding
// it to native resolution, defaulting to a wider, less-aliasing-prone
// spacing. This reduces rather than fully eliminates the effect (any
// periodic scanline pattern will show SOME beat against fast motion) —
// push the Density control higher for a softer, less aliased look if
// it's still visible on a given tile.
//
// Contract: declare fxMain(vec2 uv) -> vec4 plus this effect's own
// uniforms (bound via Control.binding in effects/manifest.json).
// u_fxSource/u_fxMix/u_time/u_resolution and the final mix blend are
// supplied by the wrapper in lib/gl/effects-compositor.ts.

uniform float u_curvature;         // 0..0.5 — barrel distortion amount
uniform float u_scanlineIntensity; // 0..1 — how dark the scanline gaps go
uniform float u_scanlineDensity;   // 1.5..8 — vertical pixels per scanline pair; higher = fewer, thicker lines, less aliasing against motion
uniform float u_vignette;          // 0..1 — edge darkening amount
uniform float u_maskStrength;      // 0..1 — RGB subpixel mask strength

vec2 barrel(vec2 uv, float amount) {
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  c *= 1.0 + amount * r2;
  return c + 0.5;
}

vec4 fxMain(vec2 uv) {
  vec2 warped = barrel(uv, u_curvature);
  if (warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0) {
    return fxSample(uv);
  }
  vec4 src = fxSample(warped);

  float period = max(u_scanlineDensity, 1.5);
  float yPx = warped.y * u_resolution.y;
  // Integrate a sinusoid across the pixel footprint, suppressing aliases
  // when curvature or downsampling pushes scanlines above Nyquist.
  float phase = yPx * 6.2831853 / period;
  float footprint = max(fwidth(phase) * 0.5, 0.0001);
  float attenuation = sin(min(footprint, 3.14159265)) / footprint;
  float scanline = mix(1.0, 0.5 + 0.5 * sin(phase) * attenuation, u_scanlineIntensity);

  vec2 cell = mod(warped * u_resolution, 3.0);
  vec3 maskColor = cell.x < 1.0 ? vec3(1.2, 0.8, 0.8) : (cell.x < 2.0 ? vec3(0.8, 1.2, 0.8) : vec3(0.8, 0.8, 1.2));
  float maskFilter = 1.0 - smoothstep(1.0, 2.0, fwidth(warped.x * u_resolution.x));
  vec3 mask = mix(vec3(1.0), maskColor, u_maskStrength * maskFilter);

  float dist = length(warped - 0.5);
  float vig = mix(1.0, 1.0 - smoothstep(0.3, 0.75, dist), u_vignette);

  vec3 graded = src.rgb * scanline * mask * vig;
  return vec4(graded, src.a);
}
