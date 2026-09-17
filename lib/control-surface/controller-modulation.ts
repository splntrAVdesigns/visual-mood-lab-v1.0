import { getEffectSchema } from '@/lib/effects/registry';
import type { EffectInstance } from '@/lib/effects/types';
import { getPool } from '@/lib/render/pool';
import {
  applyModulation,
  hydrate,
  type Control,
  type Modulation,
  type ParamValue,
} from '@/renderers/control-schema';
import { useBoardStore } from '@/stores/boardStore';
import { useInspectorStore } from '@/stores/inspectorStore';
import { applyResponseCurve, clamp01 } from './normalize';
import { getControllerPresentationRegistry } from './presentation';
import { getControllerSourceRegistry } from './source-registry';
import { resolveTargetCardId } from './targets';
import type { ControllerBinding, ControllerDispatchOutcome } from './types';

interface BridgeEntry {
  binding: ControllerBinding;
  value01: number;
  sequence: number;
}

interface ParameterTarget {
  cardId: string;
  controlId: string;
}

interface EffectTarget {
  cardId: string;
  effectInstanceId: string;
  controlId: string;
}

/** Controller modulation stays outside persisted Inspector state. */
export class ControllerModulationBridge {
  private entries = new Map<string, BridgeEntry>();
  private sequence = 0;
  private previousParameterTargets = new Map<string, ParameterTarget>();
  private previousEffectCards = new Set<string>();
  private unsubscribeBoard: (() => void) | null = null;
  private unsubscribeInspector: (() => void) | null = null;

  constructor() {
    this.unsubscribeBoard = useBoardStore.subscribe((state, previous) => {
      if (state.selectedId !== previous.selectedId || state.assets !== previous.assets) this.reconcile();
    });
    this.unsubscribeInspector = useInspectorStore.subscribe((state, previous) => {
      if (state.itemId !== previous.itemId || state.params !== previous.params || state.effects !== previous.effects) {
        this.reconcile();
      }
    });
  }

  configure(bindings: ControllerBinding[]): void {
    const next = new Map<string, BridgeEntry>();
    for (const binding of bindings) {
      if (binding.path !== 'modulation' || binding.enabled === false || binding.target.domain === 'action') continue;
      next.set(binding.id, {
        binding: cloneBinding(binding),
        value01: initialBindingValue(binding),
        sequence: this.entries.get(binding.id)?.sequence ?? ++this.sequence,
      });
    }
    this.entries = next;
    this.reconcile();
  }

  update(binding: ControllerBinding, value01: number): ControllerDispatchOutcome {
    if (binding.target.domain === 'action') {
      return { status: 'ignored', detail: 'Action targets cannot use the Modulation path.' };
    }
    const cardId = resolveTargetCardId(binding.target, useBoardStore.getState().selectedId);
    if (!cardId) return { status: 'unavailable', detail: 'No tile resolved for controller modulation target.' };

    const previous = this.entries.get(binding.id);
    this.entries.set(binding.id, {
      binding: cloneBinding(binding),
      value01: clamp01(value01),
      sequence: previous?.sequence ?? ++this.sequence,
    });
    this.reconcile();
    return { status: 'applied' };
  }

  remove(bindingId: string): void {
    if (!this.entries.delete(bindingId)) return;
    this.reconcile();
  }

  panic(): void {
    for (const entry of this.entries.values()) entry.value01 = 0.5;
    this.reconcile();
  }

  value(bindingId: string): number | null {
    return this.entries.get(bindingId)?.value01 ?? null;
  }

  dispose(): void {
    this.entries.clear();
    this.reconcile();
    this.unsubscribeBoard?.();
    this.unsubscribeInspector?.();
    this.unsubscribeBoard = null;
    this.unsubscribeInspector = null;
  }

  private reconcile(): void {
    const focusedCardId = useBoardStore.getState().selectedId;
    const parameterGroups = new Map<string, { target: ParameterTarget; entries: BridgeEntry[] }>();
    const effectGroups = new Map<string, { target: EffectTarget; entries: BridgeEntry[] }>();

    for (const entry of this.entries.values()) {
      const { binding } = entry;
      if (binding.enabled === false || binding.path !== 'modulation') continue;
      const cardId = resolveTargetCardId(binding.target, focusedCardId);
      if (!cardId) continue;

      if (binding.target.domain === 'parameter') {
        const target: ParameterTarget = { cardId, controlId: binding.target.controlId };
        const key = parameterTargetKey(target);
        const group = parameterGroups.get(key) ?? { target, entries: [] };
        group.entries.push(entry);
        parameterGroups.set(key, group);
      } else if (binding.target.domain === 'effect') {
        const target: EffectTarget = {
          cardId,
          effectInstanceId: binding.target.effectInstanceId,
          controlId: binding.target.controlId,
        };
        const key = effectTargetKey(target);
        const group = effectGroups.get(key) ?? { target, entries: [] };
        group.entries.push(entry);
        effectGroups.set(key, group);
      }
    }

    const parameterTargets = new Map(this.previousParameterTargets);
    for (const [key, group] of parameterGroups) parameterTargets.set(key, group.target);
    for (const [key, target] of parameterTargets) {
      this.renderParameterTarget(target, parameterGroups.get(key)?.entries ?? []);
    }

    const effectCards = new Set(this.previousEffectCards);
    for (const group of effectGroups.values()) effectCards.add(group.target.cardId);
    for (const cardId of effectCards) {
      const groups = [...effectGroups.values()].filter((group) => group.target.cardId === cardId);
      this.renderEffectCard(cardId, groups);
    }

    this.previousParameterTargets = new Map([...parameterGroups.entries()].map(([key, group]) => [key, group.target]));
    this.previousEffectCards = new Set([...effectGroups.values()].map((group) => group.target.cardId));
  }

  private renderParameterTarget(target: ParameterTarget, entries: BridgeEntry[]): void {
    const renderer = getPool().get(target.cardId);
    const schema = renderer?.getControlSchema();
    const control = schema?.controls.find((candidate) => candidate.id === target.controlId);
    if (!renderer || !schema || !control) return;
    if (control.kind !== 'slider' && control.kind !== 'stepper') return;

    const base = canonicalParameterValue(target.cardId, control.id);
    if (typeof base !== 'number' || !Number.isFinite(base)) return;

    let next: ParamValue = base;
    for (const entry of [...entries].sort((a, b) => a.sequence - b.sequence)) {
      next = applyControllerModulation(control, next, entry);
    }

    getPool().setBaseParam(target.cardId, target.controlId, next);
    renderer.setParam(target.controlId, next);
    if (entries.length > 0) {
      getControllerPresentationRegistry().setParameter(target.cardId, target.controlId, next);
    } else {
      getControllerPresentationRegistry().clearParameter(target.cardId, target.controlId);
    }
  }

  private renderEffectCard(
    cardId: string,
    groups: Array<{ target: EffectTarget; entries: BridgeEntry[] }>,
  ): void {
    const effects = canonicalEffects(cardId).map(cloneEffect);
    if (effects.length === 0) {
      getPool().setEffects(cardId, effects);
      return;
    }

    for (const group of groups) {
      const instance = effects.find((effect) => effect.id === group.target.effectInstanceId);
      if (!instance) continue;
      const control = getEffectSchema(instance.effectType)?.controls.find((candidate) => candidate.id === group.target.controlId);
      if (!control || (control.kind !== 'slider' && control.kind !== 'stepper')) continue;

      let next: ParamValue = group.target.controlId === 'mix' ? instance.mix : instance.params[group.target.controlId];
      if (typeof next !== 'number') continue;
      for (const entry of [...group.entries].sort((a, b) => a.sequence - b.sequence)) {
        next = applyControllerModulation(control, next, entry);
      }
      if (typeof next !== 'number') continue;
      if (group.target.controlId === 'mix') instance.mix = next;
      else instance.params[group.target.controlId] = next;
      getControllerPresentationRegistry().setEffect(cardId, group.target.effectInstanceId, group.target.controlId, next);
    }

    getPool().setEffects(cardId, effects);
  }
}

function applyControllerModulation(control: Control, base: ParamValue, entry: BridgeEntry): ParamValue {
  const synthetic: Modulation = {
    source: 'midi.cc',
    amount: clampAmount(entry.binding.amount ?? 0.3),
    smoothing: 0,
  };
  return applyModulation(control, base, synthetic, clamp01(entry.value01));
}

function canonicalParameterValue(cardId: string, controlId: string): ParamValue | undefined {
  const renderer = getPool().get(cardId);
  const schema = renderer?.getControlSchema();
  if (!schema) return undefined;
  const inspector = useInspectorStore.getState();
  if (inspector.itemId === cardId && inspector.params[controlId] !== undefined) return inspector.params[controlId];
  const asset = useBoardStore.getState().assets.find((candidate) => candidate.itemId === cardId);
  return asset ? hydrate(schema, asset.params)[controlId] : undefined;
}

function canonicalEffects(cardId: string): EffectInstance[] {
  const inspector = useInspectorStore.getState();
  const source = inspector.itemId === cardId
    ? inspector.effects
    : useBoardStore.getState().assets.find((candidate) => candidate.itemId === cardId)?.effects ?? [];
  return source.map(cloneEffect);
}

function initialBindingValue(binding: ControllerBinding): number {
  let value = getControllerSourceRegistry().sample(binding.virtualControlId);
  if (binding.invert) value = 1 - value;
  return applyResponseCurve(clamp01(value), binding.curve);
}

function cloneBinding(binding: ControllerBinding): ControllerBinding {
  return { ...binding, target: { ...binding.target } } as ControllerBinding;
}

function cloneEffect(effect: EffectInstance): EffectInstance {
  return { ...effect, params: { ...effect.params }, mod: { ...effect.mod } };
}

function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return 0.3;
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

function parameterTargetKey(target: ParameterTarget): string {
  return `${target.cardId}:parameter:${target.controlId}`;
}

function effectTargetKey(target: EffectTarget): string {
  return `${target.cardId}:effect:${target.effectInstanceId}:${target.controlId}`;
}

let bridge: ControllerModulationBridge | null = null;

export function getControllerModulationBridge(): ControllerModulationBridge {
  if (!bridge) bridge = new ControllerModulationBridge();
  return bridge;
}

export function configureControllerModulationBindings(bindings: ControllerBinding[]): void {
  getControllerModulationBridge().configure(bindings);
}

export function disposeControllerModulationBridge(): void {
  bridge?.dispose();
  bridge = null;
}
