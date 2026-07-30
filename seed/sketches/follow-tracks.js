/** follow-tracks — agents that follow one another in chains, each leaving a
    persistent track. Trails accumulate into a route map over time. */

export const params = {
  chains: { kind: 'stepper', label: 'Chains', min: 1, max: 24, step: 1, default: 6 },
  length: { kind: 'stepper', label: 'Chain length', min: 2, max: 60, step: 1, default: 18 },
  speed: { kind: 'slider', label: 'Lead speed', min: 0.1, max: 6, step: 0.05, default: 1.6, modulatable: true },
  ease: { kind: 'slider', label: 'Follow easing', min: 0.02, max: 0.6, step: 0.005, default: 0.16, hint: 'Lower values make the tail lag further behind.' },
  wander: { kind: 'slider', label: 'Wander', min: 0, max: 2, step: 0.01, default: 0.7, modulatable: true },
  spacing: { kind: 'slider', label: 'Link spacing', min: 0, max: 40, step: 0.5, default: 9 },
  trail: { kind: 'slider', label: 'Track fade', min: 0, max: 0.3, step: 0.002, default: 0.018, hint: 'Zero leaves permanent tracks.' },
  drawLinks: { kind: 'toggle', label: 'Draw links', default: true },
  drawNodes: { kind: 'toggle', label: 'Draw nodes', default: true },
  nodeSize: { kind: 'slider', label: 'Node size', min: 0.5, max: 10, step: 0.1, default: 2.4, showIf: { truthy: 'drawNodes' } },
  weight: { kind: 'slider', label: 'Link weight', min: 0.2, max: 5, step: 0.05, default: 0.9 },
  head: { kind: 'color', label: 'Head', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  tail: { kind: 'color', label: 'Tail', default: { r: 0.25, g: 0.08, b: 0.5, a: 1 } },
  reseed: { kind: 'trigger', label: 'Reseed', default: null, event: 'reseed' },
};

export default function sketch(p, get) {
  let chains = [];

  function spawn() {
    const n = Math.floor(get('chains'));
    const len = Math.floor(get('length'));
    chains = [];
    for (let c = 0; c < n; c++) {
      const nodes = [];
      const sx = p.random(p.width);
      const sy = p.random(p.height);
      for (let i = 0; i < len; i++) nodes.push({ x: sx, y: sy });
      chains.push({ nodes, seed: p.random(1000), angle: p.random(p.TWO_PI) });
    }
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.background(0);
    spawn();
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    p.background(0);
    spawn();
  };

  p.onEvent = (name) => { if (name === 'reseed') { p.background(0); spawn(); } };

  p.draw = () => {
    const fade = get('trail');
    if (fade > 0) {
      p.noStroke();
      p.fill(0, 0, 0, fade);
      p.rect(0, 0, p.width, p.height);
    }

    if (chains.length !== Math.floor(get('chains')) ||
        chains[0].nodes.length !== Math.floor(get('length'))) spawn();

    const t = p.millis() * 0.001;
    const speed = get('speed');
    const ease = get('ease');
    const spacing = get('spacing');
    const head = get('head');
    const tail = get('tail');

    p.strokeWeight(get('weight'));

    for (const chain of chains) {
      // Lead wanders by noise; every follower eases toward the node ahead,
      // which is what produces the whip-like tracks.
      chain.angle += (p.noise(chain.seed, t * 0.3) - 0.5) * get('wander') * 0.4;
      const lead = chain.nodes[0];
      lead.x += Math.cos(chain.angle) * speed;
      lead.y += Math.sin(chain.angle) * speed;

      if (lead.x < 0) lead.x += p.width;
      if (lead.x > p.width) lead.x -= p.width;
      if (lead.y < 0) lead.y += p.height;
      if (lead.y > p.height) lead.y -= p.height;

      for (let i = 1; i < chain.nodes.length; i++) {
        const prev = chain.nodes[i - 1];
        const node = chain.nodes[i];
        const dx = prev.x - node.x;
        const dy = prev.y - node.y;
        const d = Math.hypot(dx, dy) || 1;
        // Skip the wrap frame so links don't streak across the canvas.
        if (d > p.width * 0.5) { node.x = prev.x; node.y = prev.y; continue; }
        const target = Math.max(d - spacing, 0);
        node.x += (dx / d) * target * ease * 4;
        node.y += (dy / d) * target * ease * 4;
      }

      for (let i = 0; i < chain.nodes.length; i++) {
        const f = i / Math.max(chain.nodes.length - 1, 1);
        const col = {
          r: p.lerp(head.r, tail.r, f), g: p.lerp(head.g, tail.g, f),
          b: p.lerp(head.b, tail.b, f), a: p.lerp(head.a, tail.a, f) * (1 - f * 0.5),
        };
        const node = chain.nodes[i];

        if (get('drawLinks') && i > 0) {
          const prev = chain.nodes[i - 1];
          if (Math.hypot(prev.x - node.x, prev.y - node.y) < p.width * 0.5) {
            p.stroke(col.r, col.g, col.b, col.a);
            p.line(prev.x, prev.y, node.x, node.y);
          }
        }
        if (get('drawNodes')) {
          p.noStroke();
          p.fill(col.r, col.g, col.b, col.a);
          p.circle(node.x, node.y, get('nodeSize') * (1 - f * 0.6));
        }
      }
    }
  };
}
