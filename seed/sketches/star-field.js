/**
 * star-field — a warp-tunnel starfield with trailing streaks and
 * occasional glitter flashes.
 *
 * Ported from a supplied "Star Field" component (GlitterWrap) that was
 * already canvas2D and frame-driven, so the physics — perspective
 * projection as stars travel toward or away from a focal depth, additive
 * trails, randomised glitter timing per star — carries over closely. What's
 * dropped: Framer-specific plumbing (RenderTarget static-export detection,
 * a props-ref pattern built around Framer's live-editing model) that has
 * no equivalent or purpose in a renderer that is always either live or a
 * captured PNG, never a design-tool canvas.
 */

export const params = {
  particleCount: { kind: 'slider', label: 'Stars', min: 50, max: 1200, step: 10, default: 500, scale: 'log' },
  speed: { kind: 'slider', label: 'Speed', min: 0.5, max: 15, step: 0.1, default: 5, modulatable: true },
  density: { kind: 'slider', label: 'Spawn spread', min: 10, max: 150, step: 1, default: 100 },
  starSize: { kind: 'slider', label: 'Star size', min: 0, max: 20, step: 0.5, default: 6, modulatable: true },
  focalDepth: { kind: 'slider', label: 'Focal depth', min: 1, max: 30, step: 0.5, default: 13, unit: '%' },
  turbulence: { kind: 'slider', label: 'Turbulence', min: 0, max: 10, step: 0.1, default: 0, modulatable: true },
  brightness: { kind: 'slider', label: 'Brightness', min: 0, max: 100, step: 1, default: 100, unit: '%' },
  glitterIntensity: { kind: 'slider', label: 'Glitter', min: 0, max: 10, step: 0.1, default: 3 },
  trailAmount: { kind: 'slider', label: 'Trail', min: 0, max: 100, step: 1, default: 92, unit: '%' },
  reverse: { kind: 'toggle', label: 'Reverse (stars recede)', default: false },
  colorA: { kind: 'color', label: 'Colour A', default: { r: 1, g: 1, b: 1, a: 1 } },
  colorB: { kind: 'color', label: 'Colour B', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  colorC: { kind: 'color', label: 'Colour C', default: { r: 0.7, g: 0.15, b: 0.85, a: 1 } },
};

export default function sketch(p, get) {
  let ctx;
  let stars = [];
  let elapsed = 0;

  function cfg() {
    return {
      reverse: get('reverse'),
      density: get('density'),
      stepZ: get('speed') * 0.0008,
      focalDepth: get('focalDepth') / 100,
      starScale: get('starSize') * 0.15,
      turbulence: get('turbulence') * 0.2,
      glitter: get('glitterIntensity') * 0.1,
      brightness: Math.min(1, get('brightness') / 100),
      trail: get('trailAmount') / 100,
    };
  }

  function resetStar(s, initial) {
    const c = cfg();
    const angle = Math.random() * Math.PI * 2;
    const radius = (0.2 + Math.random() * 0.8) * (c.density / 15);
    s.x = Math.cos(angle) * radius;
    s.y = Math.sin(angle) * radius;
    if (c.reverse) {
      s.z = initial ? c.focalDepth + Math.random() * (1 - c.focalDepth) : c.focalDepth;
    } else {
      s.z = initial ? Math.random() : 1.0;
    }
    s.px = NaN;
    s.py = NaN;
    s.seed = Math.random() * 1000;
    s.vmul = 0.6 + Math.random() * 0.8;
    s.colorIdx = Math.floor(Math.random() * 3);
    s.flashUntil = 0;
    s.nextFlash = elapsed + 1 + Math.random() * 4 * (1 / Math.max(0.0001, c.glitter));
  }

  function makeStar() {
    return { x: 0, y: 0, z: 0, px: NaN, py: NaN, seed: 0, vmul: 1, colorIdx: 0, flashUntil: 0, nextFlash: 0 };
  }

  function syncCount() {
    const count = Math.max(1, Math.floor(get('particleCount')));
    if (stars.length === count) return;
    if (stars.length > count) stars.length = count;
    else while (stars.length < count) { const s = makeStar(); resetStar(s, true); stars.push(s); }
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    ctx = p.drawingContext;
    syncCount();
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  p.draw = () => {
    const c = cfg();
    syncCount();

    const colors = [get('colorA'), get('colorB'), get('colorC')];
    const rgbStrs = colors.map((col) =>
      `rgb(${Math.round(col.r * 255)}, ${Math.round(col.g * 255)}, ${Math.round(col.b * 255)})`
    );

    const w = p.width, h = p.height;
    const cx = w / 2, cy = h / 2;
    const projScale = Math.min(w, h) * 0.9;
    const dt = Math.max(0.001, Math.min(0.1, p.deltaTime / 1000)) * 60;

    const keep = Math.pow(Math.min(0.98, Math.max(0, c.trail)), dt);
    const trailAlpha = Math.max(0.02, 1 - keep);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0, 0, 0, ${trailAlpha})`;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'lighter';

    for (const s of stars) {
      const vz = c.stepZ * s.vmul * dt;
      if (c.reverse) {
        s.z += vz;
        if (s.z >= 1.0) { resetStar(s, false); continue; }
      } else {
        s.z -= vz;
        if (s.z <= c.focalDepth) { resetStar(s, false); continue; }
      }

      let tx = s.x, ty = s.y;
      if (c.turbulence > 0) {
        const t = elapsed * 1.2 + s.seed;
        const amp = c.turbulence * (1 - s.z) * 0.25;
        tx += Math.sin(t + s.seed) * amp;
        ty += Math.cos(t * 1.13 + s.seed * 0.7) * amp;
      }

      const persp = c.focalDepth / Math.max(s.z, 0.0001);
      const sx = cx + tx * persp * projScale;
      const sy = cy + ty * persp * projScale;

      if (!c.reverse && (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20)) {
        resetStar(s, false);
        continue;
      }

      let flashMult = 1;
      if (c.glitter > 0) {
        if (elapsed >= s.nextFlash && s.flashUntil < elapsed) {
          s.flashUntil = elapsed + 0.04 + Math.random() * 0.07;
          s.nextFlash = elapsed + 1 + Math.random() * 4 * (1 / Math.max(0.0001, c.glitter));
        }
        if (elapsed <= s.flashUntil) flashMult = 1 + 2.5 * c.glitter;
      }

      const sizePersp = Math.min(2.5, (c.focalDepth / Math.max(s.z, 0.0001)) * 0.6);
      const baseR = Math.max(0.25, c.starScale * (0.4 + sizePersp));
      const maxR = 1 + c.starScale * 2.5;
      const r = Math.min(baseR * flashMult, maxR);

      const lifeT = c.reverse ? s.z : 1 - s.z;
      const fadeIn = c.reverse ? Math.min(1, (s.z - c.focalDepth) / (1 - c.focalDepth) / 0.12) : 1;
      const a = Math.min(1, c.reverse ? 0.85 - lifeT * 0.6 : lifeT * 0.9 + 0.05) * fadeIn * c.brightness * (flashMult > 1 ? 1 : 0.85);

      const colStr = rgbStrs[s.colorIdx];

      if (!Number.isNaN(s.px) && !Number.isNaN(s.py)) {
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = colStr;
        ctx.lineWidth = Math.max(0.4, r * 0.4);
        ctx.beginPath();
        ctx.moveTo(s.px, s.py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }

      ctx.globalAlpha = a;
      ctx.fillStyle = colStr;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);

      if (flashMult > 1) {
        const rf = Math.min(r * 1.4, maxR * 1.4);
        ctx.globalAlpha = a * 0.5;
        ctx.fillRect(sx - rf, sy - rf, rf * 2, rf * 2);
      }

      s.px = sx;
      s.py = sy;
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    elapsed += Math.min(0.1, Math.max(0, p.deltaTime / 1000));
  };
}
