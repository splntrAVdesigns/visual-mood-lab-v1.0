/**
 * Phase 4.97G — shared live-controller session safety boundary.
 *
 * This state is intentionally session-only. Profiles, banks and mappings stay
 * persisted separately; toggling Controllers Active never mutates the user's
 * controller map.
 */
export interface ControllerSessionSnapshot {
  active: boolean;
  resetCount: number;
}

export interface ControllerSessionParticipant {
  /** Clear temporary runtime influence while preserving mappings/devices. */
  reset: () => void;
  /** Optional transport-specific low-power suspension. */
  suspend?: () => void;
  /** Optional resume after Controllers Active is turned back on. */
  resume?: () => void;
}

export const CONTROLLER_SIDECAR_CLOSE_EVENT = 'vml:close-controller-sidecars';

let snapshot: ControllerSessionSnapshot = { active: true, resetCount: 0 };
const listeners = new Set<() => void>();
const participants = new Map<string, ControllerSessionParticipant>();

export function getControllerSessionSnapshot(): ControllerSessionSnapshot {
  return snapshot;
}

export function subscribeControllerSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function controllersAreActive(): boolean {
  return snapshot.active;
}

export function registerControllerSessionParticipant(
  id: string,
  participant: ControllerSessionParticipant,
): () => void {
  participants.set(id, participant);
  return () => {
    if (participants.get(id) === participant) participants.delete(id);
  };
}

export function setControllersActive(active: boolean): void {
  const next = Boolean(active);
  if (snapshot.active === next) return;

  snapshot = { ...snapshot, active: next };
  emit();

  if (!next) {
    resetParticipants();
    for (const participant of participants.values()) participant.suspend?.();
    closeControllerSidecars();
    return;
  }

  for (const participant of participants.values()) participant.resume?.();
}

/**
 * Emergency-safe neutralization / long-session cleanup.
 *
 * Clears runtime controller influence, pickup/smoothing histories, queued
 * input, pending write gestures and temporary renderer overrides through each
 * registered transport. It deliberately preserves controller profiles,
 * mappings, banks, presets and browser device permissions.
 */
export function resetLiveControllers(): void {
  resetParticipants();
  snapshot = { ...snapshot, resetCount: snapshot.resetCount + 1 };
  emit();
  closeControllerSidecars();
}

function resetParticipants(): void {
  for (const participant of participants.values()) {
    try {
      participant.reset();
    } catch (error) {
      console.error('[ControlSurface] controller session reset failed', error);
    }
  }
}

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error('[ControlSurface] controller session listener failed', error);
    }
  }
}

function closeControllerSidecars(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CONTROLLER_SIDECAR_CLOSE_EVENT));
}
