export const TOTAL_STEPS = 8;

export const STEP_EYEBROWS: Record<number, string> = {
  1: 'WELCOME',
  2: 'THE BOARD',
  3: 'THE TOOLBAR',
  4: 'THE INSPECTOR',
  5: 'MODULATION',
  6: 'SOUND & VFX',
  7: 'FEATURES',
  8: "WHAT'S NEXT",
};

/* ------------------------------------------------------------------ *
 * Step 1 — Welcome
 * ------------------------------------------------------------------ */
export const STEP1 = {
  title: 'Not a gallery.',
  body: "Visual Mood Lab holds shaders, sketches, video, and stills on one board — and every asset exposes its real parameters instead of hiding them behind a render. Eight quick steps show you around; skip ahead anytime.",
};

/* ------------------------------------------------------------------ *
 * Step 2 — The board
 * ------------------------------------------------------------------ */
export const STEP2 = {
  title: 'One board, a few shelves.',
  bodyDesktop:
    "Recently viewed keeps your last viewed tiles close. Library uploads and Saved snapshots hold anything you've saved or uploaded. Use the search bar in the header or the filters in the left panel drawer to find anything on the board, by type, or tag. You can also re-access this guide anytime through the left panel drawer.",
  bodyMobile:
    "Recently viewed keeps your last viewed tiles close. Library uploads and Saved snapshots hold anything you've saved or uploaded — tap the menu to search or filter by type and tag.",
};

/* ------------------------------------------------------------------ *
 * Step 3 — The toolbar
 * ------------------------------------------------------------------ */
export const STEP3 = {
  title: 'Every tile opens the same way.',
  bodyDesktop:
    "Code opens the source. VFX, Modulate, and Sound each open a side drawer — tune the look, route parameters, add sound — and every one gets its own step coming up. VCapture and Record export a clip, and Save snapshot locks in this exact look as a new board item.",
  bodyMobile:
    "Code opens the source. VCapture exports a clip, Snapshot saves this exact look as a new board item, and Restore resets it to default. Parameters, VFX, Modulate, and Sounds sit in the tabs just below — each gets its own step ahead.",
};

/* ------------------------------------------------------------------ *
 * Step 4 — The inspector
 * ------------------------------------------------------------------ */
export const STEP4 = {
  title: 'Every control, grouped and live.',
  bodyDesktop:
    "The inspector groups controls by category — Motion, Pattern, Color, whatever the tile declares. Sliders show a live number as you drag, color swatches open a picker, selects switch between preset modes — and every change autosaves to the tile.",
  bodyMobile:
    "Parameters, VFX, Modulate, and Sounds each get their own tab. Color swatches open a picker, sliders show a live number as you drag — and every change autosaves to the tile, so nothing is ever lost.",
};

/* ------------------------------------------------------------------ *
 * Step 5 — Modulation
 * ------------------------------------------------------------------ */
export const STEP5 = {
  title: 'Let a tile breathe on its own.',
  bodyDesktop:
    "Any routable parameter can take a modulation source — an LFO, the clock, or live audio from a mic or track. Set an amount and a rate, and the value moves on its own from then on, right alongside the audio.",
  bodyMobile:
    "Any routable parameter can take a modulation source — an LFO, the clock, or live audio from a mic or track. Set an amount and a rate, and the value moves on its own from then on.",
};

/* ------------------------------------------------------------------ *
 * Step 6 — Sound & VFX
 * ------------------------------------------------------------------ */
export const STEP6 = {
  title: 'Sound and visuals, from the same panel.',
  bodyDesktop:
    "Sound loads an audio source — upload a track or turn on your mic — so Modulation can use it to drive a parameter, right alongside an LFO. VFX stacks up to three post-processing effects on top of the tile, no shader code required.",
  bodyMobile:
    "Sound loads an audio source — upload a track or turn on your mic — so Modulation can use it to drive a parameter. VFX stacks up to three post-processing effects on top of the tile.",
};

/* ------------------------------------------------------------------ *
 * Step 7 — Current features
 * ------------------------------------------------------------------ */

/**
 * `isNew` drives the small "New" pill rendered next to a feature's name
 * (see Step7Features.tsx / Step7FeaturesMobile.tsx + .newTag in
 * onboarding.module.css). Deliberately not a content-version mechanism —
 * it's a plain per-item flag someone clears by hand once a feature has
 * been live long enough to stop calling out. Optional so existing items
 * don't need touching whenever a new one is flagged.
 */
interface FeatureItem {
  name: string;
  descDesktop: string;
  descMobile: string;
  isNew?: boolean;
}

export const STEP7 = {
  tagline: "A quick recap of what's already live.",
  sectionLabel: 'Current features',
  features: [
    {
      name: 'Live rendering',
      descDesktop:
        'GLSL shaders and p5.js sketches run right on the board, no export needed.',
      descMobile: 'GLSL shaders and p5.js sketches run right on the board.',
    },
    {
      name: 'Inspector',
      descDesktop:
        'every control grouped by category, sliders live, colors editable, autosaved.',
      descMobile: 'every control grouped, sliders live, colors editable, autosaved.',
    },
    {
      name: 'Modulation',
      descDesktop: 'route an LFO or live audio from a mic or track to any parameter.',
      descMobile: 'route an LFO or live audio to any parameter.',
    },
    {
      name: 'MIDI',
      descDesktop:
        'map a hardware controller to any parameter or trigger, right on the modulation bus.',
      descMobile: 'map a hardware controller to any parameter or trigger.',
      isNew: true,
    },
    {
      name: 'Sound & VFX',
      descDesktop: 'upload audio or use your mic, then stack up to three effects.',
      descMobile: 'upload audio or use your mic, stack up to three effects.',
    },
    {
      name: 'Snapshots',
      descDesktop: 'lock in a full look, transform included, as a new board item.',
      descMobile: 'lock in a full look, transform included, as a new board item.',
    },
    {
      name: 'Capture & fullscreen',
      descDesktop: "export a clip or go fullscreen, right from the tile's own toolbar.",
      descMobile: "export a clip or go fullscreen from the tile's own toolbar.",
    },
  ] satisfies FeatureItem[],
};

/* ------------------------------------------------------------------ *
 * Step 8 — Closing / what's next
 * ------------------------------------------------------------------ */
export const STEP8 = {
  gridLabel: 'Made with Visual Mood Lab',
  thanks: "Thanks for taking the tour — and for being part of the beta.",
  roadmapLabel: 'Forthcoming features',
  roadmap: [
    {
      name: 'Playground',
      descDesktop: 'write your own shaders and sketches from scratch, right in the browser.',
      descMobile: 'write your own shaders and sketches from scratch.',
    },
    {
      name: 'Blend & Mask',
      descDesktop: 'combine two tiles, masked through a curated shape library.',
      descMobile: 'combine two tiles through a curated shape library.',
    },
    {
      name: 'Media Library',
      descDesktop: 'a curated set of shapes and graphics to import, blend, and mask against.',
      descMobile: 'shapes and graphics to import, blend, and mask against.',
    },
    {
      name: 'Performance Mode',
      descDesktop: 'use any mood tile in a dedicated live-performance view.',
      descMobile: 'use any mood tile in a live-performance view.',
    },
  ],
  contactLead: "Questions, bugs, or a feature you'd love to see? We'd genuinely like to hear it.",
  links: [
    { label: 'splntr-microtools.com', href: 'https://splntr-microtools.com' },
    { label: 'splntraudio@gmail.com', href: 'mailto:splntraudio@gmail.com' },
    { label: '@splntr_microtools', href: 'https://instagram.com/splntr_microtools' },
  ],
};
