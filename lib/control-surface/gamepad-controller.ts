import { performRoll, performMutate, performUndo, performRedo } from '@/features/inspector/rollActions';
import { useInspectorStore } from '@/stores/inspectorStore';
import { ControlSurfaceBindingEngine } from './binding-engine';
import { configureControllerModulationBindings } from './controller-modulation';
import { getDirectControlRuntime } from './direct-control';
import { GamepadRuntime } from './gamepad-runtime';
import { loadControlSurfaceDocument } from './persistence';
import {
  controllersAreActive,
  registerControllerSessionParticipant,
} from './session';

let unsubscribeInspector: (() => void) | null = null;
let removeLifecycle: (() => void) | null = null;
let contextVersion = 0;
export const GAMEPAD_PANEL_EVENT = 'vml:gamepad-panel';

let gamepadRuntime: GamepadRuntime | null = null;
let bindingEngine: ControlSurfaceBindingEngine | null = null;
let persistenceWarnings: string[] = [];
let unregisterSessionParticipant: (() => void) | null = null;
let resumeAfterSessionEnable = false;

/** Lazy Gamepad API host. Importing it never starts polling. */
export function getGamepadControlSurface(): GamepadRuntime {
  if (!bindingEngine) bindingEngine = new ControlSurfaceBindingEngine(getDirectControlRuntime());
  if (!gamepadRuntime) {
    gamepadRuntime = new GamepadRuntime(bindingEngine, {
      context: () => contextVersion,
      onAction: (action) => {
        const inspector = useInspectorStore.getState();
        if (!inspector.open || !inspector.itemId) return;
        if (action === 'panel') { window.dispatchEvent(new Event(GAMEPAD_PANEL_EVENT)); return; }
        gamepadRuntime?.stopGestures();
        getDirectControlRuntime().clearGamepadOverrides(inspector.itemId);
        if (action === 'roll') performRoll();
        if (action === 'mutate') performMutate();
        if (action === 'undo') performUndo();
        if (action === 'redo') performRedo();
      },
    });
    unsubscribeInspector = useInspectorStore.subscribe((next, before) => {
      const direct = getDirectControlRuntime();
      if (direct.isCommitting) return;
      if (next.itemId !== before.itemId || next.open !== before.open || next.schema !== before.schema || next.params !== before.params || next.effects !== before.effects) {
        contextVersion++;
        direct.clearGamepadOverrides();
        gamepadRuntime?.stopGestures();
      }
    });
    if (typeof window !== 'undefined') {
      const stop = () => gamepadRuntime?.stopGestures();
      window.addEventListener('blur', stop);
      document.addEventListener('visibilitychange', stop);
      removeLifecycle = () => { window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', stop); };
    }
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
  unsubscribeInspector?.();
  unsubscribeInspector = null;
  removeLifecycle?.();
  removeLifecycle = null;
  unregisterSessionParticipant?.();
  unregisterSessionParticipant = null;
  gamepadRuntime?.dispose();
  gamepadRuntime = null;
  bindingEngine = null;
  persistenceWarnings = [];
  resumeAfterSessionEnable = false;
}
