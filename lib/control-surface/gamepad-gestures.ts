import type { GamepadGesture, GestureCommand } from './types';

export const HOLD_MS = 220;
export const DOUBLE_TAP_MS = 280;

/** Pure, clock-driven gesture recognizer; never schedules browser timers. */
export class GamepadGestureState {
  private direction = 0;
  private started = 0;
  private last = 0;
  private tapReleased: number | null = null;
  private tapDirection = 0;
  private resetPress = false;

  sample(value: number, gesture: GamepadGesture, now: number): GestureCommand[] {
    const commands: GestureCommand[] = [];
    const axis = gesture.mode === 'relative';
    const magnitude = Math.abs(value);
    // Input has already passed hardware calibration; hysteresis rejects noise.
    const active = axis ? magnitude > (this.direction ? 0.025 : 0.06) : value > (this.direction ? 0.15 : 0.5);
    const direction = active ? (axis ? Math.sign(value) : gesture.mode === 'decrease' ? -1 : 1) : 0;
    if (direction !== this.direction) {
      if (this.direction) {
        const short = now - this.started < HOLD_MS;
        commands.push({ kind: 'end', held: !short && !this.resetPress && gesture.mode !== 'boost' && gesture.mode !== 'reset' });
        this.tapReleased = short && !this.resetPress ? now : null;
        this.tapDirection = this.direction;
      }
      this.direction = direction;
      if (direction) {
        this.started = now;
        this.last = now;
        commands.push({ kind: 'begin' });
        this.resetPress = !axis && gesture.doubleTap !== false && this.tapReleased !== null &&
          now - this.tapReleased <= DOUBLE_TAP_MS && this.tapDirection === direction;
        if (this.resetPress || gesture.mode === 'reset') commands.push({ kind: 'reset' });
        else if (gesture.mode === 'boost') commands.push({ kind: 'boost' });
        else commands.push({ kind: 'step', direction });
        this.tapReleased = null;
      }
      return commands;
    }
    if (!direction || this.resetPress || gesture.mode === 'boost' || gesture.mode === 'reset') return commands;
    const elapsed = now - this.started;
    // Cap elapsed time: a delayed frame must never deliver a catch-up leap.
    const dt = Math.max(0, Math.min(40, now - Math.max(this.last, this.started + HOLD_MS))) / 1000;
    this.last = now;
    if (elapsed > HOLD_MS && dt > 0) {
      const ramp = Math.min(1, (elapsed - HOLD_MS) / 120);
      commands.push({ kind: 'delta', delta: direction * (axis ? magnitude : 1) *
        (gesture.speed ?? 0.25) * ramp * dt });
    }
    return commands;
  }
}

export const STANDARD_BUTTON_LABELS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'];
export function standardPair(index: number): [number, number] | null {
  if (index === 0 || index === 1) return [0, 1];
  if (index === 2 || index === 3) return [2, 3];
  if (index === 12 || index === 13) return [13, 12];
  if (index === 14 || index === 15) return [14, 15];
  return null;
}
export function defaultGamepadGesture(input: 'axis' | 'button', index: number): GamepadGesture {
  if (input === 'axis') return { mode: 'relative', doubleTap: false };
  if (index === 10 || index === 11) return { mode: 'boost', doubleTap: false };
  const pair = standardPair(index);
  return { mode: pair?.[0] === index ? 'decrease' : 'increase', doubleTap: index < 4 };
}
