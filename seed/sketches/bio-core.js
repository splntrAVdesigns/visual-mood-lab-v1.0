/**
 * bio-core — an overhead view into an underwater bio-dome. Three
 * layers, bottom to top: a textured seafloor base, several drifting
 * bioluminescent creatures, and a subtle water/caustic light effect on
 * top of everything.
 *
 * This replaces an earlier GLSL-shader version of Bio Core (a single
 * membrane organism with cilia). Rebuilt as a p5 sketch specifically
 * because the new brief calls for multiple independently-behaving
 * creatures with real character, not decoration — exactly what Synth
 * Organism's per-creature imperative loop already does well, and
 * exactly what's awkward in a fragment shader (which only ever reasons
 * per-pixel; multiple independent creature bodies means increasingly
 * convoluted analytical SDF unions with a hard-coded count ceiling).
 * The creatures follow a broad current with small local eddies. The
 * directional drift keeps the eddies open, unlike a closed orbital path.
 *
 * Contamination is a single control that does two things at once, not
 * just particle count: more debris AND murkier water, since real
 * contamination affects both.
 */

export const params = {
  creatureCount: { kind: 'stepper', label: 'Creature count', min: 2, max: 15, step: 1, default: 4 },
  creatureSize: { kind: 'slider', label: 'Creature size', min: 0.4, max: 2.5, step: 0.02, default: 1.0 },
  segmentCount: { kind: 'stepper', label: 'Segment count', min: 5, max: 20, step: 1, default: 10 },
  segmentSpacing: { kind: 'slider', label: 'Segment spacing', min: 6, max: 24, step: 0.5, default: 12, unit: 'px' },

  moveSpeed: { kind: 'slider', label: 'Move speed', min: 0.1, max: 3, step: 0.05, default: 0.8, modulatable: true },
  undulationAmount: { kind: 'slider', label: 'Undulation amount', min: 0, max: 14, step: 0.2, default: 6, unit: 'px', modulatable: true },
  undulationFreq: { kind: 'slider', label: 'Undulation frequency', min: 0.1, max: 2, step: 0.02, default: 0.5, modulatable: true },

  streamerCount: { kind: 'stepper', label: 'Trailing streamer count', min: 0, max: 6, step: 1, default: 3 },
  streamerLength: { kind: 'slider', label: 'Streamer length', min: 10, max: 80, step: 1, default: 40, unit: 'px' },

  glowColorA: { kind: 'color', label: 'Bioluminescence A', default: { r: 0.3, g: 1.0, b: 0.85, a: 1 } },
  glowColorB: { kind: 'color', label: 'Bioluminescence B', default: { r: 0.6, g: 0.4, b: 1.0, a: 1 } },
  pulseRate: { kind: 'slider', label: 'Glow pulse rate', min: 0, max: 3, step: 0.02, default: 0.9, modulatable: true },
  glow: { kind: 'slider', label: 'Glow', min: 0, max: 2, step: 0.02, default: 1.0 },

  contamination: { kind: 'slider', label: 'Contamination amount', min: 0, max: 1, step: 0.02, default: 0.3, modulatable: true, hint: 'More floating debris and murkier water at higher values — both driven by one control, since real contamination affects both.' },
  particleColor: { kind: 'color', label: 'Debris color', default: { r: 0.55, g: 0.5, b: 0.35, a: 0.8 } },

  waterEffectAmount: { kind: 'slider', label: 'Water light effect', min: 0, max: 2, step: 0.02, default: 0.8 },
  seafloorColor: { kind: 'color', label: 'Seafloor color', default: { r: 0.03, g: 0.05, b: 0.06, a: 1 } },
  trailFade: { kind: 'slider', label: 'Trail fade', min: 0, max: 0.98, step: 0.01, default: 0.85, hint: 'Higher leaves a longer glowing trail behind each creature.' },
};

export default function sketch(p, get) {
  let time = 0;
  let builtFor = '';
  let creatures = [];
  let particles = [];
  let floorBlobs = [];
  let trailLayer;

  function rebuildLayers() {
    if (trailLayer) trailLayer.remove();
    trailLayer = p.createGraphics(p.width, p.height);
    // One CSS-pixel-resolution buffer keeps trails independent of the
    // seafloor without doubling Retina/mobile offscreen memory.
    trailLayer.pixelDensity(1);
    trailLayer.colorMode(p.RGB, 1, 1, 1, 1);
    trailLayer.clear();
  }

  function createCreature(wanderSeed, colorIsA) {
    const c = { head: { x: 0, y: 0, angle: 0 }, segments: [], streamers: [], wanderSeed, colorIsA };

    c.build = () => {
      c.head = { x: Math.random() * p.width, y: Math.random() * p.height, angle: Math.random() * Math.PI * 2 };
      const n = Math.round(get('segmentCount'));
      c.segments = [];
      for (let i = 0; i < n; i++) c.segments.push({ x: c.head.x, y: c.head.y });
      const sN = Math.round(get('streamerCount'));
      c.streamers = [];
      for (let i = 0; i < sN; i++) {
        c.streamers.push({ phase: Math.random() * 6.283, angleOffset: (Math.random() - 0.5) * 1.3 });
      }
    };

    // A smooth directional current advects the creature; small local
    // eddies create curved passages without trapping it in a circle.
    c.stepHead = (dt) => {
      const head = c.head;
      const speed = get('moveSpeed') * 40;
      const u = head.x / Math.max(1, p.width);
      const v = head.y / Math.max(1, p.height);
      const current = time * 0.12 + c.wanderSeed * 0.35;
      const flowX = 1 + 0.16 * Math.cos(current) + 0.22 * Math.sin(v * 9 - time * 0.45 + c.wanderSeed);
      const flowY = 0.18 * Math.sin(current) + 0.28 * Math.sin(u * 8 + time * 0.35 + c.wanderSeed);
      const desired = Math.atan2(flowY, flowX);
      const turn = Math.atan2(Math.sin(desired - head.angle), Math.cos(desired - head.angle));
      head.angle += Math.max(-0.85 * dt, Math.min(0.85 * dt, turn));
      head.x += Math.cos(head.angle) * speed * dt;
      head.y += Math.sin(head.angle) * speed * dt;

      const m = 24;
      let wrapDX = 0, wrapDY = 0;
      if (head.x < -m) { wrapDX = (p.width + m) - head.x; head.x += wrapDX; }
      else if (head.x > p.width + m) { wrapDX = -m - head.x; head.x += wrapDX; }
      if (head.y < -m) { wrapDY = (p.height + m) - head.y; head.y += wrapDY; }
      else if (head.y > p.height + m) { wrapDY = -m - head.y; head.y += wrapDY; }
      return { wrapDX, wrapDY };
    };

    c.stepChain = () => {
      const spacing = get('segmentSpacing');
      let prev = c.head;
      for (const seg of c.segments) {
        const dx = prev.x - seg.x, dy = prev.y - seg.y;
        const dist = Math.hypot(dx, dy);
        if (dist > spacing) {
          const t = (dist - spacing) / dist;
          seg.x += dx * t;
          seg.y += dy * t;
        }
        prev = seg;
      }
    };

    return c;
  }

  function rebuildAll() {
    const n = Math.round(get('creatureCount'));
    creatures = [];
    for (let i = 0; i < n; i++) {
      const c = createCreature(1 + i * 1.7, i % 2 === 0);
      c.build();
      creatures.push(c);
    }
    floorBlobs = Array.from({ length: 5 }, () => ({
      x: Math.random() * p.width, y: Math.random() * p.height,
      r: 60 + Math.random() * 140, shade: (Math.random() - 0.5) * 0.5,
    }));
  }

  function rebuildParticles() {
    const maxParticles = 210; // 3x the previous 70 — contamination at max now reads as genuinely thick debris
    const n = Math.round(get('contamination') * maxParticles);
    while (particles.length < n) {
      particles.push({
        x: Math.random() * p.width, y: Math.random() * p.height,
        vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6,
        size: 1 + Math.random() * 3, seed: Math.random() * 100,
      });
    }
    if (particles.length > n) particles.length = n;
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    rebuildLayers();
    rebuildAll();
    rebuildParticles();
    builtFor = `${get('creatureCount')}|${get('segmentCount')}`;
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    rebuildLayers();
    rebuildAll();
    rebuildParticles();
    builtFor = `${get('creatureCount')}|${get('segmentCount')}`;
  };

  function drawSeafloor(seafloorCol, contamination) {
    const g = p;
    // Murkier water tints the floor toward the debris color as
    // contamination rises — the second effect Contamination drives,
    // beyond just particle count.
    const particleCol = get('particleColor');
    const r = seafloorCol.r + (particleCol.r - seafloorCol.r) * contamination * 0.25;
    const gColor = seafloorCol.g + (particleCol.g - seafloorCol.g) * contamination * 0.25;
    const b = seafloorCol.b + (particleCol.b - seafloorCol.b) * contamination * 0.25;

    g.noStroke();
    g.fill(r, gColor, b, 1);
    g.rect(0, 0, p.width, p.height);

    for (const blob of floorBlobs) {
      const s = Math.max(0, Math.min(1, 0.5 + blob.shade));
      g.fill(r * (0.8 + s * 0.4), gColor * (0.8 + s * 0.4), b * (0.8 + s * 0.4), 0.5);
      g.circle(blob.x, blob.y, blob.r * 2);
    }
  }

  function drawParticles(dt) {
    const col = get('particleColor');
    p.noStroke();
    for (const particle of particles) {
      particle.x += (particle.vx + Math.sin(time * 0.6 + particle.seed) * 9) * dt;
      particle.y += (particle.vy + Math.cos(time * 0.5 + particle.seed) * 9) * dt;
      if (particle.x < -10) particle.x = p.width + 10;
      if (particle.x > p.width + 10) particle.x = -10;
      if (particle.y < -10) particle.y = p.height + 10;
      if (particle.y > p.height + 10) particle.y = -10;

      const flicker = 0.5 + 0.5 * Math.sin(time * 1.5 + particle.seed * 7);
      p.fill(col.r, col.g, col.b, col.a * (0.3 + flicker * 0.4));
      p.circle(particle.x, particle.y, particle.size);
    }
  }

  function drawCreature(c, colA, colB, glowAmt, undulationAmt, undulationFreq, size, streamerLen) {
    const g = trailLayer;
    const col = c.colorIsA ? colA : colB;
    const chain = [c.head, ...c.segments];
    const drawPts = chain.map((seg, i) => {
      const nextSeg = chain[i + 1] || seg;
      const dirX = nextSeg.x - seg.x, dirY = nextSeg.y - seg.y;
      const len = Math.hypot(dirX, dirY) || 1;
      const nx = -dirY / len, ny = dirX / len;
      const wave = Math.sin(time * undulationFreq * 5 - i * 0.55 + c.wanderSeed) * undulationAmt;
      return { x: seg.x + nx * wave, y: seg.y + ny * wave, nx, ny, dirX: dirX / len, dirY: dirY / len };
    });

    // Trailing streamers — loose, longer-period ribbons off the tail,
    // distinct from the body's own tighter undulation. Drawn first so
    // the body renders on top of them.
    const tail = drawPts[drawPts.length - 1];
    if (tail) {
      g.noFill();
      for (const streamer of c.streamers) {
        g.stroke(col.r, col.g, col.b, col.a * 0.45);
        g.strokeWeight(1);
        g.beginShape();
        const steps = 6;
        for (let s = 0; s <= steps; s++) {
          const st = s / steps;
          const sway = Math.sin(time * 1.4 + streamer.phase + st * 3) * (6 + st * 10);
          const baseAngle = Math.atan2(tail.dirY, tail.dirX) + Math.PI + streamer.angleOffset;
          const px = tail.x + Math.cos(baseAngle) * streamerLen * st + Math.cos(baseAngle + Math.PI / 2) * sway * st;
          const py = tail.y + Math.sin(baseAngle) * streamerLen * st + Math.sin(baseAngle + Math.PI / 2) * sway * st;
          g.vertex(px, py);
        }
        g.endShape();
      }
      g.noStroke();
    }

    // Body — tapering segments, no legs.
    for (let i = drawPts.length - 1; i >= 0; i--) {
      const t = i / Math.max(1, drawPts.length - 1);
      const w = Math.max(1.2, (1 - t * 0.8) * 8) * size;
      g.fill(col.r, col.g, col.b, 0.5);
      g.circle(drawPts[i].x, drawPts[i].y, w * 2);
    }

    // Bioluminescent glow points along the body — every third segment,
    // not every one, plus the head always glows brightest. This is the
    // "few glow points along the body" read that separates it from
    // Synth Organism's single LED head.
    const pulse = 0.5 + 0.5 * Math.sin(time * get('pulseRate') * 6.283 + c.wanderSeed);
    for (let i = 0; i < drawPts.length; i++) {
      const isHead = i === 0;
      if (!isHead && i % 3 !== 0) continue;
      const localPulse = 0.5 + 0.5 * Math.sin(time * get('pulseRate') * 6.283 + c.wanderSeed + i * 0.9);
      const r = (isHead ? 5 + pulse * 3 : 2 + localPulse * 1.5) * size;
      if (glowAmt > 0) {
        g.drawingContext.shadowBlur = (isHead ? 16 : 8) * glowAmt * (0.5 + localPulse * 0.5);
        g.drawingContext.shadowColor = `rgba(${col.r * 255},${col.g * 255},${col.b * 255},0.9)`;
      }
      g.fill(col.r, col.g, col.b, isHead ? 0.9 : 0.75);
      g.circle(drawPts[i].x, drawPts[i].y, r * 2);
      g.drawingContext.shadowBlur = 0;
    }
  }

  function drawWaterEffect(amt) {
    if (amt <= 0) return;
    p.noStroke();
    const patches = [
      { dx: 0.25, dy: 0.3, speed: 0.05, phase: 0 },
      { dx: 0.7, dy: 0.6, speed: 0.04, phase: 2.4 },
      { dx: 0.5, dy: 0.2, speed: 0.06, phase: 4.8 },
    ];
    for (const patch of patches) {
      const x = p.width * (patch.dx + 0.08 * Math.sin(time * patch.speed + patch.phase));
      const y = p.height * (patch.dy + 0.06 * Math.cos(time * patch.speed * 0.8 + patch.phase));
      const r = Math.min(p.width, p.height) * 0.35;
      p.fill(0.7, 0.85, 1.0, 0.03 * amt);
      p.circle(x, y, r * 2);
    }
  }

  p.draw = () => {
    const key = `${get('creatureCount')}|${get('segmentCount')}`;
    if (key !== builtFor) { rebuildAll(); builtFor = key; }
    const streamerCount = Math.round(get('streamerCount'));
    for (const c of creatures) {
      while (c.streamers.length < streamerCount) {
        c.streamers.push({ phase: Math.random() * 6.283, angleOffset: (Math.random() - 0.5) * 1.3 });
      }
      c.streamers.length = streamerCount;
    }
    rebuildParticles();

    const dt = Math.min(p.deltaTime, 100) / 1000;
    time += dt;

    for (const c of creatures) {
      const shift = c.stepHead(dt);
      if (shift.wrapDX || shift.wrapDY) {
        for (const seg of c.segments) { seg.x += shift.wrapDX; seg.y += shift.wrapDY; }
      }
      c.stepChain();
    }

    const seafloorCol = get('seafloorColor');
    const contamination = get('contamination');
    const fade = get('trailFade');

    // trailFade reuses the same translucent-rect-over-previous-frame
    // technique Synth Organism already uses, layered on top of the
    // solid seafloor redraw below rather than replacing it, so the
    // seafloor itself stays crisp while creature trails still fade.
    drawSeafloor(seafloorCol, contamination);
    // Fade the transparent trail independently from the opaque seafloor.
    trailLayer.noStroke();
    trailLayer.drawingContext.globalCompositeOperation = 'destination-out';
    trailLayer.fill(0, 0, 0, 1 - fade);
    trailLayer.rect(0, 0, p.width, p.height);
    trailLayer.drawingContext.globalCompositeOperation = 'source-over';

    const colA = get('glowColorA');
    const colB = get('glowColorB');
    const glowAmt = get('glow');
    const undulationAmt = get('undulationAmount');
    const undulationFreq = get('undulationFreq');
    const size = get('creatureSize');
    const streamerLen = get('streamerLength');

    for (const c of creatures) {
      drawCreature(c, colA, colB, glowAmt, undulationAmt, undulationFreq, size, streamerLen);
    }

    p.image(trailLayer, 0, 0);
    drawParticles(dt);
    drawWaterEffect(get('waterEffectAmount'));
  };
}
