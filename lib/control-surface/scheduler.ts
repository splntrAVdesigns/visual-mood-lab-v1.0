import type { ControlSignal } from './types';

/**
 * Dedicated fault-contained rAF scheduler for polled transports (Gamepad).
 * It is intentionally independent from lib/render/pool.ts's shared renderer
 * tick, so controller failures cannot stall visual rendering.
 */
export class PolledTransportScheduler {
  private rafId: number | null = null;
  private running = false;
  private warned = false;

  start(poll: (now: number) => void): void {
    if (this.running || typeof requestAnimationFrame === 'undefined') return;
    this.running = true;

    const tick = (now: number) => {
      if (!this.running) return;
      try {
        poll(now);
        this.warned = false;
      } catch (error) {
        // Contain transport faults. Avoid a 60fps console flood if one device
        // stays broken; a successful poll arms logging again for a later fault.
        if (!this.warned) {
          this.warned = true;
          console.error('[ControlSurface] polled transport failed', error);
        }
      } finally {
        if (this.running) this.rafId = requestAnimationFrame(tick);
      }
    };

    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this.warned = false;
  }

  get active(): boolean {
    return this.running;
  }
}

interface QueuedSignal {
  virtualControlId: string;
  signal: ControlSignal;
}

/**
 * Frame-align high-rate continuous input without losing meaningful edges:
 * absolute/bipolar keep the latest value, relative deltas accumulate, and
 * gate/trigger events preserve arrival order.
 */
export class FrameSignalQueue {
  private continuous = new Map<string, QueuedSignal>();
  private relative = new Map<string, number>();
  private discrete: QueuedSignal[] = [];
  private rafId: number | null = null;

  constructor(private dispatch: (virtualControlId: string, signal: ControlSignal) => void) {}

  enqueue(virtualControlId: string, signal: ControlSignal): void {
    if (signal.kind === 'absolute' || signal.kind === 'bipolar') {
      this.continuous.set(virtualControlId, { virtualControlId, signal });
    } else if (signal.kind === 'relative') {
      this.relative.set(virtualControlId, (this.relative.get(virtualControlId) ?? 0) + signal.delta);
    } else {
      this.discrete.push({ virtualControlId, signal });
    }
    this.schedule();
  }

  flush(): void {
    this.rafId = null;

    const discrete = this.discrete.splice(0);
    for (const item of discrete) this.safeDispatch(item.virtualControlId, item.signal);

    for (const [virtualControlId, delta] of this.relative) {
      this.safeDispatch(virtualControlId, { kind: 'relative', delta });
    }
    this.relative.clear();

    const continuous = [...this.continuous.values()];
    this.continuous.clear();
    for (const item of continuous) this.safeDispatch(item.virtualControlId, item.signal);
  }

  clear(): void {
    this.continuous.clear();
    this.relative.clear();
    this.discrete = [];
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  }

  private schedule(): void {
    if (this.rafId !== null) return;
    if (typeof requestAnimationFrame === 'undefined') return;
    this.rafId = requestAnimationFrame(() => this.flush());
  }

  private safeDispatch(virtualControlId: string, signal: ControlSignal): void {
    try {
      this.dispatch(virtualControlId, signal);
    } catch (error) {
      console.error('[ControlSurface] queued controller dispatch failed', error);
    }
  }
}
