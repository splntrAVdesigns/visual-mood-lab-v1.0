import { ControlSurfaceBindingEngine } from './binding-engine';
import { applyResponseCurve, clampBipolar, clamp01 } from './normalize';
import { PolledTransportScheduler } from './scheduler';
import type {
  ControllerBinding,
  ControlSignal,
  ControlSurfaceDocument,
  DeviceProfile,
  GamepadCalibration,
  VirtualControl,
} from './types';
import type {
  GamepadDeviceActivity,
  GamepadDeviceDiagnostic,
  GamepadGetter,
  GamepadLearnCandidate,
  GamepadLearnOptions,
  GamepadLike,
  GamepadProfileMatch,
  GamepadRuntimeSnapshot,
} from './gamepad-types';

const DEFAULT_AXIS_DEADZONE = 0.08;
const AXIS_CHANGE_EPSILON = 0.0025;
const BUTTON_CHANGE_EPSILON = 0.015;
const DEFAULT_LEARN_THRESHOLD = 0.18;

interface LearnBaseline {
  axes: number[];
  buttons: number[];
  pressed: boolean[];
}

interface LearnSession {
  options: GamepadLearnOptions;
  baseline: Map<number, LearnBaseline>;
  handler: (candidate: GamepadLearnCandidate) => void;
}

type RuntimeListener = (snapshot: GamepadRuntimeSnapshot) => void;

interface LastControlState {
  value: number;
  pressed?: boolean;
}

/**
 * Phase 4.97E — fault-contained Gamepad API transport.
 *
 * MIDI is event-driven; Gamepad is not. This adapter therefore owns one
 * isolated rAF poller (never the renderer pool's frame loop), discovers all
 * connected pads through navigator.getGamepads(), normalizes axes/buttons,
 * performs standard-stick radial deadzones, and dispatches only meaningful
 * changes into the transport-independent binding engine.
 */
export class GamepadRuntime {
  private profiles = new Map<string, DeviceProfile>();
  private mappings: Array<{ profileId: string; activeBankId: string; bindings: ControllerBinding[] }> = [];
  private activeBanksByProfile = new Map<string, Set<string>>();
  private diagnostics = new Map<string, GamepadDeviceDiagnostic>();
  private lastControl = new Map<string, LastControlState>();
  private listeners = new Set<RuntimeListener>();
  private scheduler = new PolledTransportScheduler();
  private learnSession: LearnSession | null = null;
  private status: GamepadRuntimeSnapshot['status'] = 'idle';
  private error: string | null = null;
  private readonly getter: GamepadGetter | null;
  private readonly now: () => number;

  constructor(
    private readonly engine: ControlSurfaceBindingEngine,
    options: { getGamepads?: GamepadGetter | null; now?: () => number } = {},
  ) {
    this.getter = options.getGamepads === undefined ? browserGamepadGetter() : options.getGamepads;
    this.now = options.now ?? (() => Date.now());
  }

  configure(document: ControlSurfaceDocument): void {
    this.profiles.clear();
    for (const profile of document.profiles) {
      if (profile.transport === 'gamepad') this.profiles.set(profile.id, profile);
    }

    this.mappings = document.mappings
      .filter((mapping) => this.profiles.has(mapping.profileId))
      .map((mapping) => ({
        profileId: mapping.profileId,
        activeBankId: mapping.activeBankId,
        bindings: mapping.bindings.map((binding) => ({ ...binding, target: { ...binding.target } } as ControllerBinding)),
      }));

    this.activeBanksByProfile.clear();
    for (const mapping of this.mappings) {
      let set = this.activeBanksByProfile.get(mapping.profileId);
      if (!set) {
        set = new Set();
        this.activeBanksByProfile.set(mapping.profileId, set);
      }
      set.add(mapping.activeBankId);
    }

    this.engine.setBindings(this.mappings.flatMap((mapping) => mapping.bindings));
    this.refreshDiagnostics();
    this.emit();
  }

  get supported(): boolean {
    return this.getter !== null;
  }

  get active(): boolean {
    return this.scheduler.active;
  }

  enable(): GamepadRuntimeSnapshot {
    if (!this.getter) {
      this.status = 'unsupported';
      this.error = 'Gamepad API is not available in this browser.';
      this.emit();
      return this.snapshot();
    }
    if (!this.scheduler.active) {
      this.status = 'active';
      this.error = null;
      this.scheduler.start(() => this.poll());
      // Poll once immediately so already-authorized/connected controllers
      // appear without waiting for the next animation frame.
      this.poll();
    }
    return this.snapshot();
  }

  disable(): void {
    this.scheduler.stop();
    this.learnSession = null;
    this.lastControl.clear();
    this.status = this.supported ? 'idle' : 'unsupported';
    this.emit();
  }

  startLearn(
    options: GamepadLearnOptions,
    handler: (candidate: GamepadLearnCandidate) => void,
  ): () => void {
    this.enable();
    this.learnSession = {
      options: { ...options },
      baseline: this.captureBaselines(),
      handler,
    };
    this.emit();
    return () => this.cancelLearn();
  }

  cancelLearn(): void {
    if (!this.learnSession) return;
    this.learnSession = null;
    this.emit();
  }

  panic(): void {
    this.engine.panic();
    this.lastControl.clear();
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): GamepadRuntimeSnapshot {
    return {
      status: this.status,
      supported: this.supported,
      active: this.active,
      learning: this.learnSession !== null,
      error: this.error,
      devices: [...this.diagnostics.values()]
        .map(cloneDiagnostic)
        .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id)),
    };
  }

  dispose(): void {
    this.disable();
    this.diagnostics.clear();
    this.listeners.clear();
  }

  /** Public deterministic hook for QA and non-rAF shells. */
  poll(): void {
    if (!this.getter) return;

    try {
      const pads = connectedPads(this.getter());
      this.syncDiagnostics(pads);
      this.captureLearnCandidate(pads);
      for (const pad of pads) this.routePad(pad, pads);
      this.status = 'active';
      this.error = null;
    } catch (error) {
      this.status = 'error';
      this.error = error instanceof Error ? error.message : 'Gamepad polling failed.';
    }
    this.emit();
  }

  private routePad(pad: GamepadLike, pads: GamepadLike[]): void {
    const inputId = inputIdFor(pad);
    const diagnostic = this.ensureDiagnostic(pad);
    diagnostic.activity.polls += 1;

    const match = matchGamepadProfile(pad, pads, [...this.profiles.values()]);
    diagnostic.profileMatch = match;
    if (match.status !== 'matched' || !match.profileId) return;

    const profile = this.profiles.get(match.profileId);
    if (!profile) return;
    const controls = this.activeControls(profile);
    if (controls.length === 0) return;

    const axes = resolvedAxes(pad, controls);

    for (const control of controls) {
      if (control.matcher.transport !== 'gamepad') continue;
      const key = `${inputId}:${control.id}`;

      if (control.matcher.input === 'axis') {
        const value = axes.get(control.matcher.index);
        if (value === undefined) continue;
        const previous = this.lastControl.get(key)?.value;
        if (previous !== undefined && Math.abs(value - previous) < AXIS_CHANGE_EPSILON) continue;

        const signal: ControlSignal = { kind: 'bipolar', value };
        this.lastControl.set(key, { value });
        this.engine.dispatch(control.id, signal);
        recordSignal(diagnostic.activity, signal, `Axis ${control.matcher.index}`, this.now());
        continue;
      }

      const button = pad.buttons[control.matcher.index];
      if (!button) continue;
      const value = clamp01(finite(button.value, button.pressed ? 1 : 0));
      const pressed = Boolean(button.pressed || value > 0.02);
      const previous = this.lastControl.get(key);
      if (
        previous &&
        previous.pressed === pressed &&
        Math.abs(previous.value - value) < BUTTON_CHANGE_EPSILON
      ) {
        continue;
      }

      const signal: ControlSignal = { kind: 'gate', pressed, velocity: value };
      this.lastControl.set(key, { value, pressed });
      this.engine.dispatch(control.id, signal);
      recordSignal(diagnostic.activity, signal, `Button ${control.matcher.index}`, this.now());
    }
  }

  private activeControls(profile: DeviceProfile): VirtualControl[] {
    const active = this.activeBanksByProfile.get(profile.id);
    if (!active?.size) return [];
    const out: VirtualControl[] = [];
    const seen = new Set<string>();
    for (const bank of profile.banks) {
      if (!active.has(bank.id)) continue;
      for (const control of bank.controls) {
        if (seen.has(control.id)) continue;
        seen.add(control.id);
        out.push(control);
      }
    }
    return out;
  }

  private captureLearnCandidate(pads: GamepadLike[]): void {
    const session = this.learnSession;
    if (!session) return;

    const candidates = pads.filter((pad) =>
      session.options.gamepadIndex === undefined || pad.index === session.options.gamepadIndex,
    );
    const threshold = clamp01(session.options.axisThreshold ?? DEFAULT_LEARN_THRESHOLD);

    for (const pad of candidates) {
      let baseline = session.baseline.get(pad.index);
      if (!baseline) {
        baseline = baselineFor(pad);
        session.baseline.set(pad.index, baseline);
        continue;
      }

      if (session.options.allowButtons !== false) {
        for (let index = 0; index < pad.buttons.length; index++) {
          const button = pad.buttons[index]!;
          const wasPressed = baseline.pressed[index] ?? false;
          const before = baseline.buttons[index] ?? 0;
          const value = clamp01(finite(button.value, button.pressed ? 1 : 0));
          const pressed = Boolean(button.pressed || value >= 0.5);
          if ((pressed && !wasPressed) || value - before >= 0.5) {
            this.finishLearn(pad, {
              transport: 'gamepad',
              input: 'button',
              index,
            }, { kind: 'gate', pressed: true, velocity: value }, `Button ${index}`);
            return;
          }
        }
      }

      if (session.options.allowAxes !== false) {
        let strongestIndex = -1;
        let strongestDelta = threshold;
        for (let index = 0; index < pad.axes.length; index++) {
          const before = baseline.axes[index] ?? 0;
          const raw = clampBipolar(finite(pad.axes[index], 0));
          const delta = Math.abs(raw - before);
          if (delta > strongestDelta) {
            strongestDelta = delta;
            strongestIndex = index;
          }
        }
        if (strongestIndex >= 0) {
          const value = clampBipolar(finite(pad.axes[strongestIndex], 0));
          this.finishLearn(pad, {
            transport: 'gamepad',
            input: 'axis',
            index: strongestIndex,
          }, { kind: 'bipolar', value }, `Axis ${strongestIndex}`);
          return;
        }
      }
    }
  }

  private finishLearn(
    pad: GamepadLike,
    matcher: GamepadLearnCandidate['matcher'],
    signal: ControlSignal,
    label: string,
  ): void {
    const session = this.learnSession;
    if (!session) return;
    const diagnostic = this.ensureDiagnostic(pad);
    const candidate: GamepadLearnCandidate = {
      inputId: inputIdFor(pad),
      gamepadIndex: pad.index,
      fingerprint: fingerprintFor(pad),
      profileId: diagnostic.profileMatch.status === 'matched' ? diagnostic.profileMatch.profileId : undefined,
      matcher,
      signal,
      label,
    };

    this.learnSession = null;
    try {
      session.handler(candidate);
    } catch (error) {
      diagnostic.activity.errors += 1;
      this.error = error instanceof Error ? error.message : 'Gamepad Learn handler failed.';
    }
  }

  private captureBaselines(): Map<number, LearnBaseline> {
    const out = new Map<number, LearnBaseline>();
    if (!this.getter) return out;
    for (const pad of connectedPads(this.getter())) out.set(pad.index, baselineFor(pad));
    return out;
  }

  private syncDiagnostics(pads: GamepadLike[]): void {
    const seen = new Set<string>();
    for (const pad of pads) {
      const inputId = inputIdFor(pad);
      seen.add(inputId);
      const diagnostic = this.ensureDiagnostic(pad);
      diagnostic.connected = true;
      diagnostic.id = pad.id || `Gamepad ${pad.index + 1}`;
      diagnostic.mapping = pad.mapping || '';
      diagnostic.fingerprint = fingerprintFor(pad);
    }
    for (const diagnostic of this.diagnostics.values()) {
      if (!seen.has(diagnostic.inputId)) diagnostic.connected = false;
    }
  }

  private refreshDiagnostics(): void {
    if (!this.getter) return;
    try {
      const pads = connectedPads(this.getter());
      this.syncDiagnostics(pads);
      for (const pad of pads) {
        this.ensureDiagnostic(pad).profileMatch = matchGamepadProfile(
          pad,
          pads,
          [...this.profiles.values()],
        );
      }
    } catch {
      // Enumeration failures are surfaced by the active poller. Config reload
      // must remain safe even before the browser has exposed a gamepad.
    }
  }

  private ensureDiagnostic(pad: GamepadLike): GamepadDeviceDiagnostic {
    const inputId = inputIdFor(pad);
    let diagnostic = this.diagnostics.get(inputId);
    if (!diagnostic) {
      diagnostic = {
        inputId,
        index: pad.index,
        id: pad.id || `Gamepad ${pad.index + 1}`,
        mapping: pad.mapping || '',
        connected: pad.connected !== false,
        fingerprint: fingerprintFor(pad),
        profileMatch: { status: 'unmatched' },
        activity: emptyActivity(),
      };
      this.diagnostics.set(inputId, diagnostic);
    }
    return diagnostic;
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function browserGamepadGetter(): GamepadGetter | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  return () => navigator.getGamepads() as unknown as ArrayLike<GamepadLike | null>;
}

function connectedPads(list: ArrayLike<GamepadLike | null>): GamepadLike[] {
  const pads: GamepadLike[] = [];
  for (let i = 0; i < list.length; i++) {
    const pad = list[i];
    if (pad && pad.connected !== false) pads.push(pad);
  }
  return pads;
}

function fingerprintFor(pad: GamepadLike) {
  return {
    transport: 'gamepad' as const,
    name: pad.id || `Gamepad ${pad.index + 1}`,
    portId: inputIdFor(pad),
    mapping: pad.mapping || undefined,
  };
}

function inputIdFor(pad: GamepadLike): string {
  return `gamepad:${pad.index}`;
}

function baselineFor(pad: GamepadLike): LearnBaseline {
  return {
    axes: pad.axes.map((value) => clampBipolar(finite(value, 0))),
    buttons: pad.buttons.map((button) => clamp01(finite(button.value, button.pressed ? 1 : 0))),
    pressed: pad.buttons.map((button) => Boolean(button.pressed)),
  };
}

function resolvedAxes(pad: GamepadLike, controls: VirtualControl[]): Map<number, number> {
  const axisControls = controls.filter(
    (control): control is VirtualControl & { matcher: { transport: 'gamepad'; input: 'axis'; index: number } } =>
      control.matcher.transport === 'gamepad' && control.matcher.input === 'axis',
  );
  const pre = new Map<number, number>();
  for (const control of axisControls) {
    pre.set(control.matcher.index, calibrateAxisBase(
      finite(pad.axes[control.matcher.index], 0),
      control.calibration,
    ));
  }

  const radiallyHandled = new Set<number>();
  if (pad.mapping === 'standard') {
    for (const [xIndex, yIndex] of [[0, 1], [2, 3]] as const) {
      const xControl = axisControls.find((control) => control.matcher.index === xIndex);
      const yControl = axisControls.find((control) => control.matcher.index === yIndex);
      if (!xControl && !yControl) continue;
      const x = pre.get(xIndex) ?? calibrateAxisBase(finite(pad.axes[xIndex], 0), xControl?.calibration);
      const y = pre.get(yIndex) ?? calibrateAxisBase(finite(pad.axes[yIndex], 0), yControl?.calibration);
      const deadzone = Math.max(
        xControl?.calibration?.deadzone ?? DEFAULT_AXIS_DEADZONE,
        yControl?.calibration?.deadzone ?? DEFAULT_AXIS_DEADZONE,
      );
      const [rx, ry] = radialDeadzone(x, y, deadzone);
      pre.set(xIndex, rx);
      pre.set(yIndex, ry);
      radiallyHandled.add(xIndex);
      radiallyHandled.add(yIndex);
    }
  }

  const out = new Map<number, number>();
  for (const control of axisControls) {
    const index = control.matcher.index;
    const calibration = control.calibration;
    let value = pre.get(index) ?? 0;
    if (!radiallyHandled.has(index)) {
      value = axialDeadzone(value, calibration?.deadzone ?? DEFAULT_AXIS_DEADZONE);
    }
    if (calibration?.invert) value = -value;
    value = applyBipolarCurve(value, calibration?.curve ?? 'linear');
    out.set(index, clampBipolar(value));
  }
  return out;
}

function calibrateAxisBase(raw: number, calibration?: GamepadCalibration): number {
  const center = finite(calibration?.center, 0);
  const min = Math.min(center - 0.0001, finite(calibration?.min, -1));
  const max = Math.max(center + 0.0001, finite(calibration?.max, 1));
  const clamped = Math.max(min, Math.min(max, raw));
  if (clamped >= center) return clampBipolar((clamped - center) / (max - center));
  return clampBipolar((clamped - center) / (center - min));
}

function axialDeadzone(value: number, deadzone: number): number {
  const dz = Math.min(0.95, Math.max(0, finite(deadzone, DEFAULT_AXIS_DEADZONE)));
  const magnitude = Math.abs(value);
  if (magnitude <= dz) return 0;
  return Math.sign(value) * Math.min(1, (magnitude - dz) / (1 - dz));
}

function radialDeadzone(x: number, y: number, deadzone: number): [number, number] {
  const dz = Math.min(0.95, Math.max(0, finite(deadzone, DEFAULT_AXIS_DEADZONE)));
  const magnitude = Math.hypot(x, y);
  if (magnitude <= dz || magnitude === 0) return [0, 0];
  const scaled = Math.min(1, (magnitude - dz) / (1 - dz));
  return [clampBipolar((x / magnitude) * scaled), clampBipolar((y / magnitude) * scaled)];
}

function applyBipolarCurve(value: number, curve: NonNullable<GamepadCalibration['curve']>): number {
  const sign = Math.sign(value);
  return sign * applyResponseCurve(Math.abs(value), curve);
}

function matchGamepadProfile(
  pad: GamepadLike,
  pads: GamepadLike[],
  profiles: DeviceProfile[],
): GamepadProfileMatch {
  const gamepadProfiles = profiles.filter((profile) => profile.transport === 'gamepad');
  const inputId = inputIdFor(pad);
  const exact = gamepadProfiles.filter((profile) => profile.fingerprint.portId === inputId);
  if (exact.length === 1) return { status: 'matched', profileId: exact[0]!.id, basis: 'session-index' };
  if (exact.length > 1) {
    return { status: 'ambiguous', ambiguousProfileIds: exact.map((profile) => profile.id) };
  }

  const name = normalized(pad.id);
  const mapping = normalized(pad.mapping);
  const byIdMapping = gamepadProfiles.filter((profile) =>
    normalized(profile.fingerprint.name) === name &&
    normalized(profile.fingerprint.mapping) === mapping,
  );
  if (byIdMapping.length === 1) {
    const competing = pads.filter((candidate) =>
      normalized(candidate.id) === name && normalized(candidate.mapping) === mapping,
    );
    if (competing.length > 1) {
      return {
        status: 'ambiguous',
        profileId: byIdMapping[0]!.id,
        ambiguousInputIds: competing.map(inputIdFor),
      };
    }
    return { status: 'matched', profileId: byIdMapping[0]!.id, basis: 'id-mapping' };
  }
  if (byIdMapping.length > 1) {
    return { status: 'ambiguous', ambiguousProfileIds: byIdMapping.map((profile) => profile.id) };
  }

  const byId = gamepadProfiles.filter((profile) => normalized(profile.fingerprint.name) === name);
  if (byId.length === 1) return { status: 'matched', profileId: byId[0]!.id, basis: 'id' };
  if (byId.length > 1) return { status: 'ambiguous', ambiguousProfileIds: byId.map((profile) => profile.id) };
  return { status: 'unmatched' };
}

function emptyActivity(): GamepadDeviceActivity {
  return {
    polls: 0,
    routedSignals: 0,
    ignoredSignals: 0,
    errors: 0,
    lastSignalAt: null,
    lastSignalLabel: null,
    lastSignal: null,
  };
}

function recordSignal(
  activity: GamepadDeviceActivity,
  signal: ControlSignal,
  label: string,
  at: number,
): void {
  activity.routedSignals += 1;
  activity.lastSignalAt = at;
  activity.lastSignalLabel = label;
  activity.lastSignal = { ...signal } as ControlSignal;
}

function cloneDiagnostic(device: GamepadDeviceDiagnostic): GamepadDeviceDiagnostic {
  return {
    ...device,
    fingerprint: { ...device.fingerprint },
    profileMatch: {
      ...device.profileMatch,
      ambiguousProfileIds: device.profileMatch.ambiguousProfileIds
        ? [...device.profileMatch.ambiguousProfileIds]
        : undefined,
      ambiguousInputIds: device.profileMatch.ambiguousInputIds
        ? [...device.profileMatch.ambiguousInputIds]
        : undefined,
    },
    activity: {
      ...device.activity,
      lastSignal: device.activity.lastSignal ? ({ ...device.activity.lastSignal } as ControlSignal) : null,
    },
  };
}

function normalized(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
