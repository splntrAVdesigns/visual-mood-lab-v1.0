import type {
  ControlSignal,
  DeviceFingerprint,
  DeviceProfile,
  GamepadCalibration,
  PhysicalControlMatcher,
} from './types';

export type GamepadRuntimeStatus = 'idle' | 'active' | 'unsupported' | 'error';

export interface GamepadButtonLike {
  pressed: boolean;
  touched?: boolean;
  value: number;
}

export interface GamepadLike {
  id: string;
  index: number;
  connected: boolean;
  timestamp: number;
  mapping: string;
  axes: readonly number[];
  buttons: readonly GamepadButtonLike[];
}

export type GamepadGetter = () => ArrayLike<GamepadLike | null>;

export interface GamepadProfileMatch {
  status: 'matched' | 'unmatched' | 'ambiguous';
  profileId?: string;
  basis?: 'session-index' | 'id-mapping' | 'id';
  ambiguousProfileIds?: string[];
  ambiguousInputIds?: string[];
}

export interface GamepadDeviceActivity {
  polls: number;
  routedSignals: number;
  ignoredSignals: number;
  errors: number;
  lastSignalAt: number | null;
  lastSignalLabel: string | null;
  lastSignal: ControlSignal | null;
}

export interface GamepadDeviceDiagnostic {
  inputId: string;
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
  fingerprint: DeviceFingerprint;
  profileMatch: GamepadProfileMatch;
  activity: GamepadDeviceActivity;
}

export interface GamepadRuntimeSnapshot {
  status: GamepadRuntimeStatus;
  supported: boolean;
  active: boolean;
  learning: boolean;
  error: string | null;
  devices: GamepadDeviceDiagnostic[];
}

export interface GamepadLearnOptions {
  gamepadIndex?: number;
  allowAxes?: boolean;
  allowButtons?: boolean;
  axisThreshold?: number;
}

export interface GamepadLearnCandidate {
  inputId: string;
  gamepadIndex: number;
  fingerprint: DeviceFingerprint;
  profileId?: string;
  matcher: Extract<PhysicalControlMatcher, { transport: 'gamepad' }>;
  signal: ControlSignal;
  label: string;
}

export interface GamepadLearnCalibration {
  deadzone?: number;
  invert?: boolean;
  curve?: GamepadCalibration['curve'];
}

export interface GamepadRuntimeConfiguration {
  profiles: DeviceProfile[];
  activeBanksByProfile: Map<string, Set<string>>;
}
