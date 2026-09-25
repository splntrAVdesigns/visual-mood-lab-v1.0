/**
 * synth-organism — a segmented, jointed creature (worm/centipede
 * locomotion, not a blob) with a pulsing LED head, deliberately the
 * opposite build from this library's other digital-organism tile
 * (Bio Core, a soft metaball body): a skeletal follow-chain instead of
 * a membrane, so the set has genuine variety in what "alive" looks like.
 *
 * Locomotion: the head wanders via smooth noise-driven steering (plus a
 * gentle, configurable evasion of the pointer — "feels alive when
 * interacting" taken literally, a mild startle response rather than
 * either ignoring the pointer or being drawn to it); each body segment
 * follows the one ahead of it at a fixed spacing, the standard IK
 * follow-chain technique, tapering in width toward the tail. A
 * perpendicular sine offset per segment layers a swimming-style
 * undulation on top of the chain's own path without disturbing the
 * chain's actual positions, so undulation amount and movement speed are
 * independent knobs rather than coupled side effects of each other.
 *
 * Second organism (optional, via toggle): a genuine second creature,
 * not a visual duplicate — its own wander seed (decorrelated steering,
 * not a mirrored path), its own speed multiplier, and an LED/body tint
 * distinct from the first. The two mutually avoid each other exactly
 * like each already avoids the pointer (steering-based, so turns read
 * as organic), PLUS a hard positional separation enforced every frame
 * as a floor under that steering — belt-and-suspenders, because
 * steering alone can still let two fast-moving things graze past each
 * other for a frame if they're closing head-on faster than the turn can
 * react. The hard separation makes actual contact structurally
 * impossible regardless of speed or steering lag. Note this guarantee
 * is head-to-head — an extreme body posture (a long tail curled back on
 * itself) isn't separately checked, so it's "practically never touch"
 * for the body as a whole, not a hard guarantee for every segment.
 */

export const params = {
  segmentCount: { kind: 'stepper', label: 'Segment count', min: 6, max: 30, step: 1, default: 16 },
  segmentSpacing: { kind: 'slider', label: 'Segment spacing', min: 6, max: 30, step: 0.5, default: 14, unit: 'px' },
  scale: { kind: 'slider', label: 'Scale', min: 0.4, max: 2.5, step: 0.02, default: 1.0, hint: 'Overall size of the organism — body width, legs, and LED head. Segment spacing has its own control above if you also want the chain longer/shorter.' },

  moveSpeed: { kind: 'slider', label: 'Move speed', min: 0.2, max: 4, step: 0.05, default: 1.2, modulatable: true },
  undulationAmount: { kind: 'slider', label: 'Undulation amount', min: 0, max: 12, step: 0.2, default: 5, unit: 'px', modulatable: true },
  undulationFreq: { kind: 'slider', label: 'Undulation frequency', min: 0.1, max: 2, step: 0.02, default: 0.6, modulatable: true },
  pointerAvoid: { kind: 'slider', label: 'Pointer wariness', min: 0, max: 2, step: 0.02, default: 0.6, hint: 'How strongly the organism steers away from the pointer.' },

  legPairs: { kind: 'stepper', label: 'Leg pairs', min: 0, max: 10, step: 1, default: 6 },
  legLength: { kind: 'slider', label: 'Leg length', min: 3, max: 20, step: 0.5, default: 9, unit: 'px' },
  legSpeed: { kind: 'slider', label: 'Leg walk speed', min: 0, max: 6, step: 0.05, default: 2.2, modulatable: true },

  ledPulseRate: { kind: 'slider', label: 'LED pulse rate', min: 0, max: 4, step: 0.02, default: 1.3, modulatable: true },
  ledColor: { kind: 'color', label: 'LED color', default: { r: 0.4, g: 1.0, b: 0.75, a: 1 } },
  bodyColor: { kind: 'color', label: 'Body color', default: { r: 0.15, g: 0.35, b: 0.4, a: 1 } },
  legColor: { kind: 'color', label: 'Leg color', default: { r: 0.4, g: 1.0, b: 0.75, a: 0.6 } },
  glow: { kind: 'slider', label: 'Glow', min: 0, max: 2, step: 0.02, default: 0.9 },
  trailFade: { kind: 'slider', label: 'Trail fade', min: 0, max: 0.98, step: 0.01, default: 0.88, hint: 'Higher leaves a longer glowing trail behind the organism.' },
  bgColor: { kind: 'color', label: 'Background', default: { r: 0.01, g: 0.02, b: 0.03, a: 1 } },

  secondOrganism: { kind: 'toggle', label: 'Second organism', default: false },
  organism2LedColor: { kind: 'color', label: 'Organism 2 LED color', default: { r: 1.0, g: 0.5, b: 0.85, a: 1 }, showIf: { equals: ['secondOrganism', true] }, hint: 'Body and leg color are automatically tinted toward this, so the second organism reads as related but distinct.' },
  organism2SpeedMult: { kind: 'slider', label: 'Organism 2 speed', min: 0.5, max: 2, step: 0.05, default: 1.15, showIf: { equals: ['secondOrganism', true] }, hint: "Multiplies the shared Move speed above, so it doesn't move in lockstep with the first." },
};

function noise1(seed, t) {
  const hash = (n) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

function lerpColor(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

export default function sketch(p, get) {
  function createOrganism(wanderSeed) {
    const org = { head: { x: 0, y: 0, angle: 0 }, segments: [], builtFor: '', wanderSeed,
      cruiseHeading: 0, cruiseTimer: 0, progressTimer: 0, originX: 0, originY: 0 };

    org.build = () => {
      org.head = { x: p.width / 2 + (wanderSeed - 1) * 60, y: p.height / 2, angle: Math.random() * Math.PI * 2 };
      org.cruiseHeading = org.head.angle;
      org.cruiseTimer = 0;
      org.progressTimer = 0;
      org.originX = org.head.x; org.originY = org.head.y;
      const n = Math.round(get('segmentCount'));
      org.segments = [];
      for (let i = 0; i < n; i++) org.segments.push({ x: org.head.x, y: org.head.y });
    };

    org.stepHead = (dt, speedMult, otherHead, avoidMutual) => {
      const head = org.head;
      const speed = get('moveSpeed') * speedMult * 40;
      // Cruise along a heading for several seconds. A new heading changes
      // the path gradually; slow noise only bends it slightly between goals.
      org.cruiseTimer -= dt;
      if (org.cruiseTimer <= 0) {
        org.cruiseHeading = head.angle + (noise1(org.wanderSeed + 8, time * 0.37) - 0.5) * 1.4;
        org.cruiseTimer = 3 + noise1(org.wanderSeed + 12, time * 0.21) * 3;
      }
      let targetAngle = org.cruiseHeading + (noise1(org.wanderSeed, time * 0.28) - 0.5) * 0.35;

      const avoid = get('pointerAvoid');
      if (avoid > 0) {
        const dx = head.x - p.mouseX, dy = head.y - p.mouseY;
        const dist = Math.hypot(dx, dy);
        const radius = 140;
        if (dist < radius && dist > 0.001) {
          const away = Math.atan2(dy, dx);
          const strength = (1 - dist / radius) * avoid;
          targetAngle += Math.atan2(Math.sin(away - targetAngle), Math.cos(away - targetAngle)) * Math.min(1, strength);
        }
      }

      if (otherHead && avoidMutual > 0) {
        const dx = head.x - otherHead.x, dy = head.y - otherHead.y;
        const dist = Math.hypot(dx, dy);
        const radius = 150;
        if (dist < radius && dist > 0.001) {
          const away = Math.atan2(dy, dx);
          const strength = (1 - dist / radius) * avoidMutual;
          targetAngle += Math.atan2(Math.sin(away - targetAngle), Math.cos(away - targetAngle)) * Math.min(1, strength);
        }
      }

      const turn = Math.atan2(Math.sin(targetAngle - head.angle), Math.cos(targetAngle - head.angle));
      head.angle += Math.max(-1.1 * dt, Math.min(1.1 * dt, turn));
      head.x += Math.cos(head.angle) * speed * dt;
      head.y += Math.sin(head.angle) * speed * dt;

      org.progressTimer += dt;
      if (org.progressTimer >= 5) {
        // A short closed orbit should not become the permanent itinerary.
        if (Math.hypot(head.x - org.originX, head.y - org.originY) < speed * 1.4) {
          org.cruiseHeading = head.angle + 0.45;
          org.cruiseTimer = 4;
        }
        org.progressTimer = 0;
        org.originX = head.x; org.originY = head.y;
      }

      const m = 20;
      let wrapDX = 0, wrapDY = 0;
      if (head.x < -m) { wrapDX = (p.width + m) - head.x; head.x += wrapDX; }
      else if (head.x > p.width + m) { wrapDX = -m - head.x; head.x += wrapDX; }
      if (head.y < -m) { wrapDY = (p.height + m) - head.y; head.y += wrapDY; }
      else if (head.y > p.height + m) { wrapDY = -m - head.y; head.y += wrapDY; }
      org.originX += wrapDX; org.originY += wrapDY;

      return { wrapDX, wrapDY };
    };

    org.stepChain = () => {
      const spacing = get('segmentSpacing');
      let prev = org.head;
      for (const seg of org.segments) {
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

    return org;
  }

  const orgA = createOrganism(1);
  const orgB = createOrganism(2.7);

  let time = 0;
  let builtFor = '';

  function enforceSeparation(headA, headB) {
    const minDist = 42 * Math.max(get('scale'), 0.4);
    const dx = headA.x - headB.x, dy = headA.y - headB.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    if (dist < minDist) {
      const push = (minDist - dist) / 2;
      const ux = dx / dist, uy = dy / dist;
      headA.x += ux * push; headA.y += uy * push;
      headB.x -= ux * push; headB.y -= uy * push;
    }
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    orgA.build();
    orgB.build();
    builtFor = `${get('segmentCount')}`;
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    orgA.build();
    orgB.build();
    builtFor = `${get('segmentCount')}`;
  };

  function drawOrganism(org, ledColor, bodyColor, legColor, glowAmt, undulationAmt, undulationFreq, legPairs, legLen, legSpeed, scale) {
    const chain = [org.head, ...org.segments];
    const drawPts = chain.map((seg, i) => {
      const nextSeg = chain[i + 1] || seg;
      const dirX = nextSeg.x - seg.x, dirY = nextSeg.y - seg.y;
      const len = Math.hypot(dirX, dirY) || 1;
      const nx = -dirY / len, ny = dirX / len;
      const wave = Math.sin(time * undulationFreq * 6 - i * 0.6 + org.wanderSeed) * undulationAmt;
      return { x: seg.x + nx * wave, y: seg.y + ny * wave, nx, ny };
    });

    p.noStroke();
    for (let i = drawPts.length - 1; i >= 0; i--) {
      const t = i / Math.max(1, drawPts.length - 1);
      const w = Math.max(1.5, (1 - t * 0.85) * 10) * scale;
      p.fill(bodyColor.r, bodyColor.g, bodyColor.b, bodyColor.a);
      p.circle(drawPts[i].x, drawPts[i].y, w * 2);

      if (legPairs > 0 && i > 0 && i < drawPts.length - 1 && i % Math.max(1, Math.floor(drawPts.length / (legPairs + 1))) === 0) {
        const swing = Math.sin(time * legSpeed * 5 + i * 1.3 + org.wanderSeed) * 0.6;
        p.stroke(legColor.r, legColor.g, legColor.b, legColor.a);
        p.strokeWeight(1.2);
        const pt = drawPts[i];
        const legX = pt.nx * legLen * (1 + swing * 0.4);
        const legY = pt.ny * legLen * (1 + swing * 0.4);
        p.line(pt.x, pt.y, pt.x + legX + pt.ny * swing * 4, pt.y + legY - pt.nx * swing * 4);
        p.line(pt.x, pt.y, pt.x - legX - pt.ny * swing * 4, pt.y - legY + pt.nx * swing * 4);
        p.noStroke();
      }
    }

    const pulse = 0.5 + 0.5 * Math.sin(time * get('ledPulseRate') * 6.283 + org.wanderSeed);
    if (glowAmt > 0) {
      p.drawingContext.shadowBlur = 18 * glowAmt * (0.5 + pulse * 0.5);
      p.drawingContext.shadowColor = `rgba(${ledColor.r * 255},${ledColor.g * 255},${ledColor.b * 255},0.9)`;
    }
    p.fill(ledColor.r, ledColor.g, ledColor.b, ledColor.a * (0.6 + pulse * 0.4));
    p.circle(drawPts[0].x, drawPts[0].y, (6 + pulse * 4) * scale);
    p.drawingContext.shadowBlur = 0;
  }

  p.draw = () => {
    const key = `${get('segmentCount')}`;
    if (key !== builtFor) { orgA.build(); orgB.build(); builtFor = key; }

    const dt = Math.min(p.deltaTime, 100) / 1000;
    time += dt;

    const secondActive = get('secondOrganism');
    const avoidMutual = secondActive ? Math.max(get('pointerAvoid'), 0.8) : 0;

    const shiftA = orgA.stepHead(dt, 1, secondActive ? orgB.head : null, avoidMutual);
    if (shiftA.wrapDX || shiftA.wrapDY) {
      for (const seg of orgA.segments) { seg.x += shiftA.wrapDX; seg.y += shiftA.wrapDY; }
    }

    if (secondActive) {
      const shiftB = orgB.stepHead(dt, get('organism2SpeedMult'), orgA.head, avoidMutual);
      if (shiftB.wrapDX || shiftB.wrapDY) {
        for (const seg of orgB.segments) { seg.x += shiftB.wrapDX; seg.y += shiftB.wrapDY; }
      }
      enforceSeparation(orgA.head, orgB.head);
    }

    orgA.stepChain();
    if (secondActive) orgB.stepChain();

    const bg = get('bgColor');
    const fade = get('trailFade');
    p.fill(bg.r, bg.g, bg.b, 1 - fade);
    p.noStroke();
    p.rect(0, 0, p.width, p.height);

    const body = get('bodyColor');
    const legCol = get('legColor');
    const led = get('ledColor');
    const glowAmt = get('glow');
    const undulationAmt = get('undulationAmount');
    const undulationFreq = get('undulationFreq');
    const legPairs = Math.round(get('legPairs'));
    const legLen = get('legLength') * get('scale');
    const legSpeed = get('legSpeed');
    const scale = get('scale');

    drawOrganism(orgA, led, body, legCol, glowAmt, undulationAmt, undulationFreq, legPairs, legLen, legSpeed, scale);

    if (secondActive) {
      const led2 = get('organism2LedColor');
      const body2 = lerpColor(body, led2, 0.3);
      const legCol2 = lerpColor(legCol, led2, 0.2);
      drawOrganism(orgB, led2, body2, legCol2, glowAmt, undulationAmt, undulationFreq, legPairs, legLen, legSpeed, scale);
    }
  };
}
