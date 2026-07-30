#version 300 es
precision highp float;

/* halftone-screen — rotated CMYK dot screens at the classic angles
   (C 15, M 75, Y 0, K 45) to avoid moire between channels. */

uniform vec2 u_resolution;
uniform sampler2D u_src;       // @label(Source)

uniform float u_frequency;     // @label(Screen frequency) @range(4, 160) @default(42) @log @unit(lpi)
uniform float u_dotGain;       // @label(Dot gain) @range(-0.4, 0.6) @default(0.05)
uniform float u_softness;      // @label(Edge softness) @range(0.005, 0.3) @default(0.04)
uniform int u_channels;        // @label(Separation) @select(CMYK=0 | Duotone=1 | Single=2) @default(0)
uniform float u_angleOffset;   // @label(Angle offset) @range(-45, 45) @default(0) @unit(deg)
uniform vec3 u_paper;          // @label(Paper) @color @default(0.0, 0.0, 0.0)
uniform vec3 u_spot;           // @label(Spot colour) @color @default(0.0, 0.83, 1.0)
uniform bool u_showChannels;   // @label(Debug separations) @default(false) @advanced

out vec4 fragColor;

mat2 rot(float d) {
  float a = radians(d + u_angleOffset);
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

/* Coverage of one screen cell for a given ink density. */
float screen(vec2 uv, float angle, float density) {
  vec2 p = rot(angle) * uv * u_frequency;
  vec2 cell = fract(p) - 0.5;
  float radius = sqrt(clamp(density + u_dotGain, 0.0, 1.0)) * 0.72;
  return 1.0 - smoothstep(radius - u_softness, radius + u_softness, length(cell));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 src = texture(u_src, uv).rgb;

  float k = 1.0 - max(max(src.r, src.g), src.b);
  vec3 cmy = k < 1.0 ? (1.0 - src - k) / (1.0 - k) : vec3(0.0);

  if (u_channels == 2) {
    float lum = 1.0 - dot(src, vec3(0.2126, 0.7152, 0.0722));
    fragColor = vec4(mix(u_paper, u_spot, screen(uv, 45.0, lum)), 1.0);
    return;
  }

  if (u_channels == 1) {
    float lum = 1.0 - dot(src, vec3(0.2126, 0.7152, 0.0722));
    float a = screen(uv, 45.0, lum);
    float b = screen(uv, 15.0, lum * 0.7);
    fragColor = vec4(mix(u_paper, u_spot, max(a, b * 0.6)), 1.0);
    return;
  }

  float dc = screen(uv, 15.0, cmy.x);
  float dm = screen(uv, 75.0, cmy.y);
  float dy = screen(uv, 0.0, cmy.z);
  float dk = screen(uv, 45.0, k);

  if (u_showChannels) {
    fragColor = vec4(dc, dm, dy, 1.0);
    return;
  }

  vec3 col = vec3(1.0);
  col -= vec3(0.0, 1.0, 1.0) * dc;
  col -= vec3(1.0, 0.0, 1.0) * dm;
  col -= vec3(1.0, 1.0, 0.0) * dy;
  col *= 1.0 - dk;

  fragColor = vec4(mix(u_paper, clamp(col, 0.0, 1.0), 1.0), 1.0);
}
