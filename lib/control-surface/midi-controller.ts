import { ControlSurfaceBindingEngine } from './binding-engine';
import { loadControlSurfaceDocument } from './persistence';
import { getDirectControlRuntime } from './direct-control';
import { MidiRuntime } from './midi-runtime';

/**
 * Lazy browser integration for Phase 4.97B/4.97C. Merely importing the module
 * never requests MIDI permission. UI code can call getMidiControlSurface(),
 * inspect diagnostics, and invoke requestAccess() from an explicit user
 * gesture.
 *
 * 4.97C routes the binding engine through DirectControlRuntime, which decorates
 * the 4.97A live override adapter with pickup/jump/scaled takeover plus settled
 * Write-mode commits. Transport parsing remains completely separate.
 */
let midiRuntime: MidiRuntime | null = null;
let bindingEngine: ControlSurfaceBindingEngine | null = null;
let persistenceWarnings: string[] = [];

export function getMidiControlSurface(): MidiRuntime {
  if (!bindingEngine) {
    bindingEngine = new ControlSurfaceBindingEngine(getDirectControlRuntime());
  }
  if (!midiRuntime) {
    midiRuntime = new MidiRuntime({ engine: bindingEngine });
    const loaded = loadControlSurfaceDocument();
    persistenceWarnings = loaded.warnings;
    midiRuntime.configure(loaded.document);
  }
  return midiRuntime;
}

/** Re-read local mapping/profile state after Learn, Settings or import/export changes. */
export function reloadMidiControlSurfaceConfiguration(): string[] {
  const runtime = getMidiControlSurface();
  const loaded = loadControlSurfaceDocument();
  persistenceWarnings = loaded.warnings;
  runtime.configure(loaded.document);
  return [...persistenceWarnings];
}

export function getMidiControlSurfaceWarnings(): string[] {
  return [...persistenceWarnings];
}

/** Explicit user-gesture helper — never called automatically. */
export async function requestMidiControlSurfaceAccess() {
  return getMidiControlSurface().requestAccess();
}

/** Useful for hot-reload/dev teardown and future account/session switches. */
export function disposeMidiControlSurface(): void {
  midiRuntime?.dispose();
  midiRuntime = null;
  bindingEngine = null;
  persistenceWarnings = [];
}
