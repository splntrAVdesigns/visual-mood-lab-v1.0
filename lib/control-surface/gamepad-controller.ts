import { ControlSurfaceBindingEngine } from './binding-engine';
import { configureControllerModulationBindings } from './controller-modulation';
import { getDirectControlRuntime } from './direct-control';
import { GamepadRuntime } from './gamepad-runtime';
import { loadControlSurfaceDocument } from './persistence';

let gamepadRuntime: GamepadRuntime | null = null;
let bindingEngine: ControlSurfaceBindingEngine | null = null;
let persistenceWarnings: string[] = [];

/** Lazy Gamepad API host. Importing it never starts polling. */
export function getGamepadControlSurface(): GamepadRuntime {
  if (!bindingEngine) bindingEngine = new ControlSurfaceBindingEngine(getDirectControlRuntime());
  if (!gamepadRuntime) {
    gamepadRuntime = new GamepadRuntime(bindingEngine);
    const loaded = loadControlSurfaceDocument();
    persistenceWarnings = loaded.warnings;
    gamepadRuntime.configure(loaded.document);
    configureControllerModulationBindings(
      loaded.document.mappings.flatMap((mapping) => mapping.bindings),
    );
  }
  return gamepadRuntime;
}

export function reloadGamepadControlSurfaceConfiguration(): string[] {
  const runtime = getGamepadControlSurface();
  const loaded = loadControlSurfaceDocument();
  persistenceWarnings = loaded.warnings;
  runtime.configure(loaded.document);
  configureControllerModulationBindings(
    loaded.document.mappings.flatMap((mapping) => mapping.bindings),
  );
  return [...persistenceWarnings];
}

export function getGamepadControlSurfaceWarnings(): string[] {
  return [...persistenceWarnings];
}

export function enableGamepadControlSurface() {
  return getGamepadControlSurface().enable();
}

export function disposeGamepadControlSurface(): void {
  gamepadRuntime?.dispose();
  gamepadRuntime = null;
  bindingEngine = null;
  persistenceWarnings = [];
}
