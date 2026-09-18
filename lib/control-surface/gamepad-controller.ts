import { ControlSurfaceBindingEngine } from './binding-engine';
import { configureControllerModulationBindings } from './controller-modulation';
import { getDirectControlRuntime } from './direct-control';
import { GamepadRuntime } from './gamepad-runtime';
import { loadControlSurfaceDocument } from './persistence';
import {
  controllersAreActive,
  registerControllerSessionParticipant,
} from './session';

let gamepadRuntime: GamepadRuntime | null = null;
let bindingEngine: ControlSurfaceBindingEngine | null = null;
let persistenceWarnings: string[] = [];
let unregisterSessionParticipant: (() => void) | null = null;
let resumeAfterSessionEnable = false;

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

    unregisterSessionParticipant?.();
    unregisterSessionParticipant = registerControllerSessionParticipant('gamepad', {
      reset: () => gamepadRuntime?.panic(),
      suspend: () => {
        resumeAfterSessionEnable = Boolean(gamepadRuntime?.active);
        gamepadRuntime?.panic();
        gamepadRuntime?.disable();
      },
      resume: () => {
        if (resumeAfterSessionEnable) gamepadRuntime?.enable();
        resumeAfterSessionEnable = false;
      },
    });
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
  const runtime = getGamepadControlSurface();
  return controllersAreActive() ? runtime.enable() : runtime.snapshot();
}

export function disposeGamepadControlSurface(): void {
  unregisterSessionParticipant?.();
  unregisterSessionParticipant = null;
  gamepadRuntime?.dispose();
  gamepadRuntime = null;
  bindingEngine = null;
  persistenceWarnings = [];
  resumeAfterSessionEnable = false;
}
