import { ControlSurfaceBindingEngine } from './binding-engine';
import { loadControlSurfaceDocument } from './persistence';
import { getDirectControlRuntime } from './direct-control';
import { MidiRuntime } from './midi-runtime';
import {
  configureControllerModulationBindings,
  disposeControllerModulationBridge,
} from './controller-modulation';
import { registerControllerSessionParticipant } from './session';

/**
 * Lazy browser integration. Importing this module never requests MIDI access.
 */
let midiRuntime: MidiRuntime | null = null;
let bindingEngine: ControlSurfaceBindingEngine | null = null;
let persistenceWarnings: string[] = [];
let unregisterSessionParticipant: (() => void) | null = null;

export function getMidiControlSurface(): MidiRuntime {
  if (!bindingEngine) {
    bindingEngine = new ControlSurfaceBindingEngine(getDirectControlRuntime());
  }
  if (!midiRuntime) {
    midiRuntime = new MidiRuntime({ engine: bindingEngine });
    const loaded = loadControlSurfaceDocument();
    persistenceWarnings = loaded.warnings;
    midiRuntime.configure(loaded.document);
    configureControllerModulationBindings(
      loaded.document.mappings.flatMap((mapping) => mapping.bindings),
    );

    unregisterSessionParticipant?.();
    unregisterSessionParticipant = registerControllerSessionParticipant('midi', {
      reset: () => midiRuntime?.panic(),
    });
  }
  return midiRuntime;
}

/** Re-read local mapping/profile state after Learn, Settings or import/export changes. */
export function reloadMidiControlSurfaceConfiguration(): string[] {
  const runtime = getMidiControlSurface();
  const loaded = loadControlSurfaceDocument();
  persistenceWarnings = loaded.warnings;
  runtime.configure(loaded.document);
  configureControllerModulationBindings(
    loaded.document.mappings.flatMap((mapping) => mapping.bindings),
  );
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
  unregisterSessionParticipant?.();
  unregisterSessionParticipant = null;
  midiRuntime?.dispose();
  disposeControllerModulationBridge();
  midiRuntime = null;
  bindingEngine = null;
  persistenceWarnings = [];
}
