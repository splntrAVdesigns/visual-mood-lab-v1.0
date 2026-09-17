import type {
  ControlSignal,
  DeviceFingerprint,
  DeviceProfile,
  MidiRelativeMode,
  PhysicalControlMatcher,
} from './types';

/** Browser capability / permission lifecycle. Permission is only requested
 * from an explicit UI gesture; importing this subsystem never opens a prompt. */
export type MidiAccessStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unsupported'
  | 'insecure-context'
  | 'error';

export type MidiPortState = 'connected' | 'disconnected' | 'unknown';
export type MidiPortConnection = 'open' | 'closed' | 'pending' | 'unknown';

/** Minimal structural interfaces instead of depending directly on the
 * browser's Web MIDI DOM typings. They also make the runtime deterministic
 * under the Phase 4.97B fake-device verifier. */
export interface MidiMessageEventLike {
  data: ArrayLike<number> | null;
  timeStamp?: number;
}

export interface MidiPortLike {
  id: string;
  manufacturer?: string | null;
  name?: string | null;
  state?: string;
  connection?: string;
  type?: string;
}

export interface MidiInputLike extends MidiPortLike {
  onmidimessage: ((event: MidiMessageEventLike) => void) | null;
  open?: () => Promise<unknown>;
  close?: () => Promise<unknown>;
}

export interface MidiInputCollectionLike {
  values(): IterableIterator<MidiInputLike>;
}

export interface MidiStateChangeEventLike {
  port?: MidiPortLike | null;
}

export interface MidiAccessLike {
  inputs: MidiInputCollectionLike;
  onstatechange: ((event: MidiStateChangeEventLike) => void) | null;
}

export type MidiAccessRequester = () => Promise<MidiAccessLike>;

export type MidiDecodedMessage =
  | {
      kind: 'cc';
      status: number;
      channel: number;
      controller: number;
      value: number;
    }
  | {
      kind: 'note';
      status: number;
      channel: number;
      note: number;
      velocity: number;
      pressed: boolean;
    }
  | {
      kind: 'pitchbend';
      status: number;
      channel: number;
      value14: number;
      bipolar: number;
    }
  | {
      kind: 'system';
      status: number;
      label: string;
      realtime: boolean;
    }
  | {
      kind: 'unsupported';
      status: number;
      channel?: number;
      label: string;
    };

export interface MidiProfileMatch {
  status: 'matched' | 'unmatched' | 'ambiguous';
  profileId?: string;
  /** Why the winner matched. Name/manufacturer fallback is intentionally
   * visible so reconnects can be diagnosed instead of silently guessed. */
  basis?: 'port-id' | 'name-manufacturer' | 'name' | 'manufacturer';
  ambiguousProfileIds?: string[];
  /** Connected physical inputs competing for the same fallback profile match. */
  ambiguousInputIds?: string[];
}

export interface MidiDeviceActivity {
  messagesReceived: number;
  routedSignals: number;
  unroutedMessages: number;
  ignoredMessages: number;
  errors: number;
  lastMessageAt: number | null;
  lastMessageLabel: string | null;
  lastSignal: ControlSignal | null;
}

export interface MidiDeviceDiagnostic {
  id: string;
  name: string;
  manufacturer: string;
  state: MidiPortState;
  connection: MidiPortConnection;
  fingerprint: DeviceFingerprint;
  profileMatch: MidiProfileMatch;
  activity: MidiDeviceActivity;
}

export interface MidiRuntimeSnapshot {
  accessStatus: MidiAccessStatus;
  supported: boolean;
  secureContext: boolean;
  error: string | null;
  learning: boolean;
  devices: MidiDeviceDiagnostic[];
}

export interface MidiLearnOptions {
  /** Restrict Learn to one physical input when the UI has selected one. */
  inputId?: string;
  /** Restrict Learn to a configured profile. Useful after reconnect/name
   * matching and prevents an adjacent controller from stealing Learn. */
  profileId?: string;
  allowCC?: boolean;
  allowNotes?: boolean;
  allowPitchBend?: boolean;
  /** CC relative behavior cannot be inferred reliably. Use the profile's
   * preference or an explicit UI selection; absolute remains the fallback. */
  relativeMode?: MidiRelativeMode;
}

export interface MidiLearnCandidate {
  inputId: string;
  fingerprint: DeviceFingerprint;
  profileId?: string;
  matcher: Extract<PhysicalControlMatcher, { transport: 'midi' }>;
  signal: ControlSignal;
  message: MidiDecodedMessage;
  label: string;
}

export interface MidiRuntimeConfiguration {
  profiles: DeviceProfile[];
  /** active bank per profile. Multiple persisted mappings may exist; the
   * runtime treats every referenced active bank as eligible and dedupes
   * virtual-control dispatch by id. */
  activeBanksByProfile: Map<string, Set<string>>;
}
