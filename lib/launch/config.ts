/**
 * Launch gate for the focused-tile Code view (the </> Code button and the
 * CodePanel it opens). Off during beta testing and soft launch: the button
 * stays in the header, greyed out and inert, so the layout does not shift
 * when it comes back.
 *
 * To open it at full launch, set NEXT_PUBLIC_CODE_VIEW=on and redeploy.
 * NEXT_PUBLIC_* values are inlined at build time, so this is a redeploy
 * switch, not a runtime one (same model as lib/panels/config.ts).
 */
export const CODE_VIEW_ENABLED = process.env.NEXT_PUBLIC_CODE_VIEW === 'on';

/** Hover text on the gated button. */
export const CODE_VIEW_GATED_HINT = 'Code view unlocks at full launch';
