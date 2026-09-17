import { getEffectSchema } from '@/lib/effects/registry';
import { getPool } from '@/lib/render/pool';
import { hydrate, type Control, type ParamValue } from '@/renderers/control-schema';
import { useBoardStore } from '@/stores/boardStore';
import { useInspectorStore } from '@/stores/inspectorStore';
import { clamp01, mapUnitToControl } from './normalize';
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

/**
 * Phase 4.97C direct-control policy layer.
 *
 * 4.97A's LiveControlSurfaceRuntime deliberately owns the low-level runtime
 * override path. This decorator adds the interaction semantics that belong to
 * a physical control: pickup/jump/scaled takeover and Write-mode settling.
 * Keeping those policies here means MIDI and the later Gamepad adapter can use
 * the exact same behavior instead of re-implementing takeover per transport.
 */
export class DirectControlRuntime implements ControlSurfaceRuntimeAdapter {
  private gestures = new Map<string, DirectGestureState>();
  private writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingWrites = new Map<string, PendingWrite>();

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

    const outcome = this.inner.applyDirect(binding, transformed, signal);
    if (outcome.status === 'applied' && (binding.writeMode ?? 'live') === 'write') {
      const cardId = resolveTargetCardId(binding.target, useBoardStore.getState().selectedId);
      if (cardId) this.scheduleWrite(binding, cardId, transformed);
    }
    return outcome;
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
    this.gestures.delete(bindingId);
    this.inner.clearBinding(bindingId);
  }

  panic(): void {
    for (const timer of this.writeTimers.values()) clearTimeout(timer);
    this.writeTimers.clear();
    this.pendingWrites.clear();
    this.gestures.clear();
    this.inner.panic();
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

    // Write mode is intentionally conservative in this first UX pass: the
    // learned control commits through the same Inspector setters as a mouse
    // gesture, preserving all existing persistence/dirty/base-param rules.
    // If the target is no longer the open Inspector tile by the time the
    // gesture settles, leave the live override in place rather than writing
    // stale data into a different card.
    if (inspector.itemId !== cardId) return;

    if (binding.target.domain === 'parameter') {
      const prepared = this.parameterValue(binding.target, cardId, value01);
      if (!prepared) return;
      inspector.setParam(binding.target.controlId, prepared.value);
    } else if (binding.target.domain === 'effect') {
      const prepared = this.effectValue(binding.target, cardId, value01);
      if (!prepared) return;
      if (binding.target.controlId === 'mix' && typeof prepared.value === 'number') {
        inspector.setEffectMix(binding.target.effectInstanceId, prepared.value);
      } else {
        inspector.setEffectParam(binding.target.effectInstanceId, binding.target.controlId, prepared.value);
      }
    } else {
      return;
    }

    // The persisted Inspector value is now the base truth; release the
    // temporary live override so subsequent rendering comes from that same
    // canonical state. Reset takeover too so the next physical gesture starts
    // from the freshly committed value.
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
