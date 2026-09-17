import { FrameSignalQueue } from './scheduler';
import {
  decodeMidiMessage,
  isMidiLearnCandidate,
  learnMatcherForMessage,
  midiMatcherMatches,
  midiMessageLabel,
  midiMessageToSignal,
} from './midi-parser';
import type {
  ControllerBinding,
  ControllerMapping,
  ControlSignal,
  ControlSurfaceDocument,
  DeviceFingerprint,
  DeviceProfile,
  VirtualControl,
} from './types';
import type {
  MidiAccessLike,
  MidiAccessRequester,
  MidiAccessStatus,
  MidiDecodedMessage,
  MidiDeviceActivity,
  MidiDeviceDiagnostic,
  MidiInputLike,
  MidiLearnCandidate,
  MidiLearnOptions,
  MidiProfileMatch,
  MidiRuntimeSnapshot,
} from './midi-types';

/** Narrow structural dependency: Phase 4.97B can be verified with a fake
 * engine and does not need to import the renderer/Inspector stack. The real
 * ControlSurfaceBindingEngine satisfies this interface directly. */
export interface MidiDispatchEngine {
  setBindings(bindings: ControllerBinding[]): void;
  dispatch(virtualControlId: string, signal: ControlSignal): unknown;
  panic(): void;
}

export interface MidiRuntimeOptions {
  engine: MidiDispatchEngine;
  /** Injection point for deterministic tests. Browser builds use
   * navigator.requestMIDIAccess({ sysex:false, software:false }). */
  requestAccess?: MidiAccessRequester;
  secureContext?: boolean;
  now?: () => number;
}

type RuntimeListener = (snapshot: MidiRuntimeSnapshot) => void;
type LearnHandler = (candidate: MidiLearnCandidate) => void;

interface LearnSession {
  options: MidiLearnOptions;
  handler: LearnHandler;
}

interface BoundInput {
  input: MidiInputLike;
  handler: (event: { data: ArrayLike<number> | null; timeStamp?: number }) => void;
}

const EMPTY_ACTIVITY = (): MidiDeviceActivity => ({
  messagesReceived: 0,
  routedSignals: 0,
  unroutedMessages: 0,
  ignoredMessages: 0,
  errors: 0,
  lastMessageAt: null,
  lastMessageLabel: null,
  lastSignal: null,
});

/**
 * Phase 4.97B — Web MIDI device/runtime manager.
 *
 * Responsibilities are intentionally transport-only: permission/capability,
 * discovery/hot-plug, MIDI parsing, profile reconnect matching, Learn
 * candidate capture, diagnostics, and dispatching normalized signals into
 * the existing transport-independent binding engine. It never touches the
 * renderer loop and never writes to persistence directly.
 */
export class MidiRuntime {
  private access: MidiAccessLike | null = null;
  private accessStatus: MidiAccessStatus = 'idle';
  private error: string | null = null;
  private listeners = new Set<RuntimeListener>();
  private boundInputs = new Map<string, BoundInput>();
  private diagnostics = new Map<string, MidiDeviceDiagnostic>();
  private profiles = new Map<string, DeviceProfile>();
  private mappings: ControllerMapping[] = [];
  private activeBanksByProfile = new Map<string, Set<string>>();
  private pressedGates = new Map<string, Set<string>>();
  private learnSession: LearnSession | null = null;
  private readonly queue: FrameSignalQueue;
  private readonly requester: MidiAccessRequester | null;
  private readonly secureContext: boolean;
  private readonly now: () => number;

  constructor(private readonly options: MidiRuntimeOptions) {
    this.requester = options.requestAccess ?? browserMidiRequester();
    this.secureContext = options.secureContext ?? browserSecureContext();
    this.now = options.now ?? (() => Date.now());
    this.queue = new FrameSignalQueue((virtualControlId, signal) => {
      this.options.engine.dispatch(virtualControlId, signal);
    });
  }

  /** Load the persisted control-surface document without asking for browser
   * permission. Safe to call during app startup/SSR hydration. */
  configure(document: ControlSurfaceDocument): void {
    this.profiles.clear();
    for (const profile of document.profiles) {
      if (profile.transport === 'midi') this.profiles.set(profile.id, profile);
    }

    this.mappings = document.mappings.filter((mapping) => this.profiles.has(mapping.profileId));
    this.activeBanksByProfile.clear();
    for (const mapping of this.mappings) {
      let banks = this.activeBanksByProfile.get(mapping.profileId);
      if (!banks) {
        banks = new Set();
        this.activeBanksByProfile.set(mapping.profileId, banks);
      }
      banks.add(mapping.activeBankId);
    }

    // Mapping-level Write mode is the inherited default. This is only a
    // routing normalization step; the engine/runtime decide what Write means.
    this.options.engine.setBindings(
      document.mappings.flatMap((mapping) =>
        mapping.bindings.map((binding) => ({
          ...binding,
          writeMode: binding.writeMode ?? mapping.writeMode,
        })),
      ),
    );

    this.refreshAllProfileMatches();
    this.emit();
  }

  /** Browser support check without triggering a permission prompt. */
  get supported(): boolean {
    return this.requester !== null;
  }

  /** Must be called from a user gesture in browsers that require it. No
   * SysEx is requested; Bluetooth MIDI is paired at OS level and appears as
   * a normal Web MIDI port when the browser/OS expose it. */
  async requestAccess(): Promise<MidiRuntimeSnapshot> {
    if (!this.requester) {
      this.accessStatus = 'unsupported';
      this.error = 'Web MIDI is not available in this browser.';
      this.emit();
      return this.snapshot();
    }
    if (!this.secureContext) {
      this.accessStatus = 'insecure-context';
      this.error = 'Web MIDI requires a secure context (HTTPS or localhost).';
      this.emit();
      return this.snapshot();
    }

    this.accessStatus = 'requesting';
    this.error = null;
    this.emit();

    try {
      const access = await this.requester();
      this.attachAccess(access);
      this.accessStatus = 'granted';
      this.error = null;
    } catch (error) {
      const name = errorName(error);
      this.accessStatus = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error';
      this.error = errorMessage(error, 'Unable to access MIDI devices.');
    }

    this.emit();
    return this.snapshot();
  }

  /** Public for the deterministic verifier and host shells that already own
   * a MIDIAccess object. Normal app code should use requestAccess(). */
  attachAccess(access: MidiAccessLike): void {
    if (this.access && this.access !== access) this.detachAccess();
    this.access = access;
    this.accessStatus = 'granted';
    this.error = null;
    this.access.onstatechange = () => this.syncInputs();
    this.syncInputs();
  }

  detachAccess(): void {
    if (this.access) this.access.onstatechange = null;
    for (const inputId of [...this.boundInputs.keys()]) this.unbindInput(inputId, true);
    this.boundInputs.clear();
    this.access = null;
    this.emit();
  }

  /** Start one-shot MIDI Learn capture. System realtime, Active Sensing,
   * Note Off, and Channel Mode CCs are filtered before the callback fires. */
  startLearn(options: MidiLearnOptions, handler: LearnHandler): () => void {
    this.learnSession = { options: { ...options }, handler };
    this.emit();
    return () => this.cancelLearn();
  }

  cancelLearn(): void {
    if (!this.learnSession) return;
    this.learnSession = null;
    this.emit();
  }

  /** Useful for future Settings bank UI; does not mutate localStorage by
   * itself. Phase 4.97F owns persistence/portability UX. */
  setActiveBank(mappingId: string, bankId: string): boolean {
    const mapping = this.mappings.find((candidate) => candidate.id === mappingId);
    if (!mapping) return false;
    const profile = this.profiles.get(mapping.profileId);
    if (!profile?.banks.some((bank) => bank.id === bankId)) return false;
    mapping.activeBankId = bankId;
    this.rebuildActiveBanks(mapping.profileId);
    return true;
  }

  /** Flush frame-coalesced CC/pitch/relative updates. Normally rAF does this;
   * exposed for deterministic diagnostics and non-rAF host shells. */
  flushPending(): void {
    this.queue.flush();
  }

  panic(): void {
    this.queue.clear();
    this.pressedGates.clear();
    this.options.engine.panic();
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): MidiRuntimeSnapshot {
    return {
      accessStatus: this.accessStatus,
      supported: this.supported,
      secureContext: this.secureContext,
      error: this.error,
      learning: this.learnSession !== null,
      devices: [...this.diagnostics.values()]
        .map(cloneDiagnostic)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    };
  }

  dispose(): void {
    this.cancelLearn();
    this.queue.clear();
    this.detachAccess();
    this.listeners.clear();
  }

  private syncInputs(): void {
    if (!this.access) return;
    const seen = new Set<string>();

    try {
      for (const input of this.access.inputs.values()) {
        seen.add(input.id);
        const connected = normalizedState(input.state) !== 'disconnected';
        this.ensureDiagnostic(input, connected ? 'connected' : 'disconnected');

        if (connected) {
          const existing = this.boundInputs.get(input.id);
          if (!existing || existing.input !== input) {
            if (existing) this.unbindInput(input.id, false);
            this.bindInput(input);
          }
        } else if (this.boundInputs.has(input.id)) {
          this.unbindInput(input.id, true);
        }
      }

      for (const inputId of [...this.boundInputs.keys()]) {
        if (!seen.has(inputId)) this.unbindInput(inputId, true);
      }
    } catch (error) {
      this.error = errorMessage(error, 'MIDI device enumeration failed.');
    }

    this.refreshAllProfileMatches();
    this.emit();
  }

  private bindInput(input: MidiInputLike): void {
    const handler = (event: { data: ArrayLike<number> | null; timeStamp?: number }) => {
      try {
        this.processMessage(input, event.data, event.timeStamp);
      } catch (error) {
        const diagnostic = this.ensureDiagnostic(input, 'connected');
        diagnostic.activity.errors += 1;
        this.error = errorMessage(error, 'MIDI input processing failed.');
        this.emit();
      }
    };

    input.onmidimessage = handler;
    this.boundInputs.set(input.id, { input, handler });
    this.ensureDiagnostic(input, 'connected').connection = normalizedConnection(input.connection);

    if (input.open) {
      void input.open().then(() => {
        const diagnostic = this.diagnostics.get(input.id);
        if (diagnostic) diagnostic.connection = 'open';
        this.emit();
      }).catch((error) => {
        const diagnostic = this.ensureDiagnostic(input, 'connected');
        diagnostic.activity.errors += 1;
        diagnostic.connection = normalizedConnection(input.connection);
        this.error = errorMessage(error, `Could not open MIDI input ${diagnostic.name}.`);
        this.emit();
      });
    }
  }

  private unbindInput(inputId: string, markDisconnected: boolean): void {
    const bound = this.boundInputs.get(inputId);
    if (!bound) return;

    bound.input.onmidimessage = null;
    this.releasePressedGates(inputId);
    this.boundInputs.delete(inputId);

    const diagnostic = this.diagnostics.get(inputId);
    if (diagnostic && markDisconnected) {
      diagnostic.state = 'disconnected';
      diagnostic.connection = 'closed';
    }

    if (bound.input.close) void bound.input.close().catch(() => undefined);
  }

  private processMessage(input: MidiInputLike, data: ArrayLike<number> | null, eventTime?: number): void {
    const diagnostic = this.ensureDiagnostic(input, 'connected');
    diagnostic.activity.messagesReceived += 1;
    diagnostic.activity.lastMessageAt = Number.isFinite(eventTime) ? Number(eventTime) : this.now();

    const decoded = decodeMidiMessage(data);
    if (!decoded) {
      diagnostic.activity.ignoredMessages += 1;
      diagnostic.activity.lastMessageLabel = 'Malformed MIDI message';
      this.emit();
      return;
    }

    diagnostic.activity.lastMessageLabel = midiMessageLabel(decoded);
    this.captureLearn(input, diagnostic, decoded);

    if (decoded.kind === 'system' || decoded.kind === 'unsupported') {
      diagnostic.activity.ignoredMessages += 1;
      this.emit();
      return;
    }

    const match = diagnostic.profileMatch;
    if (match.status !== 'matched' || !match.profileId) {
      diagnostic.activity.unroutedMessages += 1;
      this.emit();
      return;
    }

    const profile = this.profiles.get(match.profileId);
    if (!profile) {
      diagnostic.activity.unroutedMessages += 1;
      this.emit();
      return;
    }

    const controls = this.controlsForMessage(profile, decoded);
    if (controls.length === 0) {
      diagnostic.activity.unroutedMessages += 1;
      this.emit();
      return;
    }

    let routed = 0;
    for (const control of controls) {
      if (control.matcher.transport !== 'midi') continue;
      const signal = midiMessageToSignal(decoded, control.matcher, profile.defaultRelativeMode ?? 'absolute');
      if (!signal) continue;
      this.trackGate(input.id, control.id, signal);
      diagnostic.activity.lastSignal = { ...signal };
      this.queue.enqueue(control.id, signal);
      routed += 1;
    }

    diagnostic.activity.routedSignals += routed;
    if (routed === 0) diagnostic.activity.unroutedMessages += 1;
    this.emit();
  }

  private captureLearn(input: MidiInputLike, diagnostic: MidiDeviceDiagnostic, message: MidiDecodedMessage): void {
    const session = this.learnSession;
    if (!session || !isMidiLearnCandidate(message)) return;

    const options = session.options;
    if (options.inputId && options.inputId !== input.id) return;
    if (options.profileId) {
      if (diagnostic.profileMatch.status !== 'matched' || diagnostic.profileMatch.profileId !== options.profileId) return;
    }
    if (message.kind === 'cc' && options.allowCC === false) return;
    if (message.kind === 'note' && options.allowNotes === false) return;
    if (message.kind === 'pitchbend' && options.allowPitchBend === false) return;

    const profile = diagnostic.profileMatch.status === 'matched' && diagnostic.profileMatch.profileId
      ? this.profiles.get(diagnostic.profileMatch.profileId)
      : undefined;
    const relativeMode = options.relativeMode ?? profile?.defaultRelativeMode ?? 'absolute';
    const matcher = learnMatcherForMessage(message, relativeMode);
    if (!matcher) return;
    const signal = midiMessageToSignal(message, matcher, relativeMode);
    if (!signal) return;

    const candidate: MidiLearnCandidate = {
      inputId: input.id,
      fingerprint: fingerprintForInput(input),
      profileId: profile?.id,
      matcher,
      signal,
      message,
      label: midiMessageLabel(message),
    };

    // One-shot by construction: clear before calling user code so a handler
    // that immediately starts a new Learn session cannot be wiped afterward.
    this.learnSession = null;
    try {
      session.handler(candidate);
    } catch (error) {
      diagnostic.activity.errors += 1;
      this.error = errorMessage(error, 'MIDI Learn handler failed.');
    }
  }

  private controlsForMessage(profile: DeviceProfile, message: MidiDecodedMessage): VirtualControl[] {
    const activeBanks = this.activeBanksByProfile.get(profile.id);
    if (!activeBanks?.size) return [];

    const controls = new Map<string, VirtualControl>();
    for (const bank of profile.banks) {
      if (!activeBanks.has(bank.id)) continue;
      for (const control of bank.controls) {
        if (control.matcher.transport !== 'midi') continue;
        if (midiMatcherMatches(control.matcher, message)) controls.set(control.id, control);
      }
    }
    return [...controls.values()];
  }

  private trackGate(inputId: string, virtualControlId: string, signal: ControlSignal): void {
    if (signal.kind !== 'gate') return;
    let pressed = this.pressedGates.get(inputId);
    if (!pressed) {
      pressed = new Set();
      this.pressedGates.set(inputId, pressed);
    }
    if (signal.pressed) pressed.add(virtualControlId);
    else pressed.delete(virtualControlId);
    if (pressed.size === 0) this.pressedGates.delete(inputId);
  }

  private releasePressedGates(inputId: string): void {
    const pressed = this.pressedGates.get(inputId);
    if (!pressed?.size) return;
    for (const virtualControlId of pressed) {
      this.queue.enqueue(virtualControlId, { kind: 'gate', pressed: false, velocity: 0 });
    }
    this.pressedGates.delete(inputId);
    // Disconnect safety must not wait for a future animation frame that may
    // be throttled/minimized. Flush Note Off releases immediately.
    this.queue.flush();
  }

  private ensureDiagnostic(input: MidiInputLike, state: 'connected' | 'disconnected'): MidiDeviceDiagnostic {
    let diagnostic = this.diagnostics.get(input.id);
    if (!diagnostic) {
      diagnostic = {
        id: input.id,
        name: clean(input.name) || 'Unnamed MIDI Input',
        manufacturer: clean(input.manufacturer) || 'Unknown manufacturer',
        state,
        connection: normalizedConnection(input.connection),
        fingerprint: fingerprintForInput(input),
        profileMatch: { status: 'unmatched' },
        activity: EMPTY_ACTIVITY(),
      };
      this.diagnostics.set(input.id, diagnostic);
    } else {
      diagnostic.name = clean(input.name) || diagnostic.name;
      diagnostic.manufacturer = clean(input.manufacturer) || diagnostic.manufacturer;
      diagnostic.state = state;
      diagnostic.connection = normalizedConnection(input.connection);
      diagnostic.fingerprint = fingerprintForInput(input);
    }
    // Do not recompute an existing match here: refreshAllProfileMatches()
    // performs the second-pass multi-device ambiguity check. Replacing it
    // per message would accidentally erase that safety decision.
    if (diagnostic.profileMatch.status === 'unmatched' && this.profiles.size > 0) {
      diagnostic.profileMatch = matchMidiProfile(input, [...this.profiles.values()]);
    }
    return diagnostic;
  }

  private refreshAllProfileMatches(): void {
    const profiles = [...this.profiles.values()];
    const connected = [...this.boundInputs.entries()];

    for (const [inputId, bound] of connected) {
      const diagnostic = this.diagnostics.get(inputId);
      if (diagnostic) diagnostic.profileMatch = matchMidiProfile(bound.input, profiles);
    }

    // A single profile falling back by name/manufacturer to TWO identical
    // connected devices is not safe enough to guess. Exact port-id ownership
    // wins; competing fallback candidates are marked ambiguous and do not route.
    const exactOwner = new Map<string, string>();
    for (const [inputId] of connected) {
      const match = this.diagnostics.get(inputId)?.profileMatch;
      if (match?.status === 'matched' && match.profileId && match.basis === 'port-id') {
        exactOwner.set(match.profileId, inputId);
      }
    }

    const fallbackByProfile = new Map<string, string[]>();
    for (const [inputId] of connected) {
      const match = this.diagnostics.get(inputId)?.profileMatch;
      if (match?.status !== 'matched' || !match.profileId || match.basis === 'port-id') continue;
      const list = fallbackByProfile.get(match.profileId) ?? [];
      list.push(inputId);
      fallbackByProfile.set(match.profileId, list);
    }

    for (const [profileId, fallbackInputs] of fallbackByProfile) {
      const owner = exactOwner.get(profileId);
      const competing = owner ? [owner, ...fallbackInputs] : fallbackInputs;
      if (!owner && fallbackInputs.length < 2) continue;

      for (const inputId of fallbackInputs) {
        const diagnostic = this.diagnostics.get(inputId);
        if (!diagnostic) continue;
        diagnostic.profileMatch = {
          status: 'ambiguous',
          ambiguousProfileIds: [profileId],
          ambiguousInputIds: [...competing],
        };
      }
    }
  }

  private rebuildActiveBanks(profileId: string): void {
    const banks = new Set<string>();
    for (const mapping of this.mappings) {
      if (mapping.profileId === profileId) banks.add(mapping.activeBankId);
    }
    this.activeBanksByProfile.set(profileId, banks);
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('[ControlSurface:MIDI] diagnostic listener failed', error);
      }
    }
  }
}

/** Deterministic reconnect matcher. Exact browser port id wins. If that id
 * changes across reconnect, name/manufacturer fallback is allowed only when
 * there is one clear winner; duplicate identical devices remain ambiguous
 * rather than silently controlling the wrong surface. */
export function matchMidiProfile(input: MidiInputLike, profiles: DeviceProfile[]): MidiProfileMatch {
  const midiProfiles = profiles.filter((profile) => profile.transport === 'midi');
  const exactPort = midiProfiles.filter((profile) => clean(profile.fingerprint.portId) === input.id);
  if (exactPort.length === 1) return { status: 'matched', profileId: exactPort[0]!.id, basis: 'port-id' };
  if (exactPort.length > 1) {
    return { status: 'ambiguous', ambiguousProfileIds: exactPort.map((profile) => profile.id) };
  }

  const inputName = normalized(input.name);
  const inputManufacturer = normalized(input.manufacturer);
  const scored = midiProfiles.flatMap((profile) => {
    const name = normalized(profile.fingerprint.name);
    const manufacturer = normalized(profile.fingerprint.manufacturer);
    if (name && inputName && name !== inputName) return [];
    if (manufacturer && inputManufacturer && manufacturer !== inputManufacturer) return [];

    let score = 0;
    let basis: MidiProfileMatch['basis'];
    if (name && inputName && name === inputName) {
      score += 4;
      basis = 'name';
    }
    if (manufacturer && inputManufacturer && manufacturer === inputManufacturer) {
      score += 2;
      basis = basis === 'name' ? 'name-manufacturer' : 'manufacturer';
    }
    return score > 0 ? [{ profile, score, basis }] : [];
  });

  if (scored.length === 0) return { status: 'unmatched' };
  const topScore = Math.max(...scored.map((entry) => entry.score));
  const winners = scored.filter((entry) => entry.score === topScore);
  if (winners.length !== 1) {
    return { status: 'ambiguous', ambiguousProfileIds: winners.map((entry) => entry.profile.id) };
  }
  return { status: 'matched', profileId: winners[0]!.profile.id, basis: winners[0]!.basis };
}

export function fingerprintForInput(input: MidiInputLike): DeviceFingerprint {
  return {
    transport: 'midi',
    manufacturer: clean(input.manufacturer) || undefined,
    name: clean(input.name) || undefined,
    portId: input.id || undefined,
  };
}

function browserMidiRequester(): MidiAccessRequester | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & {
    requestMIDIAccess?: (options?: { sysex?: boolean; software?: boolean }) => Promise<unknown>;
  };
  if (typeof nav.requestMIDIAccess !== 'function') return null;
  return async () => {
    const access = await nav.requestMIDIAccess!({ sysex: false, software: false });
    return access as MidiAccessLike;
  };
}

function browserSecureContext(): boolean {
  if (typeof window === 'undefined') return false;
  return window.isSecureContext;
}

function normalizedState(value: string | undefined): 'connected' | 'disconnected' | 'unknown' {
  return value === 'connected' || value === 'disconnected' ? value : 'unknown';
}

function normalizedConnection(value: string | undefined): 'open' | 'closed' | 'pending' | 'unknown' {
  return value === 'open' || value === 'closed' || value === 'pending' ? value : 'unknown';
}

function normalized(value: string | null | undefined): string {
  return clean(value).toLowerCase().replace(/\s+/g, ' ');
}

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneDiagnostic(value: MidiDeviceDiagnostic): MidiDeviceDiagnostic {
  return {
    ...value,
    fingerprint: { ...value.fingerprint },
    profileMatch: {
      ...value.profileMatch,
      ambiguousProfileIds: value.profileMatch.ambiguousProfileIds
        ? [...value.profileMatch.ambiguousProfileIds]
        : undefined,
      ambiguousInputIds: value.profileMatch.ambiguousInputIds
        ? [...value.profileMatch.ambiguousInputIds]
        : undefined,
    },
    activity: {
      ...value.activity,
      lastSignal: value.activity.lastSignal ? { ...value.activity.lastSignal } : null,
    },
  };
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : '';
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
