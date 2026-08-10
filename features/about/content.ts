export const aboutHero = {
  eyebrow: 'About',
  title: 'Visual Mood Lab',
  body: "A tool for tuning generative motion, not scrolling past it. Here's what it is, what it does, and where it's headed.",
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

export const conceptCopy = {
  eyebrow: '01 — Concept',
  heading: 'Not a gallery',
  paragraphs: [
    'Visual Mood Lab holds five kinds of visual work — shaders, sketches, video, SVG, stills — on one board, and treats every one of them as a living system instead of a finished picture. A generative piece is never really done: it\u2019s a set of relationships between light, noise, and time that keeps producing new frames as long as something is willing to nudge it. That\u2019s the idea the whole app is built around. Every asset here exposes its parameters instead of hiding them, because the moment you can reach in and turn a knob is the moment a picture becomes a place.',
    'We built this because we wanted somewhere to put that feeling \u2014 the one you get watching a flow field find its shape, or a shader breathe under a low, slow LFO \u2014 and hand it to other people, not as a screenshot, but as something they can actually touch. It\u2019s less a gallery, more an instrument.',
    'Open a board, adjust a curve, watch it settle, and let it run. If it gives you five quiet minutes away from a feed that never stops moving, it\u2019s doing its job.',
  ],
};

export const capabilitiesCopy = {
  eyebrow: '02 — Capabilities',
  heading: 'What\u2019s live',
  rows: [
    { key: 'board', detail: 'five asset types, one surface', status: 'live' },
    { key: 'inspector', detail: '10 control kinds, schema-driven', status: 'live' },
    { key: 'snapshots', detail: 'save a param state as a new board item', status: 'live' },
    { key: 'modulation', detail: 'LFO bank + live audio input, routed per control', status: 'live' },
    { key: 'library', detail: '21 shaders \u00b7 29 sketches, seeded', status: 'live' },
    { key: 'auth', detail: 'accounts, saved boards', status: 'live' },
    { key: 'deep-links', detail: '/asset/[id] \u2014 share one tuned look', status: 'live' },
  ] satisfies ManifestRow[],
};

export const roadmapCopy = {
  eyebrow: '03 — Roadmap',
  heading: 'What\u2019s next',
  rows: [
    { key: 'playground', detail: 'write + save shaders and sketches in-browser', status: 'building' },
    { key: 'export', detail: 'PNG / WebM capture, frame-exact', status: 'planned' },
    { key: 'canvas-mode', detail: 'free-position board, not just grid', status: 'planned' },
    { key: 'blend-layers', detail: 'stack two assets through a GLSL blend pass', status: 'planned' },
    { key: 'midi-in', detail: 'map hardware controllers to any control', status: 'planned' },
    { key: 'timeline', detail: 'sequence board items into a playable set', status: 'planned' },
  ] satisfies ManifestRow[],
};

export const brandCopy = {
  eyebrow: '04 — SPLNTR Micro Tools',
  heading: 'Small tools, built one at a time',
  paragraphs: [
    'Visual Mood Lab is the first release under SPLNTR Micro Tools \u2014 small, single-purpose creative tools, built and maintained by one person. More tools are in development.',
  ],
  linkLabel: 'splntr-microtools.com',
  linkHref: 'https://splntr-microtools.com',
};
