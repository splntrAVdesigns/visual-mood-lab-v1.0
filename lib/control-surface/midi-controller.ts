import { ControlSurfaceBindingEngine } from './binding-engine';
import { loadControlSurfaceDocument } from './persistence';
import { getLiveControlSurfaceRuntime } from './runtime';
import { MidiRuntime } from './midi-runtime';

/**
 * Lazy browser integration for Phase 4.97B. Merely importing the module never
 * requests MIDI permission. UI code can call getMidiControlSurface(), inspect
 * diagnostics, and invoke requestAccess() from an explicit user gesture.
 */
let midiRuntime: MidiRuntime | null = null;
let bindingEngine: ControlSurfaceBindingEngine | null = null;
let persistenceWarnings: string[] = [];

export function getMidiControlSurface(): MidiRuntime {
  if (!bindingEngine) {
    bindingEngine = new ControlSurfaceBindingEngine(getLiveControlSurfaceRuntime());
  }
  if (!midiRuntime) {
    midiRuntime = new MidiRuntime({ engine: bindingEngine });
    const loaded = loadControlSurfaceDocument();
    persistenceWarnings = loaded.warnings;
    midiRuntime.configure(loaded.document);
  }
  return midiRuntime;
}

/** Re-read local mapping/profile state after Settings or import/export changes. */
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
