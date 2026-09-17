import type { ControlSurfaceBindingEngine, BindingDispatchRecord } from './binding-engine';
import type { ControlSignal, DeviceProfile } from './types';

export const MOCK_PROFILE_ID = 'vml-mock-midi-surface';
export const MOCK_GAMEPAD_PROFILE_ID = 'vml-mock-gamepad-surface';

/** Deterministic two-bank surface used by the 4.97A verifier and later UI QA. */
export function createMockDeviceProfile(): DeviceProfile {
  return {
    id: MOCK_PROFILE_ID,
    alias: 'VML Mock Control Surface',
    transport: 'midi',
    fingerprint: { transport: 'midi', manufacturer: 'Visual Mood Lab', name: 'Mock Surface' },
    banks: [
      {
        id: 'bank-a',
        label: 'Bank A — Continuous',
        controls: Array.from({ length: 8 }, (_, index) => ({
          id: `mock.knob.${index + 1}`,
          label: `K${index + 1}`,
          matcher: { transport: 'midi' as const, message: 'cc' as const, cc: 20 + index, channel: 1 },
        })),
      },
      {
        id: 'bank-b',
        label: 'Bank B — Pads',
        controls: Array.from({ length: 8 }, (_, index) => ({
          id: `mock.pad.${index + 1}`,
          label: `P${index + 1}`,
          matcher: { transport: 'midi' as const, message: 'note' as const, note: 36 + index, channel: 1 },
        })),
      },
    ],
  };
}

export function createMockGamepadProfile(): DeviceProfile {
  return {
    id: MOCK_GAMEPAD_PROFILE_ID,
    alias: 'VML Mock Gamepad',
    transport: 'gamepad',
    fingerprint: { transport: 'gamepad', manufacturer: 'Visual Mood Lab', name: 'Mock Gamepad', mapping: 'standard' },
    banks: [
      {
        id: 'gamepad-axes',
        label: 'Gamepad — Axes',
        controls: Array.from({ length: 8 }, (_, index) => ({
          id: `mock.gamepad.axis.${index}`,
          label: `Axis ${index}`,
          matcher: { transport: 'gamepad' as const, input: 'axis' as const, index },
          calibration: { center: 0, min: -1, max: 1, deadzone: 0.08 },
        })),
      },
      {
        id: 'gamepad-buttons',
        label: 'Gamepad — Buttons',
        controls: Array.from({ length: 8 }, (_, index) => ({
          id: `mock.gamepad.button.${index}`,
          label: `Button ${index}`,
          matcher: { transport: 'gamepad' as const, input: 'button' as const, index },
        })),
      },
    ],
  };
}

export class MockControlSurface {
  private connected = true;

  constructor(readonly engine: ControlSurfaceBindingEngine) {}

  connect(): void {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  emit(virtualControlId: string, signal: ControlSignal): BindingDispatchRecord[] {
    if (!this.connected) return [];
    return this.engine.dispatch(virtualControlId, signal);
  }

  absolute(id: string, value: number): BindingDispatchRecord[] {
    return this.emit(id, { kind: 'absolute', value });
  }

  bipolar(id: string, value: number): BindingDispatchRecord[] {
    return this.emit(id, { kind: 'bipolar', value });
  }

  relative(id: string, delta: number): BindingDispatchRecord[] {
    return this.emit(id, { kind: 'relative', delta });
  }

  gate(id: string, pressed: boolean, velocity?: number): BindingDispatchRecord[] {
    return this.emit(id, { kind: 'gate', pressed, velocity });
  }

  trigger(id: string, velocity?: number): BindingDispatchRecord[] {
    return this.emit(id, { kind: 'trigger', velocity });
  }
}
