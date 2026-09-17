import { getEffectSchema } from '@/lib/effects/registry';
import { getPool } from '@/lib/render/pool';
import { hydrate, type Control, type ParamValue } from '@/renderers/control-schema';
import { useBoardStore } from '@/stores/boardStore';
import { useInspectorStore } from '@/stores/inspectorStore';
import { clamp01, mapUnitToControl } from './normalize';
import { getControllerPresentationRegistry } from './presentation';
import { getLiveControlSurfaceRuntime, type LiveControlSurfaceRuntime } from './runtime';
import { resolveTargetCardId } from './targets';
import type {
  ControllerBinding,
  ControllerDispatchOutcome,
  ControlSignal,
  ControlSurfaceRuntimeAdapter,
  EffectTargetRef,
  ParameterTargetRef,
} from './types';

const PICKUP_WINDOW = 0.035;
const WRITE_SETTLE_MS = 320;
const MIN_SLEW_MS = 26;
const MAX_SLEW_MS = 48;
const SLEW_FULL_DISTANCE = 0.1;

interface DirectGestureState {
  latched: boolean;
  lastPhysical?: number;
  scaledPhysicalStart?: number;
  scaledTargetStart?: number;
}

interface PendingWrite {
  binding: ControllerBinding;
  cardId: string;
  value01: number;
}

interface SlewState {
  binding: ControllerBinding;
  signal: ControlSignal;
  from: number;
  to: number;
  current: number;
  startedAt: number;
  durationMs: number;
}

/**
 * Phase 4.97C direct-control policy layer.
 *
 * 4.97A's LiveControlSurfaceRuntime deliberately owns the low-level runtime
 * override path. This decorator adds the interaction semantics that belong to
 * a physical control: pickup/jump/scaled takeover and Write-mode settling.
 * Keeping those policies here means MIDI and Gamepad use the exact same
 * behavior instead of re-implementing takeover per transport.
 *
 * Phase 4.97F.2 additionally mirrors only successfully-applied runtime values
 * into the lightweight presentation registry. That lets sliders/readouts track
 * Live-mode hardware without converting every MIDI CC into persisted React
 * state or a database write.
 *
 * Phase 4.97F.3 adds a very short rAF-domain slew for continuous absolute
 * Direct controls. Standard MIDI CC is only 7-bit, so slowly turning a knob can
 * otherwise expose each discrete step as a tiny visual hitch. The slew stays
 * completely outside React/persistence and lands the exact endpoint within
 * roughly 26–48 ms. Relative encoders, gates, triggers, toggles/selects and
 * action routes remain immediate so response-critical controls gain no delay.
 */
export class DirectControlRuntime implements ControlSurfaceRuntimeAdapter {
  private gestures = new Map<string, DirectGestureState>();
  private writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingWrites = new Map<string, PendingWrite>();
  private lastApplied = new Map<string, number>();
  private slews = new Map<string, SlewState>();
  private slewRaf: number | null = null;

  constructor(private readonly inner: LiveControlSurfaceRuntime = getLiveControlSurfaceRuntime()) {}

  applyDirect(
    binding: ControllerBinding,
    value01: number,
    signal: ControlSignal,
  ): ControllerDispatchOutcome {
    const transformed = this.applyTakeover(binding, clamp01(value01), signal);
    if (transformed === null) {
      return { status: 'ignored', detail: 'Pickup waiting for the hardware control to reach the current value.' };
    }

    if (this.shouldSlew(binding, signal)) {
      return this.queueSlew(binding, transformed, signal);
    }

    this.cancelSlew(binding.id);
    return this.applyDirectNow(binding, transformed, signal);
  }

  applyModulation(
    binding: ControllerBinding,
    value01: number,
    signal: ControlSignal,
  ): ControllerDispatchOutcome {
    return this.inner.applyModulation(binding, value01, signal);
  }

  dispatchAction(binding: ControllerBinding, signal: ControlSignal): ControllerDispatchOutcome {
    return this.inner.dispatchAction(binding, signal);
  }

  clearBinding(bindingId: string): void {
    this.cancelWrite(bindingId);
    this.cancelSlew(bindingId);
    this.lastApplied.delete(bindingId);
    this.gestures.delete(bindingId);
    this.inner.clearBinding(bindingId);
  }

  panic(): void {
    for (const timer of this.writeTimers.values()) clearTimeout(timer);
    this.writeTimers.clear();
    this.pendingWrites.clear();
    this.lastApplied.clear();
    this.gestures.clear();
    this.slews.clear();
    if (this.slewRaf !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.slewRaf);
    }
    this.slewRaf = null;
    getControllerPresentationRegistry().clear();
    this.inner.panic();
  }

  private applyDirectNow(
    binding: ControllerBinding,
    value01: number,
    signal: ControlSignal,
  ): ControllerDispatchOutcome {
    const outcome = this.inner.applyDirect(binding, value01, signal);
    if (outcome.status === 'applied') {
      this.lastApplied.set(binding.id, value01);
      this.publishAppliedValue(binding, value01);
      if ((binding.writeMode ?? 'live') === 'write') {
        const cardId = resolveTargetCardId(binding.target, useBoardStore.getState().selectedId);
        if (cardId) this.scheduleWrite(binding, cardId, value01);
      }
    }
    return outcome;
  }

  private shouldSlew(binding: ControllerBinding, signal: ControlSignal): boolean {
    if (signal.kind !== 'absolute' && signal.kind !== 'bipolar') return false;
    if (binding.target.domain === 'action') return false;
    if (typeof requestAnimationFrame !== 'function') return false;

    const cardId = resolveTargetCardId(binding.target, useBoardStore.getState().selectedId);
    if (!cardId) return false;

    if (binding.target.domain === 'parameter') {
      const control = getPool()
        .get(cardId)
        ?.getControlSchema()
        ?.controls.find((candidate) => candidate.id === binding.target.controlId);
      return control?.kind === 'slider' || control?.kind === 'stepper';
    }

    const inspector = useInspectorStore.getState();
    const effects = inspector.itemId === cardId
      ? inspector.effects
      : useBoardStore.getState().assets.find((candidate) => candidate.itemId === cardId)?.effects ?? [];
    const instance = effects.find((candidate) => candidate.id === binding.target.effectInstanceId);
    const control = instance
      ? getEffectSchema(instance.effectType)?.controls.find((candidate) => candidate.id === binding.target.controlId)
      : undefined;
    return control?.kind === 'slider' || control?.kind === 'stepper';
  }

  private queueSlew(
    binding: ControllerBinding,
    target01: number,
    signal: ControlSignal,
  ): ControllerDispatchOutcome {
    const now = this.now();
    const existing = this.slews.get(binding.id);
    const from = existing
      ? this.sampleSlew(existing, now)
      : (this.lastApplied.get(binding.id) ?? this.readTargetUnit(binding) ?? target01);
    const distance = Math.abs(target01 - from);

    if (distance <= 0.00001) {
      this.cancelSlew(binding.id);
      return this.applyDirectNow(binding, target01, signal);
    }

    const durationMs = MIN_SLEW_MS +
      (MAX_SLEW_MS - MIN_SLEW_MS) * Math.min(1, distance / SLEW_FULL_DISTANCE);

    this.slews.set(binding.id, {
      binding: { ...binding, target: { ...binding.target } },
      signal: { ...signal },
      from,
      to: target01,
      current: from,
      startedAt: now,
      durationMs,
    });
    this.ensureSlewLoop();

    return { status: 'applied', detail: 'Continuous controller target queued for frame-smooth runtime interpolation.' };
  }

  private ensureSlewLoop(): void {
    if (this.slewRaf !== null || this.slews.size === 0 || typeof requestAnimationFrame !== 'function') return;
    this.slewRaf = requestAnimationFrame(this.tickSlews);
  }

  private tickSlews = (now: number): void => {
    this.slewRaf = null;

    for (const [bindingId, state] of this.slews) {
      const value = this.sampleSlew(state, now);
      state.current = value;
      const outcome = this.applyDirectNow(state.binding, value, state.signal);
      const done = now - state.startedAt >= state.durationMs;

      if (outcome.status !== 'applied' || done) {
        if (done && outcome.status === 'applied' && value !== state.to) {
          this.applyDirectNow(state.binding, state.to, state.signal);
        }
        this.slews.delete(bindingId);
      }
    }

    this.ensureSlewLoop();
  };

  private sampleSlew(state: SlewState, now: number): number {
    const elapsed = Math.max(0, now - state.startedAt);
    const t = state.durationMs <= 0 ? 1 : Math.min(1, elapsed / state.durationMs);
    // Ease-out keeps the control feeling immediate while still bridging the
    // visible gaps between 7-bit CC positions. Endpoint remains exact.
    const eased = 1 - Math.pow(1 - t, 2);
    return clamp01(state.from + (state.to - state.from) * eased);
  }

  private cancelSlew(bindingId: string): void {
    this.slews.delete(bindingId);
    if (this.slews.size === 0 && this.slewRaf !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.slewRaf);
      this.slewRaf = null;
    }
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private publishAppliedValue(binding: ControllerBinding, value01: number): void {
    if (binding.target.domain === 'action') return;
    const cardId = resolveTargetCardId(binding.target, useBoardStore.getState().selectedId);
    if (!cardId) return;

    if (binding.target.domain === 'parameter') {
      const prepared = this.parameterValue(binding.target, cardId, value01);
      if (prepared) getControllerPresentationRegistry().setParameter(cardId, binding.target.controlId, prepared.value);
      return;
    }

    const prepared = this.effectValue(binding.target, cardId, value01);
    if (prepared) {
      getControllerPresentationRegistry().setEffect(
        cardId,
        binding.target.effectInstanceId,
        binding.target.controlId,
        prepared.value,
      );
    }
  }

  private applyTakeover(
    binding: ControllerBinding,
    physical01: number,
    signal: ControlSignal,
  ): number | null {
    // Relative encoders already describe movement rather than an absolute
    // position, so forcing them through pickup/scaled semantics is both
    // redundant and actively wrong. The binding engine has already integrated
    // the delta into value01 by the time it reaches this layer.
    if (signal.kind === 'relative' || signal.kind === 'gate' || signal.kind === 'trigger') return physical01;

    const mode = binding.takeover ?? 'pickup';
    if (mode === 'jump') return physical01;

    const currentTarget = this.readTargetUnit(binding);
    if (currentTarget === null) return physical01;

    let state = this.gestures.get(binding.id);
    if (!state) {
      state = { latched: false };
      this.gestures.set(binding.id, state);
    }

    if (mode === 'scaled') {
      if (state.scaledPhysicalStart === undefined || state.scaledTargetStart === undefined) {
        state.scaledPhysicalStart = physical01;
        state.scaledTargetStart = currentTarget;
      }
      state.latched = true;
      return clamp01(state.scaledTargetStart + (physical01 - state.scaledPhysicalStart));
    }

    if (state.latched) return physical01;

    const last = state.lastPhysical;
    const closeEnough = Math.abs(physical01 - currentTarget) <= PICKUP_WINDOW;
    const crossed = last !== undefined && (last - currentTarget) * (physical01 - currentTarget) <= 0;
    state.lastPhysical = physical01;

    if (!closeEnough && !crossed) return null;
    state.latched = true;
    return physical01;
  }

  private scheduleWrite(binding: ControllerBinding, cardId: string, value01: number): void {
    this.cancelWrite(binding.id);
    this.pendingWrites.set(binding.id, { binding: { ...binding }, cardId, value01 });
    this.writeTimers.set(binding.id, setTimeout(() => this.commitWrite(binding.id), WRITE_SETTLE_MS));
  }

  private cancelWrite(bindingId: string): void {
    const timer = this.writeTimers.get(bindingId);
    if (timer) clearTimeout(timer);
    this.writeTimers.delete(bindingId);
    this.pendingWrites.delete(bindingId);
  }

  private commitWrite(bindingId: string): void {
    this.writeTimers.delete(bindingId);
    const pending = this.pendingWrites.get(bindingId);
    if (!pending) return;
    this.pendingWrites.delete(bindingId);

    const { binding, cardId, value01 } = pending;
    const inspector = useInspectorStore.getState();

    // Write mode is intentionally conservative: commit through the same
    // Inspector setters as a mouse gesture, preserving existing persistence,
    // dirty-state and base-param rules. If focus moved, keep the live override
    // rather than writing stale data into a different card.
    if (inspector.itemId !== cardId) return;

    if (binding.target.domain === 'parameter') {
      const prepared = this.parameterValue(binding.target, cardId, value01);
      if (!prepared) return;
      inspector.setParam(binding.target.controlId, prepared.value);
      getControllerPresentationRegistry().clearParameter(cardId, binding.target.controlId);
    } else if (binding.target.domain === 'effect') {
      const prepared = this.effectValue(binding.target, cardId, value01);
      if (!prepared) return;
      if (binding.target.controlId === 'mix' && typeof prepared.value === 'number') {
        inspector.setEffectMix(binding.target.effectInstanceId, prepared.value);
      } else {
        inspector.setEffectParam(binding.target.effectInstanceId, binding.target.controlId, prepared.value);
      }
      getControllerPresentationRegistry().clearEffect(
        cardId,
        binding.target.effectInstanceId,
        binding.target.controlId,
      );
    } else {
      return;
    }

    // The persisted Inspector value is now the base truth; release the
    // temporary live override so subsequent rendering comes from that same
    // canonical state. Reset takeover too so the next physical gesture starts
    // from the freshly committed value.
    this.cancelSlew(binding.id);
    this.lastApplied.delete(binding.id);
    this.inner.clearBinding(binding.id);
    this.gestures.delete(binding.id);
  }

  private readTargetUnit(binding: ControllerBinding): number | null {
    if (binding.target.domain === 'action') return null;
    const cardId = resolveTargetCardId(binding.target, useBoardStore.getState().selectedId);
    if (!cardId) return null;

    return binding.target.domain === 'parameter'
      ? this.parameterUnit(binding.target, cardId)
      : this.effectUnit(binding.target, cardId);
  }

  private parameterUnit(target: ParameterTargetRef, cardId: string): number | null {
    const renderer = getPool().get(cardId);
    const schema = renderer?.getControlSchema();
    const control = schema?.controls.find((candidate) => candidate.id === target.controlId);
    if (!schema || !control) return null;

    const inspector = useInspectorStore.getState();
    let value: ParamValue | undefined;
    if (inspector.itemId === cardId) value = inspector.params[target.controlId];
    if (value === undefined) {
      const asset = useBoardStore.getState().assets.find((candidate) => candidate.itemId === cardId);
      value = asset ? hydrate(schema, asset.params)[target.controlId] : control.default;
    }
    return mapControlValueToUnit(control, value);
  }

  private effectUnit(target: EffectTargetRef, cardId: string): number | null {
    const inspector = useInspectorStore.getState();
    const effects = inspector.itemId === cardId
      ? inspector.effects
      : useBoardStore.getState().assets.find((candidate) => candidate.itemId === cardId)?.effects ?? [];
    const instance = effects.find((candidate) => candidate.id === target.effectInstanceId);
    if (!instance) return null;

    const control = getEffectSchema(instance.effectType)?.controls.find((candidate) => candidate.id === target.controlId);
    if (!control) return null;
    const value = target.controlId === 'mix' ? instance.mix : instance.params[target.controlId];
    return mapControlValueToUnit(control, value);
  }

  private parameterValue(target: ParameterTargetRef, cardId: string, value01: number) {
    const renderer = getPool().get(cardId);
    const control = renderer?.getControlSchema()?.controls.find((candidate) => candidate.id === target.controlId);
    if (!control) return null;
    const value = mapUnitToControl(control, value01);
    return value === null ? null : { control, value };
  }

  private effectValue(target: EffectTargetRef, cardId: string, value01: number) {
    const inspector = useInspectorStore.getState();
    const effects = inspector.itemId === cardId
      ? inspector.effects
      : useBoardStore.getState().assets.find((candidate) => candidate.itemId === cardId)?.effects ?? [];
    const instance = effects.find((candidate) => candidate.id === target.effectInstanceId);
    if (!instance) return null;
    const control = getEffectSchema(instance.effectType)?.controls.find((candidate) => candidate.id === target.controlId);
    if (!control) return null;
    const value = mapUnitToControl(control, value01);
    return value === null ? null : { control, value };
  }
}

function mapControlValueToUnit(control: Control, value: ParamValue | undefined): number | null {
  switch (control.kind) {
    case 'slider':
    case 'stepper': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      if (control.kind === 'slider' && control.scale === 'log' && control.min > 0 && control.max > control.min && value > 0) {
        const span = Math.log(control.max / control.min);
        return span > 0 ? clamp01(Math.log(value / control.min) / span) : 0;
      }
      const span = control.max - control.min;
      return span > 0 ? clamp01((value - control.min) / span) : 0;
    }
    case 'toggle':
      return value === true ? 1 : 0;
    case 'select': {
      const index = control.options.findIndex((option) => option.value === String(value));
      if (index < 0 || control.options.length <= 1) return index === 0 ? 0 : null;
      return index / (control.options.length - 1);
    }
    default:
      return null;
  }
}

let directRuntime: DirectControlRuntime | null = null;

export function getDirectControlRuntime(): DirectControlRuntime {
  if (!directRuntime) directRuntime = new DirectControlRuntime();
  return directRuntime;
}
