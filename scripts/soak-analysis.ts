// scripts/soak-analysis.ts
//
// The soak test's verdict logic, kept free of any browser so it can be tested
// (scripts/verify-soak.ts). scripts/soak.ts collects the numbers; this decides
// whether they describe a leak.
//
// THE MODEL. Focusing a tile promotes a live renderer; closing it demotes it.
// After a full pass over the board — every tile focused and closed — the page
// should look the way it did before the pass: no extra live renderers, GL
// textures, sandbox iframes or canvases. Three things are DELIBERATELY not
// held to "back to baseline":
//   * compiled GL programs — a cache. It grows during the FIRST pass to (at
//     most) the number of distinct shaders and must then stay flat.
//   * heap — the GC runs when it likes. It is judged on its TREND over the
//     later cycles, not on any one reading.
//   * DOM size — allowed a small margin over the first cycle (lazy images,
//     virtualised rows), but not a steady climb.

export interface Sample {
  cycle: number;
  live: number;
  focused: number;
  glTextures: number;
  glPrograms: number;
  iframes: number;
  canvases: number;
  domNodes: number;
  heapMB: number | null;
}

export interface Thresholds {
  /** Extra live renderers tolerated over baseline at the end of a cycle. */
  liveOver: number;
  texturesOver: number;
  iframesOver: number;
  canvasesOver: number;
  /** Least-squares heap slope over the cycles after the first, in MB per cycle. */
  heapSlopeMBPerCycle: number;
  /** Heap growth allowed between the first and last cycle, in MB. */
  heapGrowthMB: number;
  /** DOM growth allowed over the first cycle, in percent (plus a small fixed allowance). */
  domGrowthPct: number;
}

/** Runaway guard for the program cache's first pass: programs per shader tile, and the stage's own. */
export const PROGRAMS_PER_SHADER_CEILING = 4;
export const STAGE_PROGRAMS_ALLOWANCE = 8;

export const DEFAULT_THRESHOLDS: Thresholds = {
  liveOver: 0,
  texturesOver: 0,
  iframesOver: 0,
  canvasesOver: 0,
  heapSlopeMBPerCycle: 4,
  heapGrowthMB: 30,
  domGrowthPct: 5,
};

export interface RunFacts {
  baseline: Sample;
  /** One sample per completed cycle, taken after every tile has been closed. */
  cycles: Sample[];
  peaks: { live: number; glTextures: number; iframes: number };
  /** MAX_LIVE_RENDERERS, as reported by the page. */
  cap: number;
  /** How many distinct shader tiles were exercised (bounds the program cache). */
  shaderTiles: number;
  focusFailures: string[];
  pageErrors: string[];
}

export interface Check {
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail: string;
}

export interface Verdict {
  passed: boolean;
  checks: Check[];
}

/** Ordinary least-squares slope of y against x; 0 for fewer than two points or no x spread. */
export function slope(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function analyse(facts: RunFacts, overrides: Partial<Thresholds> = {}): Verdict {
  const t: Thresholds = { ...DEFAULT_THRESHOLDS, ...overrides };
  const { baseline, cycles } = facts;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, skipped = false) => checks.push({ name, ok: skipped ? true : ok, skipped, detail });

  add('every tile focused and went live', facts.focusFailures.length === 0, facts.focusFailures.length === 0 ? 'no failures' : `${facts.focusFailures.length} failed: ${facts.focusFailures.slice(0, 3).join('; ')}${facts.focusFailures.length > 3 ? '; …' : ''}`);

  if (cycles.length === 0) {
    add('at least one full cycle completed', false, 'no cycle finished');
    return { passed: false, checks };
  }

  const worst = (pick: (s: Sample) => number, base: number) => Math.max(...cycles.map((c) => pick(c) - base));
  const over = (name: string, pick: (s: Sample) => number, base: number, allow: number, unit: string) => {
    const w = worst(pick, base);
    add(name, w <= allow, `${unit}: baseline ${fmt(base)}, worst end-of-cycle excess ${fmt(w)} (allowed ${fmt(allow)})`);
  };
  over('live renderers return to baseline after every cycle', (s) => s.live, baseline.live, t.liveOver, 'live');
  over('GL textures return to baseline after every cycle', (s) => s.glTextures, baseline.glTextures, t.texturesOver, 'textures');
  over('sandbox iframes return to baseline after every cycle', (s) => s.iframes, baseline.iframes, t.iframesOver, 'iframes');
  over('canvases return to baseline after every cycle', (s) => s.canvases, baseline.canvases, t.canvasesOver, 'canvases');

  add('live renderers never exceeded the cap', facts.peaks.live <= facts.cap, `peak ${facts.peaks.live} vs cap ${facts.cap}`);

  if (cycles.length >= 2) {
    const first = cycles[0].glPrograms - baseline.glPrograms;
    const last = cycles[cycles.length - 1].glPrograms;
    // The defining property is FLATNESS after the first pass. The first-pass
    // ceiling is only a runaway guard: a shader compiles a few programs (main,
    // feedback / effect passes) and the stage has some of its own, so the
    // bound is deliberately generous rather than a tight per-tile count.
    const ceiling = facts.shaderTiles * PROGRAMS_PER_SHADER_CEILING + STAGE_PROGRAMS_ALLOWANCE;
    add(
      'compiled-program cache stops growing after the first cycle',
      last <= cycles[0].glPrograms && first <= ceiling,
      `programs: baseline ${baseline.glPrograms}, after cycle 1 ${cycles[0].glPrograms}, after cycle ${cycles.length} ${last} (flat after cycle 1 is required; the first pass may add up to ${ceiling})`,
    );
  } else {
    add('compiled-program cache stops growing after the first cycle', true, 'needs at least 2 cycles', true);
  }

  const heaps = cycles.map((c) => c.heapMB);
  if (cycles.length < 2 || heaps.some((h) => h === null)) {
    add('heap does not trend upward', true, cycles.length < 2 ? 'needs at least 2 cycles' : 'this browser does not report heap size', true);
  } else {
    const hs = heaps as number[];
    const growth = hs[hs.length - 1] - hs[0];
    if (hs.length >= 3) {
      const later = hs.slice(1);
      const s = slope(later.map((_, i) => i), later);
      add('heap does not trend upward', s <= t.heapSlopeMBPerCycle && growth <= t.heapGrowthMB, `heap ${hs.map(fmt).join(' → ')} MB; slope after warm-up ${fmt(s)} MB/cycle (allowed ${fmt(t.heapSlopeMBPerCycle)}), total growth ${fmt(growth)} MB (allowed ${fmt(t.heapGrowthMB)})`);
    } else {
      add('heap does not trend upward', growth <= t.heapGrowthMB, `heap ${hs.map(fmt).join(' → ')} MB; growth ${fmt(growth)} MB (allowed ${fmt(t.heapGrowthMB)}); 3+ cycles give a slope`);
    }
  }

  const domFirst = cycles[0].domNodes;
  const domLast = cycles[cycles.length - 1].domNodes;
  const domAllowed = Math.ceil(domFirst * (1 + t.domGrowthPct / 100)) + 20;
  add('DOM does not keep growing', domLast <= domAllowed, `nodes ${cycles.map((c) => c.domNodes).join(' → ')} (allowed up to ${domAllowed})`);

  add('no uncaught page errors', facts.pageErrors.length === 0, facts.pageErrors.length === 0 ? 'none' : `${facts.pageErrors.length}: ${facts.pageErrors.slice(0, 2).join(' | ')}`);

  return { passed: checks.every((c) => c.ok), checks };
}

/** A fixed-width table of the baseline and each cycle, for the console. */
export function formatTable(baseline: Sample, cycles: Sample[]): string {
  const cols: Array<[string, (s: Sample) => string]> = [
    ['live', (s) => String(s.live)],
    ['textures', (s) => String(s.glTextures)],
    ['programs', (s) => String(s.glPrograms)],
    ['iframes', (s) => String(s.iframes)],
    ['canvases', (s) => String(s.canvases)],
    ['DOM', (s) => String(s.domNodes)],
    ['heap MB', (s) => (s.heapMB === null ? 'n/a' : fmt(s.heapMB))],
  ];
  const rows: Array<[string, Sample]> = [['baseline', baseline], ...cycles.map((c): [string, Sample] => [`cycle ${c.cycle}`, c])];
  const widths = cols.map(([h, f]) => Math.max(h.length, ...rows.map(([, s]) => f(s).length)));
  const head = ['        ', ...cols.map(([h], i) => h.padStart(widths[i]))].join('  ');
  const body = rows.map(([label, s]) => [label.padEnd(8), ...cols.map(([, f], i) => f(s).padStart(widths[i]))].join('  '));
  return [head, ...body].join('\n');
}

export interface FrameSummary {
  frames: number;
  medianMs: number;
  p95Ms: number;
  /** Frames per second implied by the median frame time. */
  fps: number;
}

/**
 * Summarises the gaps between animation frames while a tile is open. The first
 * gap (measured from an arbitrary moment before the first frame) is dropped.
 * Informational only — how fast a tile draws depends on the machine — but it is
 * the baseline any adaptive-resolution work is judged against.
 */
export function summarizeFrames(deltasMs: number[]): FrameSummary | null {
  const d = deltasMs.slice(1).filter((x) => Number.isFinite(x) && x > 0);
  if (d.length < 3) return null;
  const sorted = [...d].sort((x, y) => x - y);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const median = at(0.5);
  return { frames: d.length, medianMs: Math.round(median * 10) / 10, p95Ms: Math.round(at(0.95) * 10) / 10, fps: Math.round((1000 / median) * 10) / 10 };
}
