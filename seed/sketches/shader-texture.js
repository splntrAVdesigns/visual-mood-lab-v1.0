/**
 * shader-texture — a GLSL shader rendered to a graphics buffer and applied as
 * a texture on 3D geometry.
 *
 * The deliberate bridge between the two libraries: a p5 sketch consuming a
 * shader asset. If the renderer contract has a gap, this breaks first.
 */

export const params = {
  geometry: { kind: 'select', label: 'Geometry', default: 'torus', options: [
    { value: 'box', label: 'Box' },
    { value: 'sphere', label: 'Sphere' },
    { value: 'torus', label: 'Torus' },
    { value: 'cylinder', label: 'Cylinder' },
    { value: 'plane', label: 'Plane' },
  ] },
  size: { kind: 'slider', label: 'Size', min: 0.1, max: 0.6, step: 0.005, default: 0.26 },
  detail: { kind: 'stepper', label: 'Detail', min: 4, max: 64, step: 1, default: 32 },
  spinX: { kind: 'slider', label: 'Spin X', min: -1, max: 1, step: 0.005, default: 0.12, modulatable: true },
  spinY: { kind: 'slider', label: 'Spin Y', min: -1, max: 1, step: 0.005, default: 0.22, modulatable: true },
  texScale: { kind: 'slider', label: 'Texture scale', min: 0.5, max: 24, step: 0.1, default: 5, scale: 'log', modulatable: true },
  texSpeed: { kind: 'slider', label: 'Texture speed', min: 0, max: 3, step: 0.01, default: 0.4 },
  colorA: { kind: 'color', label: 'Colour A', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  colorB: { kind: 'color', label: 'Colour B', default: { r: 0.02, g: 0.02, b: 0.04, a: 1 } },
  bands: { kind: 'slider', label: 'Bands', min: 1, max: 16, step: 0.1, default: 4 },
  wireframe: { kind: 'toggle', label: 'Wireframe overlay', default: false },
  interactive: { kind: 'toggle', label: 'Drag to orbit', default: true },
};

const FRAG = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform float uScale;
uniform float uBands;
uniform vec3 uColorA;
uniform vec3 uColorB;

void main() {
  vec2 uv = vTexCoord * uScale;
  float v = sin(uv.x * 3.14159 + uTime) * cos(uv.y * 3.14159 - uTime * 0.7);
  v = fract(v * uBands * 0.25 + uTime * 0.05);
  v = smoothstep(0.35, 0.65, v);
  gl_FragColor = vec4(mix(uColorB, uColorA, v), 1.0);
}
`;

const VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
uniform mat4 uProjectionMatrix;
uniform mat4 uModelViewMatrix;

void main() {
  vTexCoord = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}
`;

export default function sketch(p, get) {
  let pg;
  let shader;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    p.colorMode(p.RGB, 1, 1, 1, 1);

    // Offscreen buffer the shader draws into, then used as a texture.
    pg = p.createGraphics(512, 512, p.WEBGL);
    shader = pg.createShader(VERT, FRAG);
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  p.draw = () => {
    p.background(0);

    const a = get('colorA');
    const b = get('colorB');

    pg.shader(shader);
    shader.setUniform('uTime', p.millis() * 0.001 * get('texSpeed'));
    shader.setUniform('uScale', get('texScale'));
    shader.setUniform('uBands', get('bands'));
    shader.setUniform('uColorA', [a.r, a.g, a.b]);
    shader.setUniform('uColorB', [b.r, b.g, b.b]);
    pg.rect(-pg.width / 2, -pg.height / 2, pg.width, pg.height);

    if (get('interactive')) p.orbitControl(1, 1, 0.1);
    p.rotateX(p.millis() * 0.0005 * get('spinX') * 6.28);
    p.rotateY(p.millis() * 0.0005 * get('spinY') * 6.28);

    p.texture(pg);
    get('wireframe') ? p.stroke(1, 1, 1, 0.15) : p.noStroke();

    const s = Math.min(p.width, p.height) * get('size');
    const d = Math.floor(get('detail'));

    switch (get('geometry')) {
      case 'box': p.box(s * 1.4); break;
      case 'sphere': p.sphere(s, d, d); break;
      case 'cylinder': p.cylinder(s * 0.8, s * 2, d, 1); break;
      case 'plane': p.plane(s * 2.6, s * 2.6, d, d); break;
      default: p.torus(s, s * 0.38, d, Math.max(6, Math.floor(d / 2)));
    }
  };
}
