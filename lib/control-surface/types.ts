/**
 * Visual Mood Lab — Phase 4.97A control-surface contracts.
 *
 * Device transports (MIDI, Gamepad, future HID) end here. Everything above
 * this layer deals in normalized semantic signals, virtual controls and
 * stable VML targets rather than browser-specific event shapes.
 */

export const CONTROL_SURFACE_SCHEMA_VERSION = 1 as const;
export const CONTROLS_PER_BANK = 8 as const;

export type ControllerTransport = 'midi' | 'gamepad';
export type ControllerPath = 'direct' | 'modulation' | 'action';
export type ControllerWriteMode = 'live' | 'write';
export type TakeoverMode = 'pickup' | 'jump' | 'scaled';
export type ResponseCurve = 'linear' | 'log' | 'exp';
export type ActionMode = 'trigger' | 'toggle' | 'momentary';

/**
 * Preserve interaction semantics instead of prematurely flattening every
 * device into an anonymous number. Adapters clamp/validate raw input before
 * it enters the binding engine; the engine sanitizes again as a trust boundary.
 */
export type ControlSignal =
  | { kind: 'absolute'; value: number }
  | { kind: 'bipolar'; value: number }
  | { kind: 'relative'; delta: number }
  | { kind: 'gate'; pressed: boolean; velocity?: number }
  | { kind: 'trigger'; velocity?: number };

export type MidiRelativeMode =
  | 'absolute'
  | 'twos-complement'
  | 'binary-offset'
  | 'signed-bit';

export type PhysicalControlMatcher =
  | {
      transport: 'midi';
      message: 'cc';
      /** MIDI channels are represented as 1..16 at this layer. */
      channel?: number;
      cc: number;
      relativeMode?: MidiRelativeMode;
    }
  | {
      transport: 'midi';
      message: 'note';
      channel?: number;
      note: number;
    }
  | {
      transport: 'midi';
      message: 'pitchbend';
      channel?: number;
    }
  | {
      transport: 'gamepad';
      input: 'axis';
      index: number;
    }
  | {
      transport: 'gamepad';
      input: 'button';
      index: number;
    };

export interface DeviceFingerprint {
  transport: ControllerTransport;
  manufacturer?: string;
  name?: string;
  /** Best-effort browser/OS identity only; never treated as globally stable. */
  portId?: string;
  /** Gamepad mapping string when exposed by the browser. */
  mapping?: string;
}

export interface GamepadCalibration {
  center?: number;
  min?: number;
  max?: number;
  deadzone?: number;
  invert?: boolean;
  curve?: ResponseCurve;
}

export interface VirtualControl {
  id: string;
  label: string;
  matcher: PhysicalControlMatcher;
  calibration?: GamepadCalibration;
}

export interface ControlBank {
  id: string;
  label: string;
  /** UI contract: at most eight visible controls per bank. */
  controls: VirtualControl[];
}

export interface DeviceProfile {
  id: string;
  alias: string;
  transport: ControllerTransport;
  fingerprint: DeviceFingerprint;
  banks: ControlBank[];
  defaultRelativeMode?: MidiRelativeMode;
}

export type TargetScope = 'focused' | 'pinned' | 'global';

export interface ParameterTargetRef {
  scope: TargetScope;
  cardId?: string;
  domain: 'parameter';
  controlId: string;
}

export interface EffectTargetRef {
  scope: TargetScope;
  cardId?: string;
  domain: 'effect';
  effectInstanceId: string;
  controlId: string;
}

export interface ActionTargetRef {
  scope: TargetScope;
  cardId?: string;
  domain: 'action';
  actionId: string;
  /** Optional tile control used by actions such as tile.trigger/tile.toggle. */
  controlId?: string;
}

export type TargetRef = ParameterTargetRef | EffectTargetRef | ActionTargetRef;

export interface ControllerBinding {
  id: string;
  virtualControlId: string;
  path: ControllerPath;
  target: TargetRef;
  enabled?: boolean;

  /** Direct path policy. Pickup is the product default; Phase 4.97C wires UX. */
  takeover?: TakeoverMode;
  /** Runtime-only or commit-after-gesture contract. Phase 4.97C adds settling UX. */
  writeMode?: ControllerWriteMode;

  /** Shared continuous transforms. */
  smoothing?: number;
  invert?: boolean;
  curve?: ResponseCurve;

  /** Modulation path depth, intentionally separate per target for fan-out. */
  amount?: number;

  /** Action path behavior. */
  actionMode?: ActionMode;
}

export interface ControllerMapping {
  id: string;
  profileId: string;
  activeBankId: string;
  writeMode: ControllerWriteMode;
  bindings: ControllerBinding[];
}

export interface ControlSurfaceDocument {
  schemaVersion: typeof CONTROL_SURFACE_SCHEMA_VERSION;
  profiles: DeviceProfile[];
  mappings: ControllerMapping[];
}

export interface ControllerDispatchOutcome {
  status: 'applied' | 'ignored' | 'unavailable' | 'error';
  detail?: string;
}

/**
 * The binding engine targets this narrow runtime contract. The live adapter
 * writes to the renderer pool without database churn; the verify/mock adapter
 * can implement the same contract with no browser or renderer dependency.
 */
export interface ControlSurfaceRuntimeAdapter {
  applyDirect(
    binding: ControllerBinding,
    value01: number,
    signal: ControlSignal,
  ): ControllerDispatchOutcome;
  applyModulation(
    binding: ControllerBinding,
    value01: number,
    signal: ControlSignal,
  ): ControllerDispatchOutcome;
  dispatchAction(binding: ControllerBinding, signal: ControlSignal): ControllerDispatchOutcome;
  clearBinding(bindingId: string): void;
  panic(): void;
}
