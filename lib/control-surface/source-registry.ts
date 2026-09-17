import { sanitizeSignal, signalToUnit } from './normalize';
import type { ControlSignal } from './types';

type SourceListener = (virtualControlId: string, signal: ControlSignal, value01: number) => void;

interface SourceEntry {
  signal: ControlSignal;
  value01: number;
  updatedAt: number;
}

/**
 * Shared controller-source registry. Phase 4.97D will bridge these virtual
 * sources into the existing modulation bus; Phase 4.97A keeps the registry
 * transport-agnostic and testable first.
 */
export class ControllerSourceRegistry {
  private values = new Map<string, SourceEntry>();
  private listeners = new Set<SourceListener>();

  publish(virtualControlId: string, incoming: ControlSignal): number {
    const signal = sanitizeSignal(incoming);
    const previous = this.values.get(virtualControlId)?.value01 ?? 0.5;
    const value01 = signalToUnit(signal, previous);
    this.values.set(virtualControlId, {
      signal,
      value01,
      updatedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    });
    for (const listener of this.listeners) listener(virtualControlId, signal, value01);
    return value01;
  }

  sample(virtualControlId: string): number {
    return this.values.get(virtualControlId)?.value01 ?? 0.5;
  }

  get(virtualControlId: string): Readonly<SourceEntry> | null {
    return this.values.get(virtualControlId) ?? null;
  }

  subscribe(listener: SourceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.values.clear();
  }
}

let sharedRegistry: ControllerSourceRegistry | null = null;

export function getControllerSourceRegistry(): ControllerSourceRegistry {
  if (!sharedRegistry) sharedRegistry = new ControllerSourceRegistry();
  return sharedRegistry;
}
