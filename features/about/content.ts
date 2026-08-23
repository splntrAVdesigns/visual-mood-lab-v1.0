export const aboutHero = {
  eyebrow: 'About',
  title: 'Visual Mood Lab',
  body: "A tool for tuning generative motion, not scrolling past it. Here's what it is, what it does, and where it's headed.",
};

/**
 * Bottom-right "updated" marker on the About page specifically — see
 * AboutShell.tsx for where this renders and why it's NOT part of
 * FooterCredit in features/navigation/AppChrome.tsx (that element is
 * fixed-position and renders on every route, board included; this one
 * needs to stay About-only). Hand-bumped, not derived from a build
 * timestamp or git log — this page's content changes in discrete,
 * deliberate revisions, not on every deploy, so a date that moves with
 * every build would be noise, not signal. Bump this value whenever the
 * copy above actually changes.
 */
export const updatedCopy = {
  date: '2026-08-22',
};

/**
 * A row in one of the "coded list" quadrants (Capabilities, Roadmap).
 * `status` drives the small tag next to each row — kept to a controlled
 * vocabulary so the list reads as a real manifest, not decoration.
 */
export type ManifestStatus = 'live' | 'building' | 'planned';

export interface ManifestRow {
  key: string;
  detail: string;
  status: ManifestStatus;
}

/**
 * The "how to actually begin" strip rendered directly under the Hero
 * (see StartStrip.tsx) — Concept sells the idea of the board, this tells
 * a first-time visitor what to literally do first. The first entry is a
 * lead-in question, not a literal step — same arrow-chain format as the
 * rest, but framed as "here's the pitch in one line" before the actual
 * instructions start.
 */
export const startCopy = {
  steps: [
    "What's this app about?",
    'Pick a tile',
    'Tune it',
    'Manipulate it live',
    'Add sound (optional)',
    'Save for later or export',
  ],
};

export const conceptCopy = {
  eyebrow: '01 — Concept',
  heading: 'Not a gallery',
  paragraphs: [
    'Visual Mood Lab holds five kinds of visual work \u2014 shaders, sketches, video, SVG, stills \u2014 on one board, and treats every one of them as a living system rather than a finished picture. A generative piece never really finishes: it\u2019s a set of relationships between light, noise, and time, producing new frames for as long as something keeps nudging it. Every asset here exposes its real parameters instead of hiding them behind a render, because the moment you can reach in and turn a knob, a picture stops being an image and starts being a place.',
    'That reach-in feeling turns out to be useful well past the board itself. A tile tuned here isn\u2019t locked to this screen \u2014 it\u2019s a live, parameter-driven visual you can carry into whatever you\u2019re actually building. Because every asset stays source, real GLSL or real p5.js, never baked into a flat export, nothing tuned here is a dead end: take the look, the parameters, or the code itself wherever the project needs them.',
    'Away from a project, it\u2019s just as much at home doing nothing in particular. Route a tile through modulation, let a slow LFO or your own voice breathe through it, and it becomes a quiet, moving thing to sit with instead of one more feed asking for attention. Pick a handful of favorites and switch between them live, and the same board becomes a visual set for a room or a stage \u2014 a projection surface that reacts instead of loops.',
    'Visual Mood Lab is free for early adopters \u2014 the whole board, every control, no paywall, no tier gate. That\u2019s a rare thing to find this early in a tool\u2019s life, and it won\u2019t stay this way forever as the board grows. This is the moment to come play while it\u2019s wide open.',
    'Open a tile, adjust a curve, watch it settle, and let it run. Whether that\u2019s five quiet minutes or the start of something you ship, it\u2019s doing its job.',
  ],
  /** Quick-scan summary of where a tuned tile actually goes, rendered as
      a short bulleted list beneath the prose above (see QuadrantSection)
      rather than folded into another paragraph — the paragraphs already
      make the case in full sentences; this is the skimmable version for
      someone deciding in five seconds whether to keep reading. */
  applications: [
    'Web & app development \u2014 hero backgrounds, loaders, idle states',
    'Motion graphics & social \u2014 tunable, exportable frames',
    'Meditation & focus \u2014 a living screen instead of a feed',
    'Live events & installs \u2014 a visual set you switch between on the fly',
  ],
};

export const capabilitiesCopy = {
  eyebrow: '02 — Capabilities',
  heading: 'What\u2019s live',
  rows: [
    { key: 'board', detail: 'five asset types, one surface', status: 'live' },
    { key: 'inspector', detail: '10 control kinds, schema-driven', status: 'live' },
    { key: 'code assets', detail: 'shaders & sketches saved as real, editable text \u2014 not baked into an image', status: 'live' },
    { key: 'sound engine', detail: 'a tunable synth per tile \u2014 arp, pad, pluck & more', status: 'live' },
    { key: 'audio input', detail: 'upload a track or use your mic, up to 80MB \u2014 drives modulation live', status: 'live' },
    { key: 'modulation', detail: 'LFO bank, time, pointer, track & mic \u2014 routed per control', status: 'live' },
    { key: 'snapshots', detail: 'save a param state as a new board item', status: 'live' },
    { key: 'library', detail: '90+ shaders & sketches, seeded, to explore', status: 'live' },
    { key: 'mobile', detail: 'the full board, inspector, and sound \u2014 tuned for touch', status: 'live' },
    { key: 'auth', detail: 'accounts, saved boards', status: 'live' },
    { key: 'deep-links', detail: '/asset/[id] \u2014 share one tuned look', status: 'live' },
  ] satisfies ManifestRow[],
};

export const roadmapCopy = {
  eyebrow: '03 — Roadmap',
  heading: 'What\u2019s next',
  rows: [
    { key: 'media-library', detail: 'your snapshots, built-in & custom vectors, and import controls, in one place', status: 'building' },
    { key: 'playground', detail: 'write + save shaders and sketches in-browser', status: 'building' },
    { key: 'export', detail: 'PNG / WebM capture, frame-exact', status: 'building' },
    { key: 'canvas-mode', detail: 'free-position board, not just grid', status: 'planned' },
    { key: 'blend-layers', detail: 'stack two assets through a GLSL blend pass', status: 'planned' },
    { key: 'web-synth', detail: 'a running, working synthesizer you can control with your visuals', status: 'planned' },
    { key: 'midi-in', detail: 'map hardware controllers to any control', status: 'planned' },
    { key: 'timeline', detail: 'sequence board items into a playable set', status: 'planned' },
  ] satisfies ManifestRow[],
};

export const brandCopy = {
  eyebrow: '04 — SPLNTR Micro Tools',
  heading: 'Small tools, built one at a time',
  paragraphs: [
    'Visual Mood Lab is the first release under SPLNTR Micro Tools \u2014 small, single-purpose creative tools built and maintained by one person, not a studio or a roadmap-by-committee. Most creative software tries to do everything and ends up doing very little well; SPLNTR tools do one thing, do it precisely, and get out of the way.',
    'Each one is built to fast-track real work rather than sit as a novelty \u2014 something a developer, designer, or performer can drop into an actual project and get real output from immediately, whether that\u2019s a shader-driven background for a site, a tuned visual set for a stage, or an asset pulled straight into a motion piece. Custom integrations and carefully-tuned algorithms are the whole craft here, not an afterthought.',
    'Every tool ships when it\u2019s actually ready, not on a schedule \u2014 built independently, tested obsessively, released the moment it earns a place in someone else\u2019s workflow. More tools are in development.',
  ],
  /** Same treatment as conceptCopy.applications — a short, skimmable
      list under the prose, using the same plain square bullet so the
      device reads as a consistent part of the page's language rather
      than a one-off used in a single quadrant. */
  pillars: [
    'One person, one focus per tool \u2014 no bloat, no roadmap-by-committee',
    'Built for real output \u2014 sites, stages, motion, and brand work',
    'Shipped when it\u2019s right, not when it\u2019s scheduled',
  ],
  linkLabel: 'splntr-microtools.com',
  linkHref: 'https://splntr-microtools.com',
  instagramLabel: '@splntr_microtools',
  instagramHref: 'https://www.instagram.com/splntr_microtools?igsi=djl3Mjd3ZWZqaHJz&utm_source=qr',
  /** Deliberately a placeholder inbox, not a custom brand address yet —
      swap this the moment a more official/branded email exists. Kept as
      one named field rather than inlined in JSX so that swap is a
      one-line change here, not a hunt through QuadrantSection.tsx. */
  feedbackEmail: 'splntraudio@gmail.com',
};
