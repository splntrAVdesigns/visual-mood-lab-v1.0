import { applyResponseCurve, clamp01, sanitizeSignal, signalToUnit } from './normalize';
import { ControllerSourceRegistry, getControllerSourceRegistry } from './source-registry';
import type {
  ControllerBinding,
  ControllerDispatchOutcome,
  ControlSignal,
  ControlSurfaceRuntimeAdapter,
} from './types';

export interface BindingDispatchRecord {
  bindingId: string;
  path: ControllerBinding['path'];
  outcome: ControllerDispatchOutcome;
}

/**
 * Transport-independent binding engine. A failing mapping is contained to
 * that mapping; one malformed controller event must never escape into the
 * renderer loop or block sibling fan-out targets.
 */
export class ControlSurfaceBindingEngine {
  private bindings = new Map<string, ControllerBinding>();
  private byVirtualControl = new Map<string, Set<string>>();
  private position = new Map<string, number>();
  private smoothed = new Map<string, number>();
  private gateState = new Map<string, boolean>();

  constructor(
    private runtime: ControlSurfaceRuntimeAdapter,
    readonly sources: ControllerSourceRegistry = getControllerSourceRegistry(),
  ) {}

  setBindings(bindings: ControllerBinding[]): void {
    const nextIds = new Set(bindings.map((binding) => binding.id));
    for (const existing of this.bindings.keys()) {
      if (!nextIds.has(existing)) this.removeBinding(existing);
    }
    for (const binding of bindings) this.upsertBinding(binding);
  }

  upsertBinding(binding: ControllerBinding): void {
    const previous = this.bindings.get(binding.id);
    if (previous && previous.virtualControlId !== binding.virtualControlId) {
      this.byVirtualControl.get(previous.virtualControlId)?.delete(binding.id);
    }

    this.bindings.set(binding.id, { ...binding });
    let bucket = this.byVirtualControl.get(binding.virtualControlId);
    if (!bucket) {
      bucket = new Set();
      this.byVirtualControl.set(binding.virtualControlId, bucket);
    }
    bucket.add(binding.id);
  }

  removeBinding(bindingId: string): void {
    const previous = this.bindings.get(bindingId);
    if (!previous) return;
    this.bindings.delete(bindingId);
    const bucket = this.byVirtualControl.get(previous.virtualControlId);
    bucket?.delete(bindingId);
    if (bucket?.size === 0) this.byVirtualControl.delete(previous.virtualControlId);
    this.position.delete(bindingId);
    this.smoothed.delete(bindingId);
    this.gateState.delete(bindingId);
    this.runtime.clearBinding(bindingId);
  }

  dispatch(virtualControlId: string, incoming: ControlSignal): BindingDispatchRecord[] {
    const signal = sanitizeSignal(incoming);
    this.sources.publish(virtualControlId, signal);

    const ids = this.byVirtualControl.get(virtualControlId);
    if (!ids?.size) return [];

    const records: BindingDispatchRecord[] = [];
    for (const bindingId of ids) {
      const binding = this.bindings.get(bindingId);
      if (!binding || binding.enabled === false) continue;

      try {
        records.push({
          bindingId,
          path: binding.path,
          outcome: this.dispatchBinding(binding, signal),
        });
      } catch (error) {
        records.push({
          bindingId,
          path: binding.path,
          outcome: {
            status: 'error',
            detail: error instanceof Error ? error.message : 'Controller binding failed.',
          },
        });
      }
    }
    return records;
  }

  private dispatchBinding(binding: ControllerBinding, signal: ControlSignal): ControllerDispatchOutcome {
    if (binding.path === 'action') {
      if (!this.shouldDispatchAction(binding, signal)) {
        return { status: 'ignored', detail: 'Action edge not active.' };
      }
      return this.runtime.dispatchAction(binding, signal);
    }

    const previous = this.position.get(binding.id) ?? 0.5;
    let value01 = signalToUnit(signal, previous);
    if (binding.invert) value01 = 1 - value01;
    value01 = applyResponseCurve(value01, binding.curve);

    const smoothing = clamp01(binding.smoothing ?? 0);
    if (smoothing > 0) {
      const prevSmoothed = this.smoothed.get(binding.id) ?? value01;
      value01 = prevSmoothed + (value01 - prevSmoothed) * (1 - smoothing);
      this.smoothed.set(binding.id, value01);
    } else {
      this.smoothed.delete(binding.id);
    }

    value01 = clamp01(value01);
    this.position.set(binding.id, value01);

    return binding.path === 'direct'
      ? this.runtime.applyDirect(binding, value01, signal)
      : this.runtime.applyModulation(binding, value01, signal);
  }

  private shouldDispatchAction(binding: ControllerBinding, signal: ControlSignal): boolean {
    const mode = binding.actionMode ?? 'trigger';

    if (signal.kind === 'trigger') return true;

    const pressed = signal.kind === 'gate'
      ? signal.pressed
      : signal.kind === 'absolute'
        ? signal.value >= 0.5
        : signal.kind === 'bipolar'
          ? signal.value >= 0
          : false;

    if (signal.kind === 'relative') return signal.delta !== 0;
    if (mode === 'momentary') return true;

    const wasPressed = this.gateState.get(binding.id) ?? false;
    this.gateState.set(binding.id, pressed);
    return pressed && !wasPressed;
  }

  panic(): void {
    this.runtime.panic();
    this.sources.reset();
    this.position.clear();
    this.smoothed.clear();
    this.gateState.clear();
  }
}
