/** terrain-wireframe — scrolling Perlin landscape mesh in WEBGL. */

export const params = {
  cols: { kind: 'stepper', label: 'Columns', min: 10, max: 140, step: 1, default: 70 },
  rows: { kind: 'stepper', label: 'Rows', min: 10, max: 140, step: 1, default: 60 },
  spacing: { kind: 'slider', label: 'Spacing', min: 6, max: 48, step: 0.5, default: 18 },
  amplitude: { kind: 'slider', label: 'Height', min: 0, max: 260, step: 1, default: 92, modulatable: true },
  noiseScale: { kind: 'slider', label: 'Terrain scale', min: 0.02, max: 0.5, step: 0.005, default: 0.11, scale: 'log' },
  speed: { kind: 'slider', label: 'Scroll speed', min: 0, max: 0.4, step: 0.002, default: 0.05, modulatable: true },
  pitch: { kind: 'slider', label: 'Camera pitch', min: 20, max: 85, step: 0.5, default: 62, unit: 'deg' },
  elevation: { kind: 'slider', label: 'Camera height', min: -400, max: 200, step: 5, default: -60 },
  weight: { kind: 'slider', label: 'Stroke weight', min: 0.2, max: 3, step: 0.05, default: 0.7 },
  lowColor: { kind: 'color', label: 'Valleys', default: { r: 0.09, g: 0.09, b: 0.11, a: 1 } },
  highColor: { kind: 'color', label: 'Peaks', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  fog: { kind: 'toggle', label: 'Distance fade', default: true },
};

export default function sketch(p, get) {
  let flying = 0;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.noFill();
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  p.draw = () => {
    p.background(0);

    const cols = Math.floor(get('cols'));
    const rows = Math.floor(get('rows'));
    const sp = get('spacing');
    const amp = get('amplitude');
    const ns = get('noiseScale');
    const lo = get('lowColor');
    const hi = get('highColor');
    const fog = get('fog');

    flying -= get('speed');

    p.strokeWeight(get('weight'));
    p.rotateX(p.radians(get('pitch')));
    p.translate((-cols * sp) / 2, get('elevation'), -rows * sp * 0.35);

    for (let y = 0; y < rows - 1; y++) {
      p.beginShape(p.TRIANGLE_STRIP);
      for (let x = 0; x < cols; x++) {
        const h0 = heightAt(x, y);
        const h1 = heightAt(x, y + 1);
        strokeFor(h0, y);
        p.vertex(x * sp, h0, y * sp);
        strokeFor(h1, y + 1);
        p.vertex(x * sp, h1, (y + 1) * sp);
      }
      p.endShape();
    }

    function heightAt(x, y) {
      return p.map(p.noise(x * ns, y * ns + flying), 0, 1, -amp, amp);
    }

    function strokeFor(h, y) {
      const t = p.constrain(p.map(h, -amp, amp, 0, 1), 0, 1);
      // Fade rows toward the horizon so depth reads without a fog shader.
      const a = fog ? p.map(y, 0, rows, 1, 0.05) : 1;
      p.stroke(p.lerp(lo.r, hi.r, t), p.lerp(lo.g, hi.g, t), p.lerp(lo.b, hi.b, t), a);
    }
  };
}
