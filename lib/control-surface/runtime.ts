import { getEffectSchema } from '@/lib/effects/registry';
import type { EffectInstance } from '@/lib/effects/types';
import { getPool } from '@/lib/render/pool';
import { hydrate, type Control, type ControlSchema, type ParamValue } from '@/renderers/control-schema';
import { useBoardStore } from '@/stores/boardStore';
import { useInspectorStore } from '@/stores/inspectorStore';
import { mapUnitToControl } from './normalize';
import { getControllerModulationBridge } from './controller-modulation';
import { resolveTargetCardId, resolvedTargetKey, validateTargetRef } from './targets';
import type {
  ControllerBinding,
  ControllerDispatchOutcome,
  ControlSignal,
  ControlSurfaceRuntimeAdapter,
  EffectTargetRef,
  ParameterTargetRef,
  TargetRef,
} from './types';

type RuntimeTarget =
  | { cardId: string; domain: 'parameter'; controlId: string }
  | { cardId: string; domain: 'effect'; effectInstanceId: string; controlId: string };

interface OverrideEntry {
  bindingId: string;
  target: RuntimeTarget;
  targetKey: string;
  value: ParamValue;
  sequence: number;
}

export interface PendingControllerWrite {
  bindingId: string;
  target: RuntimeTarget;
  value: ParamValue;
}

export interface ControllerActionContext {
  binding: ControllerBinding;
  signal: ControlSignal;
  cardId: string | null;
}

export type ControllerActionHandler = (context: ControllerActionContext) => ControllerDispatchOutcome | void;

/**
 * Live renderer adapter for Phase 4.97A.
 *
 * Runtime overrides are held here, outside persisted Inspector/Board state.
 * For asset params we temporarily update RendererPool.baseParams as the live
 * execution base: the pool's existing LFO/audio modulation therefore layers
 * on top of the controller value on the next frame without a database write.
 * Panic/clear restores the current persisted Inspector/Board base.
 *
 * Effect overrides use RendererPool.setEffects() for the same reason: the
 * pool then applies existing per-effect modulation on top of the runtime
 * chain. No Inspector setter or persistence client is called in this module.
 */
export class LiveControlSurfaceRuntime implements ControlSurfaceRuntimeAdapter {
  private overrides = new Map<string, OverrideEntry>();
  private pendingWrites = new Map<string, PendingControllerWrite>();
  private actions = new Map<string, ControllerActionHandler>();
  private sequence = 0;

  constructor() {
    this.registerAction('controller.panic', () => {
      this.panic();
      return { status: 'applied', detail: 'Controller panic completed.' };
    });

    this.registerAction('tile.trigger', ({ binding, cardId }) => {
      if (!cardId || binding.target.domain !== 'action' || !binding.target.controlId) {
        return { status: 'unavailable', detail: 'tile.trigger requires a resolved tile and controlId.' };
      }
      const renderer = getPool().get(cardId);
      const control = renderer?.getControlSchema()?.controls.find((c) => c.id === binding.target.controlId);
      if (!renderer || !control || control.kind !== 'trigger') {
        return { status: 'unavailable', detail: 'Trigger control is not available on the resolved tile.' };
      }
      renderer.emit(control.event);
      return { status: 'applied' };
    });

    this.registerAction('sound.retrigger', ({ cardId }) => {
      if (!cardId) return { status: 'unavailable', detail: 'No tile resolved for sound.retrigger.' };
      getPool().retriggerSound(cardId);
      return { status: 'applied' };
    });

    this.registerAction('tile.toggle', ({ binding, cardId }) => this.toggleTileControl(binding, cardId));
  }

  registerAction(actionId: string, handler: ControllerActionHandler): () => void {
    this.actions.set(actionId, handler);
    return () => {
      if (this.actions.get(actionId) === handler) this.actions.delete(actionId);
    };
  }

  applyDirect(
    binding: ControllerBinding,
    value01: number,
    _signal: ControlSignal,
  ): ControllerDispatchOutcome {
    const error = validateTargetRef(binding.target);
    if (error) return { status: 'error', detail: error };
    if (binding.target.domain === 'action') {
      return { status: 'ignored', detail: 'Action targets cannot use the Direct path.' };
    }

    const cardId = this.resolveCard(binding.target);
    if (!cardId) return { status: 'unavailable', detail: 'No tile resolved for controller target.' };

    const prepared = binding.target.domain === 'parameter'
      ? this.prepareParameterOverride(binding.target, cardId, value01)
      : this.prepareEffectOverride(binding.target, cardId, value01);
    if ('status' in prepared) return prepared;

    const previous = this.overrides.get(binding.id);
    if (previous && previous.targetKey !== prepared.targetKey) {
      this.overrides.delete(binding.id);
      this.renderRuntimeTarget(previous.target);
    }

    const entry: OverrideEntry = {
      bindingId: binding.id,
      target: prepared.target,
      targetKey: prepared.targetKey,
      value: prepared.value,
      sequence: ++this.sequence,
    };
    this.overrides.set(binding.id, entry);
    this.renderRuntimeTarget(entry.target);

    if ((binding.writeMode ?? 'live') === 'write') {
      this.pendingWrites.set(binding.id, {
        bindingId: binding.id,
        target: entry.target,
        value: entry.value,
      });
    } else {
      this.pendingWrites.delete(binding.id);
    }

    return {
      status: 'applied',
      detail: (binding.writeMode ?? 'live') === 'write'
        ? 'Runtime override applied; final value staged for Phase 4.97C Write commit.'
        : undefined,
    };
  }

  /**
   * Phase 4.97D — real controller modulation path. The binding engine has
   * already normalized/inverted/curved/smoothed the physical signal; the
   * bridge converts that 0..1 value into a temporary runtime base offset.
   * RendererPool's existing LFO/audio/mic modulation then layers on top.
   */
  applyModulation(
    binding: ControllerBinding,
    value01: number,
    _signal: ControlSignal,
  ): ControllerDispatchOutcome {
    const error = validateTargetRef(binding.target);
    if (error) return { status: 'error', detail: error };
    return getControllerModulationBridge().update(binding, value01);
  }

  dispatchAction(binding: ControllerBinding, signal: ControlSignal): ControllerDispatchOutcome {
    if (binding.target.domain !== 'action') {
      return { status: 'ignored', detail: 'Action path requires an action target.' };
    }
    const error = validateTargetRef(binding.target);
    if (error) return { status: 'error', detail: error };

    const handler = this.actions.get(binding.target.actionId);
    if (!handler) return { status: 'unavailable', detail: `Unknown controller action: ${binding.target.actionId}` };

    const cardId = this.resolveCard(binding.target);
    const result = handler({ binding, signal, cardId });
    return result ?? { status: 'applied' };
  }

  clearBinding(bindingId: string): void {
    const previous = this.overrides.get(bindingId);
    if (previous) {
      this.overrides.delete(bindingId);
      this.renderRuntimeTarget(previous.target);
    }
    this.pendingWrites.delete(bindingId);
    getControllerModulationBridge().remove(bindingId);
  }

  /** Deterministic neutral/base recovery for live use. */
  panic(): void {
    const targets = new Map<string, RuntimeTarget>();
    for (const entry of this.overrides.values()) targets.set(entry.targetKey, entry.target);
    this.overrides.clear();
    this.pendingWrites.clear();
    getControllerModulationBridge().panic();
    for (const target of targets.values()) this.renderRuntimeTarget(target);
  }

  getPendingWrites(): PendingControllerWrite[] {
    return [...this.pendingWrites.values()].map((entry) => ({ ...entry, target: { ...entry.target } }));
  }

  getModulationValue(bindingId: string): number | null {
    return getControllerModulationBridge().value(bindingId);
  }

  private resolveCard(target: TargetRef): string | null {
    return resolveTargetCardId(target, useBoardStore.getState().selectedId);
  }

  private prepareParameterOverride(
    target: ParameterTargetRef,
    cardId: string,
    value01: number,
  ): { target: RuntimeTarget; targetKey: string; value: ParamValue } | ControllerDispatchOutcome {
    const renderer = getPool().get(cardId);
    const schema = renderer?.getControlSchema();
    if (!renderer || !schema) return { status: 'unavailable', detail: 'Resolved tile is not live in the renderer pool.' };

    const control = schema.controls.find((candidate) => candidate.id === target.controlId);
    if (!control) return { status: 'unavailable', detail: `Control ${target.controlId} is not present on the resolved tile.` };

    const value = mapUnitToControl(control, value01);
    if (value === null) return { status: 'ignored', detail: `${control.kind} does not accept scalar Direct control.` };

    const runtimeTarget: RuntimeTarget = { cardId, domain: 'parameter', controlId: target.controlId };
    return { target: runtimeTarget, targetKey: resolvedTargetKey(target, cardId), value };
  }

  private prepareEffectOverride(
    target: EffectTargetRef,
    cardId: string,
    value01: number,
  ): { target: RuntimeTarget; targetKey: string; value: ParamValue } | ControllerDispatchOutcome {
    const base = this.baseEffects(cardId);
    const instance = base.find((effect) => effect.id === target.effectInstanceId);
    if (!instance) return { status: 'unavailable', detail: 'Effect instance is not present on the resolved tile.' };

    const schema = getEffectSchema(instance.effectType);
    const control = schema?.controls.find((candidate) => candidate.id === target.controlId);
    if (!control) return { status: 'unavailable', detail: `Effect control ${target.controlId} is unavailable.` };

    const value = mapUnitToControl(control, value01);
    if (value === null) return { status: 'ignored', detail: `${control.kind} does not accept scalar Direct control.` };

    const runtimeTarget: RuntimeTarget = {
      cardId,
      domain: 'effect',
      effectInstanceId: target.effectInstanceId,
      controlId: target.controlId,
    };
    return { target: runtimeTarget, targetKey: resolvedTargetKey(target, cardId), value };
  }

  private renderRuntimeTarget(target: RuntimeTarget): void {
    if (target.domain === 'parameter') {
      this.renderParameterTarget(target);
      return;
    }
    this.renderEffectCard(target.cardId);
  }

  private renderParameterTarget(target: Extract<RuntimeTarget, { domain: 'parameter' }>): void {
    const renderer = getPool().get(target.cardId);
    const schema = renderer?.getControlSchema();
    const control = schema?.controls.find((candidate) => candidate.id === target.controlId);
    if (!renderer || !schema || !control) return;

    const key = `${target.cardId}:parameter:${target.controlId}`;
    const winning = this.latestOverrideFor(key);
    const value = winning?.value ?? this.baseParam(target.cardId, control, schema);
    if (value === undefined) return;

    // Runtime base only — no Inspector setter, no board-store mutation, no DB.
    getPool().setBaseParam(target.cardId, target.controlId, value);
    renderer.setParam(target.controlId, value);
  }

  private renderEffectCard(cardId: string): void {
    const base = this.baseEffects(cardId).map(cloneEffect);
    if (base.length === 0) {
      getPool().setEffects(cardId, base);
      return;
    }

    const overrides = [...this.overrides.values()]
      .filter((entry) => entry.target.cardId === cardId && entry.target.domain === 'effect')
      .sort((a, b) => a.sequence - b.sequence);

    for (const override of overrides) {
      if (override.target.domain !== 'effect') continue;
      const target = override.target;
      const index = base.findIndex((effect) => effect.id === target.effectInstanceId);
      if (index < 0) continue;
      const instance = base[index]!;
      base[index] = target.controlId === 'mix'
        ? { ...instance, mix: asNumber(override.value, instance.mix) }
        : { ...instance, params: { ...instance.params, [target.controlId]: override.value } };
    }

    getPool().setEffects(cardId, base);
  }

  private latestOverrideFor(targetKey: string): OverrideEntry | null {
    let winner: OverrideEntry | null = null;
    for (const entry of this.overrides.values()) {
      if (entry.targetKey !== targetKey) continue;
      if (!winner || entry.sequence > winner.sequence) winner = entry;
    }
    return winner;
  }

  private baseParam(cardId: string, control: Control, schema: ControlSchema): ParamValue | undefined {
    const inspector = useInspectorStore.getState();
    if (inspector.itemId === cardId && inspector.params[control.id] !== undefined) {
      return inspector.params[control.id];
    }

    const asset = useBoardStore.getState().assets.find((candidate) => candidate.itemId === cardId);
    return asset ? hydrate(schema, asset.params)[control.id] : control.default;
  }

  private baseEffects(cardId: string): EffectInstance[] {
    const inspector = useInspectorStore.getState();
    const source = inspector.itemId === cardId
      ? inspector.effects
      : useBoardStore.getState().assets.find((candidate) => candidate.itemId === cardId)?.effects ?? [];
    return source.map(cloneEffect);
  }

  private toggleTileControl(binding: ControllerBinding, cardId: string | null): ControllerDispatchOutcome {
    if (!cardId || binding.target.domain !== 'action' || !binding.target.controlId) {
      return { status: 'unavailable', detail: 'tile.toggle requires a resolved tile and controlId.' };
    }

    const renderer = getPool().get(cardId);
    const schema = renderer?.getControlSchema();
    const control = schema?.controls.find((candidate) => candidate.id === binding.target.controlId);
    if (!renderer || !schema || !control || control.kind !== 'toggle') {
      return { status: 'unavailable', detail: 'Toggle control is not available on the resolved tile.' };
    }

    const runtimeTarget: RuntimeTarget = { cardId, domain: 'parameter', controlId: control.id };
    const key = `${cardId}:parameter:${control.id}`;
    const previous = this.overrides.get(binding.id);
    if (previous && previous.targetKey !== key) {
      this.overrides.delete(binding.id);
      this.renderRuntimeTarget(previous.target);
    }
    const winning = this.latestOverrideFor(key);
    const base = winning?.value ?? this.baseParam(cardId, control, schema);
    const value = !Boolean(base);
    this.overrides.set(binding.id, {
      bindingId: binding.id,
      target: runtimeTarget,
      targetKey: key,
      value,
      sequence: ++this.sequence,
    });
    this.renderParameterTarget(runtimeTarget);
    return { status: 'applied' };
  }
}

function cloneEffect(effect: EffectInstance): EffectInstance {
  return {
    ...effect,
    params: { ...effect.params },
    mod: { ...effect.mod },
  };
}

function asNumber(value: ParamValue, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

let runtime: LiveControlSurfaceRuntime | null = null;

export function getLiveControlSurfaceRuntime(): LiveControlSurfaceRuntime {
  if (!runtime) runtime = new LiveControlSurfaceRuntime();
  return runtime;
}
