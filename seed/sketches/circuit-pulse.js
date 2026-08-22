/**
 * circuit-pulse — a PCB-trace network on a dot-grid field. Light pulses
 * travel node to node along the traces; clicking a node fires a burst
 * that propagates outward wave-like along its connections, each hop
 * spawning fresh pulses on the far node's OTHER edges (not back the way
 * it came), decaying by hop count so it dies out rather than running
 * forever. Nodes also fire on their own at a configurable rate, so the
 * board stays visibly alive without needing a click.
 *
 * Same concept as an earlier build of this idea, rebuilt clean after
 * that one accumulated a corrupted saved param that crashed the
 * renderer on resize. Two things are different here as a direct result:
 *
 *   1. Every color read goes through swatch(), a tiny local guard that
 *      falls back to a known-good default if get() ever returns
 *      anything other than a real {r,g,b,a} object. Belt-and-suspenders
 *      on top of the renderer's own hydrate() fix — this sketch just
 *      can't crash on a bad color no matter what's sitting in a saved
 *      params row.
 *   2. build() no longer runs at all until the canvas has real
 *      dimensions, so a resize firing before the first meaningful frame
 *      can't hand the layout code a zero-size board to lay nodes out on.
 *
 * Three eras, one simulation. `eraMode` doesn't switch sketches, it
 * switches RENDERERS over the same node/edge/pulse graph — same
 * separation the project's control-schema docs already call for between
 * layout and drawing:
 *
 *   1980 Circuitry — the original look. Straight two-segment bends,
 *                    square nodes, thin traces.
 *   Modern         — curved traces (quadratic bezier through the same
 *                    bend point 1980 uses as a right-angle elbow), a
 *                    subset of high-degree nodes rendered as chips with
 *                    lit solder-prong ticks, a via-pattern board texture.
 *   Future         — no visible wire at all. Traces are dim ambient
 *                    light beams; pulses are bright traveling light,
 *                    not moving dots on a line.
 *
 * `layoutMode` is a second, independent axis — it only changes how
 * build() places nodes, never how they're drawn — so any era can be
 * paired with any topology.
 *
 * Both `eraMode` and `layoutMode` trigger an automatic reseed on change
 * (see seedBump below), so switching either never leaves a layout that
 * was tuned for a different aesthetic sitting under the new one. This
 * also fixes a real pre-existing bug: the manual "Regenerate layout"
 * trigger used to call build() with a seed formula based only on
 * nodeCount, which means at a fixed node count it deterministically
 * reproduced the exact same graph every time — clicking it visibly did
 * nothing. seedBump is now folded into the seed and incremented on both
 * the manual trigger and an era/layout change, so both actually
 * regenerate a new graph now.
 */

export const params = {
  eraMode: {
    kind: 'select', label: 'Era', default: '1980',
    options: [
      { value: '1980', label: '1980 Circuitry' },
      { value: 'modern', label: 'Modern' },
      { value: 'future', label: 'Future' },
    ],
  },
  layoutMode: {
    kind: 'select', label: 'Layout', default: 'organic',
    options: [
      { value: 'organic', label: 'Organic' },
      { value: 'radial', label: 'Radial' },
      { value: 'clustered', label: 'Clustered' },
    ],
    hint: 'How nodes are placed — independent of Era, any layout works with any look.',
  },

  nodeCount: { kind: 'stepper', label: 'Node count', min: 10, max: 100, step: 1, default: 22 },
  gridDensity: { kind: 'slider', label: 'Background grid density', min: 8, max: 30, step: 1, default: 16 },

  pulseSpeed: { kind: 'slider', label: 'Pulse speed', min: 0.2, max: 3, step: 0.05, default: 1.0, modulatable: true, hint: 'How fast light travels along a trace.' },
  autoFireRate: { kind: 'slider', label: 'Auto-fire rate', min: 0, max: 2, step: 0.02, default: 0.3, unit: '/s', modulatable: true, hint: 'How often a random node fires on its own, without a click.' },
  maxHops: { kind: 'stepper', label: 'Propagation reach', min: 1, max: 8, step: 1, default: 4, hint: 'How many nodes a single trigger propagates through before dying out.' },
  branchChance: { kind: 'slider', label: 'Branch chance', min: 0, max: 1, step: 0.02, default: 0.85, modulatable: true, hint: 'Chance each additional edge on a lit node also lights up, instead of the wave narrowing to one path.' },

  glow: { kind: 'slider', label: 'Glow', min: 0, max: 2, step: 0.02, default: 0.9 },
  beamWidth: { kind: 'slider', label: 'Thickness', min: 2, max: 40, step: 0.5, default: 14, unit: 'px', showIf: { equals: ['eraMode', 'future'] }, hint: 'Scales the light beams and node size together, in relation.' },

  coolColor: { kind: 'color', label: 'Cool node color', default: { r: 0.3, g: 0.55, b: 1.0, a: 1 } },
  warmColor: { kind: 'color', label: 'Warm node color', default: { r: 1.0, g: 0.65, b: 0.25, a: 1 } },
  traceColor: { kind: 'color', label: 'Trace color', default: { r: 0.5, g: 0.55, b: 0.65, a: 0.35 } },
  gridColor: { kind: 'color', label: 'Background grid', default: { r: 0.4, g: 0.45, b: 0.55, a: 0.32 } },
  bgColor: { kind: 'color', label: 'Background', default: { r: 0.02, g: 0.02, b: 0.03, a: 1 } },

  nodeSize: { kind: 'slider', label: 'Node size', min: 4, max: 28, step: 0.5, default: 9, unit: 'px' },
  reseed: { kind: 'trigger', label: 'Regenerate layout', default: null, event: 'reseed' },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fallback constants mirror each color control's own `default` above —
// kept as plain literals rather than reading control.default at runtime
// so this guard has zero dependency on the schema even existing yet.
const FALLBACK = {
  coolColor: { r: 0.3, g: 0.55, b: 1.0, a: 1 },
  warmColor: { r: 1.0, g: 0.65, b: 0.25, a: 1 },
  traceColor: { r: 0.5, g: 0.55, b: 0.65, a: 0.35 },
  gridColor: { r: 0.4, g: 0.45, b: 0.55, a: 0.32 },
  bgColor: { r: 0.02, g: 0.02, b: 0.03, a: 1 },
};

function isRGBA(v) {
  return !!v && typeof v === 'object'
    && typeof v.r === 'number' && typeof v.g === 'number'
    && typeof v.b === 'number' && typeof v.a === 'number';
}

export default function sketch(p, get) {
  let rand = mulberry32(0x5eed);
  let nodes = [];
  let edges = [];
  let adjacency = [];
  let pulses = [];
  let builtFor = '';
  let autoFireAcc = 0;
  let time = 0; // dt-integrated, not frameCount — animates smoothly regardless of frame rate

  // Bumped on the manual "Regenerate layout" trigger and on any
  // eraMode/layoutMode change — folded into build()'s seed so both
  // actually produce a different graph instead of deterministically
  // reproducing the same one at a fixed node count. See file header.
  let seedBump = 0;
  let lastEra = null;
  let lastLayout = null;

  // Every color read in draw() goes through this instead of a bare
  // get(id) — see the file header for why.
  function swatch(id) {
    const v = get(id);
    return isRGBA(v) ? v : FALLBACK[id];
  }

  /* ---------------- layout variants ---------------- */

  function layoutOrganic(n, w, h, margin) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      pts.push({
        x: margin + rand() * (w - margin * 2),
        y: margin + rand() * (h - margin * 2),
      });
    }
    return pts;
  }

  function layoutRadial(n, w, h, margin) {
    // Concentric rings of nodes, more nodes per ring as radius grows so
    // density stays roughly even rather than the outer ring looking
    // sparse. Jittered within each ring so it doesn't read as a literal
    // dartboard.
    const pts = [];
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) / 2 - margin;
    const ringCount = Math.max(2, Math.round(Math.sqrt(n)));
    let placed = 0;
    let ring = 0;
    while (placed < n) {
      const ringR = maxR * ((ring + 1) / ringCount);
      const ringN = Math.max(3, Math.round((n * (ring + 1)) / ((ringCount * (ringCount + 1)) / 2)));
      const angleJitter = (Math.PI * 2) / ringN * 0.35;
      for (let i = 0; i < ringN && placed < n; i++) {
        const a = (i / ringN) * Math.PI * 2 + (rand() - 0.5) * angleJitter;
        const r = ringR * (0.85 + rand() * 0.3);
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
        placed++;
      }
      ring++;
      if (ring > ringCount + 4) {
        // safety valve — shouldn't trigger, but never loop forever
        while (placed < n) { pts.push({ x: cx, y: cy }); placed++; }
      }
    }
    return pts;
  }

  function layoutClustered(n, w, h, margin) {
    // A handful of hub centers; each node is placed near one hub with a
    // falloff jitter, so most edges (built afterward by nearest-
    // neighbor) end up short and within-cluster, with the occasional
    // long link bridging two hubs — "a few dense hubs with sparse
    // long-range links," per the brief.
    const pts = [];
    const hubCount = Math.max(2, Math.min(6, Math.round(n / 7)));
    const hubs = [];
    for (let i = 0; i < hubCount; i++) {
      hubs.push({
        x: margin + rand() * (w - margin * 2),
        y: margin + rand() * (h - margin * 2),
      });
    }
    const spread = Math.min(w, h) * 0.14;
    for (let i = 0; i < n; i++) {
      const hub = hubs[Math.floor(rand() * hubs.length)];
      // Gaussian-ish via sum of two uniforms, cheap and dependency-free.
      const jx = ((rand() + rand() - 1) * spread);
      const jy = ((rand() + rand() - 1) * spread);
      pts.push({
        x: Math.min(w - margin, Math.max(margin, hub.x + jx)),
        y: Math.min(h - margin, Math.max(margin, hub.y + jy)),
      });
    }
    return pts;
  }

  function layoutNodes(n, w, h, margin) {
    const mode = get('layoutMode');
    if (mode === 'radial') return layoutRadial(n, w, h, margin);
    if (mode === 'clustered') return layoutClustered(n, w, h, margin);
    return layoutOrganic(n, w, h, margin);
  }

  function build() {
    if (p.width <= 0 || p.height <= 0) return;

    rand = mulberry32(0x5eed + Math.floor(get('nodeCount') * 97) + seedBump * 7919);
    const n = Math.round(get('nodeCount'));
    const w = p.width, h = p.height;
    const margin = Math.min(w, h) * 0.08;

    const positions = layoutNodes(n, w, h, margin);
    nodes = positions.map((pos) => ({
      x: pos.x,
      y: pos.y,
      warm: rand() < 0.35,
      charge: 0,
      isChip: false, // set below, once adjacency is known
      // Size/shape variation — used by Future mode's node rendering so
      // nodes read as varied by default rather than uniform dots. Not
      // applied in 1980/Modern, which both lean on regularity as part
      // of their own look (schematic/PCB precision).
      sizeVar: 0.55 + rand() * 1.15,
      depth: rand(), // parallax cue — see drawNodesFuture
    }));

    edges = [];
    const edgeKey = new Set();
    // 1980 stays sparse (its whole aesthetic is spare/minimal, per the
    // original). Modern/Future both go for a dense, layered weave —
    // "elaborate and modern" per the brief, and it's what actually reads
    // as futuristic circuitry rather than a scattered node graph once
    // there's a background texture competing for attention too.
    const era = get('eraMode');
    const denseEra = era === 'modern' || era === 'future';
    for (let i = 0; i < nodes.length; i++) {
      const dists = nodes
        .map((other, j) => (j === i ? null : { j, d: Math.hypot(other.x - nodes[i].x, other.y - nodes[i].y) }))
        .filter(Boolean)
        .sort((a, b) => a.d - b.d);
      const connectCount = denseEra
        ? 2 + (rand() < 0.5 ? 1 : 0) + (rand() < 0.25 ? 1 : 0) // 2-4
        : 1 + (rand() < 0.4 ? 1 : 0); // 1-2, unchanged from before
      for (let k = 0; k < Math.min(connectCount, dists.length); k++) {
        const j = dists[k].j;
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (edgeKey.has(key)) continue;
        edgeKey.add(key);
        const bend = rand() < 0.5 ? 'h' : 'v';
        edges.push({ a: i, b: j, bend });
      }
    }

    adjacency = nodes.map(() => []);
    edges.forEach((e, idx) => { adjacency[e.a].push(idx); adjacency[e.b].push(idx); });

    // High-degree nodes read as "chips" in Modern/Future — decided here,
    // once, from real graph structure, rather than as a control anyone
    // has to tune. Threshold is higher in the dense eras (denseEra, set
    // above) since average degree roughly doubles there — without
    // raising it, nearly every node would qualify as a chip, which
    // defeats the point of chips being a distinguishing subset.
    const chipThreshold = denseEra ? 4 : 3;
    nodes.forEach((node, i) => { node.isChip = adjacency[i].length >= chipThreshold; });

    // Each edge gets a fixed warm/cool tint from its own endpoints,
    // rather than every trace sharing one flat traceColor — this is what
    // actually produces the two-tone blue+orange board look the
    // reference image has. Deterministic, not random, so it doesn't
    // flicker between colors as charge/pulses move through.
    edges.forEach((e) => { e.warm = nodes[e.a].warm || nodes[e.b].warm; });

    pulses = [];
  }

  /* ---------------- edge geometry ---------------- */

  function bendPoint(edge) {
    const A = nodes[edge.a], B = nodes[edge.b];
    return edge.bend === 'h' ? { x: B.x, y: A.y } : { x: A.x, y: B.y };
  }

  // Real CAD-style PCB routing: a 45deg diagonal run covering however
  // much of the shorter axis's distance exists, then a straight
  // horizontal-or-vertical run covering the rest — the actual
  // convention visible in the reference image (diagonal segments
  // connecting to orthogonal ones at a sharp knee), not a smooth curve
  // and not a simple right-angle elbow. This is a fixed point in space
  // for a given edge regardless of travel direction, same as
  // bendPoint() above.
  function pcbKnee(edge) {
    const A = nodes[edge.a], B = nodes[edge.b];
    const dx = B.x - A.x, dy = B.y - A.y;
    const diagLen = Math.min(Math.abs(dx), Math.abs(dy));
    const sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1;
    return { x: A.x + sx * diagLen, y: A.y + sy * diagLen };
  }

  // Straight two-segment path — 1980 mode only.
  function pointOnEdgeStraight(edge, t, fromA) {
    const A = nodes[edge.a], B = nodes[edge.b];
    const start = fromA ? A : B;
    const end = fromA ? B : A;
    const bend = bendPoint(edge);
    const leg1 = Math.hypot(bend.x - start.x, bend.y - start.y);
    const leg2 = Math.hypot(end.x - bend.x, end.y - bend.y);
    const total = leg1 + leg2 || 1;
    const along = t * total;
    if (along <= leg1) {
      const lt = leg1 > 0 ? along / leg1 : 1;
      return { x: start.x + (bend.x - start.x) * lt, y: start.y + (bend.y - start.y) * lt };
    }
    const lt = leg2 > 0 ? (along - leg1) / leg2 : 1;
    return { x: bend.x + (end.x - bend.x) * lt, y: bend.y + (end.y - bend.y) * lt };
  }

  // PCB-knee two-segment path — Modern mode only. Same piecewise-linear
  // shape as pointOnEdgeStraight above, just walking through pcbKnee()
  // instead of bendPoint() — kept as a separate function rather than
  // parameterizing the other one so each mode's geometry stays easy to
  // reason about independently.
  function pointOnEdgePCB(edge, t, fromA) {
    const A = nodes[edge.a], B = nodes[edge.b];
    const start = fromA ? A : B;
    const end = fromA ? B : A;
    const knee = pcbKnee(edge);
    const leg1 = Math.hypot(knee.x - start.x, knee.y - start.y);
    const leg2 = Math.hypot(end.x - knee.x, end.y - knee.y);
    const total = leg1 + leg2 || 1;
    const along = t * total;
    if (along <= leg1) {
      const lt = leg1 > 0 ? along / leg1 : 1;
      return { x: start.x + (knee.x - start.x) * lt, y: start.y + (knee.y - start.y) * lt };
    }
    const lt = leg2 > 0 ? (along - leg1) / leg2 : 1;
    return { x: knee.x + (end.x - knee.x) * lt, y: knee.y + (end.y - knee.y) * lt };
  }

  function pointOnEdge(edge, t, fromA) {
    const era = get('eraMode');
    if (era === 'modern') return pointOnEdgePCB(edge, t, fromA);
    // 1980 and Future both travel the straight two-segment path now —
    // Future switched from a curved-strand look to the geometric HUD
    // style (straight lines, diamond bend markers), so pulses need to
    // follow the same path the lines are actually drawn along.
    return pointOnEdgeStraight(edge, t, fromA);
  }

  /* ---------------- simulation ---------------- */

  // Hard ceiling on simultaneous pulses. Without this, high branchChance
  // + high maxHops + the denser Modern/Future connectivity can cascade
  // combinatorially — confirmed by simulation: default-ish "aggressive"
  // settings (branchChance 1.0, maxHops 7, ~68 nodes at Modern density)
  // grew from ~40 active pulses to over 14,000 in a single frame within
  // about 5 real seconds, which is exactly what made the tile lock up
  // and get killed by the renderer's heartbeat watchdog. This cap makes
  // that structurally impossible rather than relying on any particular
  // combination of control values staying "reasonable" — new spawns
  // beyond it are silently dropped, which just reads as the wave
  // saturating rather than growing forever, not as anything visibly
  // broken.
  const MAX_PULSES = 500;

  function fireNode(nodeIdx, hopsLeft, excludeEdge) {
    if (hopsLeft <= 0) return;
    const node = nodes[nodeIdx];
    if (!node) return;
    node.charge = 1;
    for (const edgeIdx of adjacency[nodeIdx]) {
      if (pulses.length >= MAX_PULSES) break;
      if (edgeIdx === excludeEdge) continue;
      if (hopsLeft < Math.round(get('maxHops')) && rand() > get('branchChance')) continue;
      const edge = edges[edgeIdx];
      const fromA = edge.a === nodeIdx;
      pulses.push({ edgeIndex: edgeIdx, fromA, t: 0, hopsLeft, warm: node.warm });
    }
    if (typeof p.pluck === 'function') {
      p.pluck(node.x / Math.max(1, p.width));
    }
  }

  function nearestNode(x, y, maxDist) {
    let best = -1, bestD = maxDist;
    for (let i = 0; i < nodes.length; i++) {
      const d = Math.hypot(nodes[i].x - x, nodes[i].y - y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function handlePointer(x, y) {
    // Future mode draws its whole network layer rotated (see draw()) —
    // node.x/node.y are still world/pre-rotation coordinates, so a raw
    // screen click needs to be rotated back by the same angle before
    // hit-testing against them, or clicks would silently miss once the
    // network had rotated any meaningful amount.
    let px = x, py = y;
    if (get('eraMode') === 'future') {
      const cx = p.width / 2, cy = p.height / 2;
      const angle = -(time * 0.035);
      const dx = x - cx, dy = y - cy;
      px = cx + dx * Math.cos(angle) - dy * Math.sin(angle);
      py = cy + dx * Math.sin(angle) + dy * Math.cos(angle);
    }
    const idx = nearestNode(px, py, get('nodeSize') * 2.5);
    if (idx >= 0) fireNode(idx, Math.round(get('maxHops')), -1);
  }

  function updatePulses(dt) {
    const speed = get('pulseSpeed') * 0.6;
    const next = [];
    for (const pulse of pulses) {
      pulse.t += speed * dt;
      if (pulse.t >= 1) {
        const edge = edges[pulse.edgeIndex];
        const arrivedNode = pulse.fromA ? edge.b : edge.a;
        if (pulse.hopsLeft > 1) fireNode(arrivedNode, pulse.hopsLeft - 1, pulse.edgeIndex);
        else if (nodes[arrivedNode]) nodes[arrivedNode].charge = Math.max(nodes[arrivedNode].charge, 1);
        continue;
      }
      next.push(pulse);
    }
    pulses = next;
  }

  function decayCharges(dt) {
    for (const node of nodes) node.charge = Math.max(0, node.charge - dt * 0.9);
  }

  /* ---------------- background ---------------- */

  function drawBackground(era, time, cool, warm) {
    const bg = swatch('bgColor');
    p.background(bg.r, bg.g, bg.b);

    const gridCol = swatch('gridColor');

    if (era === 'modern') {
      drawBackgroundModern(gridCol, time);
    } else if (era === 'future') {
      drawBackgroundFuture(gridCol, cool, warm, time);
    } else {
      const gd = get('gridDensity');
      const stepX = p.width / gd, stepY = p.height / gd;
      p.noStroke();
      p.fill(gridCol.r, gridCol.g, gridCol.b, gridCol.a);
      for (let gy = 0; gy < gd; gy++) {
        for (let gx = 0; gx < gd; gx++) {
          p.circle(gx * stepX + stepX / 2, gy * stepY + stepY / 2, 2.4);
        }
      }
    }
  }

  function drawBackgroundModern(gridCol, time) {
    void time; // no longer used here — no animated wash for Modern (see below)

    // No animated glow wash for Modern. The reference image (IMG_2174)
    // doesn't have one at all — it's a clean, bright, extremely regular
    // dot-matrix field with sharp traces on top, no soft color blobs
    // anywhere.

    // Single dot-matrix layer, driven entirely by the user's own
    // Background grid density/color controls. There used to be a
    // second, fixed-resolution texture layer underneath this one that
    // the sliders couldn't touch — that was the duplicate-grid bug.
    // Removed entirely rather than keeping both; this one layer is
    // tuned brighter/bigger to stay visually dominant on its own.
    const gd = get('gridDensity');
    const stepX = p.width / gd, stepY = p.height / gd;
    p.noStroke();
    p.fill(gridCol.r, gridCol.g, gridCol.b, Math.min(1, gridCol.a * 2.4));
    for (let gy = 0; gy < gd; gy++) {
      for (let gx = 0; gx < gd; gx++) {
        p.circle(gx * stepX + stepX / 2, gy * stepY + stepY / 2, 4.2);
      }
    }
  }

  function drawBackgroundFuture(gridCol, cool, warm, time) {
    void cool; void warm; void time; // no wash — removed per direct instruction, kept params for call-site consistency

    // Grid structure drawn FIRST — the actual bottom layer beneath the
    // reticle and the circuit network itself. It used to draw after the
    // reticle (rendering on top of it, backwards) at a low enough alpha
    // that it barely registered either way — boosted here so it reads
    // as a real structural layer, not a faint afterthought.
    const gd = get('gridDensity');
    const stepX = p.width / gd, stepY = p.height / gd;
    p.noStroke();
    p.fill(gridCol.r, gridCol.g, gridCol.b, Math.min(1, gridCol.a * 1.4));
    for (let gy = 0; gy < gd; gy++) {
      for (let gx = 0; gx < gd; gx++) {
        p.circle(gx * stepX + stepX / 2, gy * stepY + stepY / 2, 2.4);
      }
    }

    // Faint radial HUD reticle, on top of the grid.
    const cx = p.width / 2, cy = p.height / 2;
    const rMax = Math.min(p.width, p.height) * 0.42;
    p.noFill();
    p.stroke(gridCol.r, gridCol.g, gridCol.b, 0.28);
    p.strokeWeight(0.5);
    p.circle(cx, cy, rMax * 2);
    p.circle(cx, cy, rMax * 1.4);
    p.noStroke();
  }

  /* ---------------- traces ---------------- */

  function drawTraces1980() {
    const traceCol = swatch('traceColor');
    p.stroke(traceCol.r, traceCol.g, traceCol.b, traceCol.a);
    p.strokeWeight(1.2);
    p.noFill();
    for (const edge of edges) {
      const A = nodes[edge.a], B = nodes[edge.b];
      const bend = bendPoint(edge);
      p.line(A.x, A.y, bend.x, bend.y);
      p.line(bend.x, bend.y, B.x, B.y);
    }
    p.noStroke();
  }

  function drawTracesModern(cool, warm) {
    const traceCol = swatch('traceColor');
    p.noFill();

    for (const edge of edges) {
      const A = nodes[edge.a], B = nodes[edge.b];
      const knee = pcbKnee(edge);
      const col = edge.warm ? warm : cool;

      // Pass 1: soft narrow under-glow on the trace color itself —
      // depth without going as bright as the highlight core.
      p.drawingContext.shadowBlur = 4;
      p.drawingContext.shadowColor = `rgba(${traceCol.r * 255},${traceCol.g * 255},${traceCol.b * 255},0.3)`;
      p.stroke(traceCol.r, traceCol.g, traceCol.b, traceCol.a * 0.8);
      p.strokeWeight(1.8);
      p.line(A.x, A.y, knee.x, knee.y);
      p.line(knee.x, knee.y, B.x, B.y);
      p.drawingContext.shadowBlur = 0;

      // Pass 2: bright per-edge tinted core — real straight segments,
      // not a curve, matching the reference's actual PCB-routing
      // geometry (a 45deg diagonal run into a straight orthogonal run,
      // not a smooth bend). This is the structural fix: the previous
      // version drew a bezier through this same knee point, which reads
      // as "curved wire," never as "routed circuit board" no matter how
      // it's colored.
      p.stroke(col.r, col.g, col.b, 0.7);
      p.strokeWeight(0.8);
      p.line(A.x, A.y, knee.x, knee.y);
      p.line(knee.x, knee.y, B.x, B.y);
    }
    p.noStroke();
  }

  // Neural strands — one edge, one draw call with shadow blur, not
  // several. The earlier version sampled 8 points per edge and gave
  // each its own shadowBlur-enabled circle; canvas 2D shadow blur is
  // genuinely expensive per call in a real browser (my mock harness
  // only checks logic/NaN correctness, it can't measure that), and
  // ~500-700 of those every frame is what actually caused the crash.
  // This draws each strand as ONE curved stroke with the glow applied
  // once — same O(edges) cost class Modern's traces already use safely.
  // Brightness pulses via a per-edge sine wave modulating the stroke's
  // alpha before that single draw call, so the "light pulsing along
  // each strand" effect doesn't need extra draw calls to exist.
  function drawNeuralStrands(time, cool, warm, glowAmt) {
    void time; void glowAmt; // no per-frame animation on the lines themselves — see comment below
    // Dim, straight, geometric connections between REAL nodes — the
    // actual interconnected graph (edges/adjacency), not free-floating
    // branch stubs. Deliberately understated: light pulses (drawn after
    // this, in drawPulsesFuture) are meant to be the dominant visual
    // event per the brief, so these lines stay thin and low-alpha
    // rather than competing for attention. Small diamond tick markers
    // at each bend point are the HUD-style detail from the approved
    // mockup.
    p.noFill();
    const traceCol = swatch('traceColor');
    p.stroke(traceCol.r, traceCol.g, traceCol.b, 0.3);
    p.strokeWeight(0.8);
    for (const edge of edges) {
      const A = nodes[edge.a], B = nodes[edge.b];
      const bend = bendPoint(edge);
      p.line(A.x, A.y, bend.x, bend.y);
      p.line(bend.x, bend.y, B.x, B.y);
    }
    p.noStroke();

    p.push();
    p.rectMode(p.CENTER);
    for (const edge of edges) {
      const col = edge.warm ? warm : cool;
      const bend = bendPoint(edge);
      p.fill(col.r, col.g, col.b, 0.5);
      p.push();
      p.translate(bend.x, bend.y);
      p.rotate(Math.PI / 4);
      p.rect(0, 0, 5, 5);
      p.pop();
    }
    p.pop();
  }

  /* ---------------- nodes ---------------- */

  function drawNodeChip(node, col, lit, size, glowAmt) {
    // A rounded rect with an inset "die" outline and short perpendicular
    // solder-prong ticks at its edges, lit the same way the node body is
    // — reads as a real component on a board rather than a bare via.
    if (glowAmt > 0 && lit > 0.05) {
      p.drawingContext.shadowBlur = 18 * glowAmt * lit;
      p.drawingContext.shadowColor = `rgba(${col.r * 255},${col.g * 255},${col.b * 255},0.9)`;
    }
    const w = size * 2.0, h = size * 1.4;
    p.rectMode(p.CENTER);
    p.noStroke();
    p.fill(col.r, col.g, col.b, 0.28 + lit * 0.45);
    p.rect(node.x, node.y, w, h, 2);

    // Inset die outline — a smaller rect drawn as a stroke-only inset,
    // the detail that separates "chip" from "slightly bigger square."
    p.drawingContext.shadowBlur = 0;
    p.noFill();
    p.stroke(col.r, col.g, col.b, 0.4 + lit * 0.4);
    p.strokeWeight(1);
    p.rect(node.x, node.y, w * 0.55, h * 0.5, 1);

    const prongCount = Math.max(3, Math.round(w / (size * 0.8)));
    const prongLen = size * 0.55;
    p.stroke(col.r, col.g, col.b, 0.5 + lit * 0.5);
    p.strokeWeight(1.4);
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < prongCount; i++) {
        const px = node.x - w / 2 + (w / (prongCount - 1)) * i;
        const py = node.y + (h / 2) * side;
        p.line(px, py, px, py + prongLen * side);
      }
    }
    p.noStroke();
  }

  function drawNodesStandard(era, cool, warm, glowAmt, chipsEnabled) {
    const size = get('nodeSize');
    for (const node of nodes) {
      const col = node.warm ? warm : cool;
      const lit = node.charge;

      if (chipsEnabled && node.isChip) {
        drawNodeChip(node, col, lit, size, glowAmt);
        continue;
      }

      if (glowAmt > 0 && lit > 0.05) {
        p.drawingContext.shadowBlur = 14 * glowAmt * lit;
        p.drawingContext.shadowColor = `rgba(${col.r * 255},${col.g * 255},${col.b * 255},0.9)`;
      }
      const baseAlpha = 0.35 + lit * 0.65;
      p.fill(col.r, col.g, col.b, baseAlpha);
      p.rectMode(p.CENTER);
      const s = size * (0.85 + lit * 0.3);
      p.rect(node.x, node.y, s, s, 2);
      p.drawingContext.shadowBlur = 0;
    }
  }

  function drawNodesFuture(cool, warm, glowAmt) {
    // HUD-style ring markers, per the approved mockup — dim at rest, a
    // thin ring plus a small core, brightening only when charge passes
    // through. Deliberately understated: light pulses (drawn separately
    // in drawPulsesFuture) are meant to be the dominant visual event,
    // not static colored node fills — this is the node system for that
    // brief. depth (persistent per node, set at build time) drives
    // parallax size/alpha for a sense of spatial placement, combined
    // with the slow global rotation wrapping this whole layer (draw()).
    // Thickness (the same control that scales the light beams — see
    // params, renamed from "Beam width") also scales node size here,
    // normalized against its own default of 14 so nothing changes at
    // the default value — moving the slider is what scales lines and
    // nodes together, in relation, per the ask.
    const thicknessScale = get('beamWidth') / 14;
    const size = get('nodeSize') * 0.4 * thicknessScale;
    for (const node of nodes) {
      const col = node.warm ? warm : cool;
      const lit = node.charge;
      const depthScale = 0.55 + node.depth * 0.9;
      const depthAlpha = 0.45 + node.depth * 0.55;
      const boost = (node.isChip ? 1.25 : 1) * node.sizeVar * depthScale;
      const r = size * (0.7 + lit * 0.5) * boost;

      p.noFill();
      p.stroke(col.r, col.g, col.b, (0.35 + lit * 0.3) * depthAlpha);
      p.strokeWeight(1);
      p.circle(node.x, node.y, r * 2);

      p.noStroke();
      if (glowAmt > 0 && lit > 0.05) {
        p.drawingContext.shadowBlur = 16 * glowAmt * lit * depthScale;
        p.drawingContext.shadowColor = `rgba(${col.r * 255},${col.g * 255},${col.b * 255},0.9)`;
      }
      p.fill(col.r, col.g, col.b, (0.4 + lit * 0.5) * depthAlpha);
      p.circle(node.x, node.y, r * 0.55);
      p.drawingContext.shadowBlur = 0;
    }
  }

  /* ---------------- pulses ---------------- */

  function drawPulsesStandard(cool, warm, glowAmt) {
    for (const pulse of pulses) {
      const pos = pointOnEdge(edges[pulse.edgeIndex], pulse.t, pulse.fromA);
      const col = pulse.warm ? warm : cool;
      if (glowAmt > 0) {
        p.drawingContext.shadowBlur = 10 * glowAmt;
        p.drawingContext.shadowColor = `rgba(${col.r * 255},${col.g * 255},${col.b * 255},0.9)`;
      }
      p.fill(col.r, col.g, col.b, 0.95);
      p.circle(pos.x, pos.y, 4);
      p.drawingContext.shadowBlur = 0;
    }
  }

  function drawPulsesFuture(cool, warm, glowAmt) {
    // A light streak, not a dot — sampled a short distance behind the
    // pulse's current position (using the same path it's actually
    // traveling) to get a direction, then drawn as two stroked
    // segments: a dim, longer trail and a brighter, short head, both
    // rounded (strokeCap defaults to ROUND in p5, so nothing extra
    // needed there). Reads as an LED strip / light particle instead of
    // a circle, and is meaningfully smaller than before per the ask —
    // widths are a fraction of beamWidth, not most of it.
    const beamW = get('beamWidth');
    const headW = Math.max(1.2, beamW * 0.18);
    const trailW = Math.max(0.8, beamW * 0.09);
    for (const pulse of pulses) {
      const edge = edges[pulse.edgeIndex];
      const pos = pointOnEdge(edge, pulse.t, pulse.fromA);
      const headBack = pointOnEdge(edge, Math.max(0, pulse.t - 0.018), pulse.fromA);
      const trailBack = pointOnEdge(edge, Math.max(0, pulse.t - 0.06), pulse.fromA);
      const col = pulse.warm ? warm : cool;

      p.stroke(col.r, col.g, col.b, 0.4);
      p.strokeWeight(trailW);
      p.line(trailBack.x, trailBack.y, pos.x, pos.y);

      if (glowAmt > 0) {
        p.drawingContext.shadowBlur = beamW * 0.9 * glowAmt;
        p.drawingContext.shadowColor = `rgba(${col.r * 255},${col.g * 255},${col.b * 255},0.9)`;
      }
      p.stroke(col.r, col.g, col.b, 1);
      p.strokeWeight(headW);
      p.line(headBack.x, headBack.y, pos.x, pos.y);
      p.drawingContext.shadowBlur = 0;

      p.noStroke();
      p.fill(1, 1, 1, 0.9);
      p.circle(pos.x, pos.y, headW * 0.7);
    }
    p.noStroke();
  }

  /* ---------------- p5 lifecycle ---------------- */

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.noStroke();
    p.cursor(p.HAND);
    lastEra = get('eraMode');
    lastLayout = get('layoutMode');
    build();
    builtFor = `${get('nodeCount')}|${lastEra}|${lastLayout}`;
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    build();
    builtFor = `${get('nodeCount')}|${get('eraMode')}|${get('layoutMode')}`;
  };

  p.mousePressed = () => handlePointer(p.mouseX, p.mouseY);
  p.touchStarted = () => {
    if (p.touches.length) handlePointer(p.touches[0].x, p.touches[0].y);
    return false;
  };

  p.onEvent = (name) => {
    if (name === 'reseed') { seedBump++; build(); }
  };

  p.draw = () => {
    // Nothing to draw yet — bail rather than run layout/physics math
    // against an empty node set. This is what makes a resize firing
    // before the first real frame a no-op instead of a race.
    if (p.width <= 0 || p.height <= 0) return;

    const era = get('eraMode');
    const layout = get('layoutMode');

    // Auto-reseed on era/layout change — but not on the very first
    // frame (lastEra/lastLayout are already seeded correctly in
    // setup()), so this only fires on an actual user-driven change.
    if (era !== lastEra || layout !== lastLayout) {
      seedBump++;
      lastEra = era;
      lastLayout = layout;
    }

    const key = `${get('nodeCount')}|${era}|${layout}`;
    if (key !== builtFor || !nodes.length) { build(); builtFor = key; }
    if (!nodes.length) return;

    const dt = Math.min(p.deltaTime, 100) / 1000;
    time += dt;

    autoFireAcc += dt * get('autoFireRate');
    while (autoFireAcc >= 1) {
      autoFireAcc -= 1;
      fireNode(Math.floor(rand() * nodes.length), Math.round(get('maxHops')), -1);
    }

    updatePulses(dt);
    decayCharges(dt);

    const cool = swatch('coolColor'), warm = swatch('warmColor');
    const glowAmt = get('glow');

    drawBackground(era, time, cool, warm);

    if (era === 'modern') {
      drawTracesModern(cool, warm);
      drawNodesStandard(era, cool, warm, glowAmt, true);
      drawPulsesStandard(cool, warm, glowAmt);
    } else if (era === 'future') {
      // Slow global rotation around canvas center, wrapping only the
      // network layer (edges/pulses/nodes) — the background wash and
      // starfield stay screen-locked as a stable ambient backdrop,
      // same reasoning real depth-of-field compositions use: a fixed
      // far background with rotating/drifting foreground reads as more
      // convincingly "in space" than rotating everything together,
      // which would just look like the whole canvas spinning.
      p.push();
      p.translate(p.width / 2, p.height / 2);
      p.rotate(time * 0.035);
      p.translate(-p.width / 2, -p.height / 2);
      drawNeuralStrands(time, cool, warm, glowAmt);
      drawPulsesFuture(cool, warm, glowAmt);
      drawNodesFuture(cool, warm, glowAmt);
      p.pop();
    } else {
      drawTraces1980();
      drawPulsesStandard(cool, warm, glowAmt);
      drawNodesStandard(era, cool, warm, glowAmt, false);
    }
  };
}
