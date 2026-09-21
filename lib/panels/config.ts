/**
 * Phase 4.98 kill switch. Set NEXT_PUBLIC_FLOATING_PANELS=off and redeploy
 * to disable floating panels entirely: the float controls disappear and
 * every sidecar panel renders in the stack exactly as before. The
 * accordion is independent of this switch.
 *
 * NEXT_PUBLIC_* values are inlined at build time, so this is a redeploy
 * switch, not a runtime one.
 */
export const FLOATING_PANELS_ENABLED = process.env.NEXT_PUBLIC_FLOATING_PANELS !== 'off';
