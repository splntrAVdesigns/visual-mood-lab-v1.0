import { defaultGamepadGesture, standardPair, STANDARD_BUTTON_LABELS } from './gamepad-gestures';
import type { GamepadGesture } from './types';
import {
  CONTROLS_PER_BANK,
  type ControllerBinding,
  type ControlSurfaceDocument,
  type DeviceProfile,
  type GamepadCalibration,
  type PhysicalControlMatcher,
  type VirtualControl,
} from './types';
import { controllerBankLabelForIndex } from './management';
import type { LearnBindingRequest, LearnedBindingResult } from './learn';
import type { GamepadLearnCalibration, GamepadLearnCandidate } from './gamepad-types';

export interface GamepadLearnBindingRequest extends LearnBindingRequest {
  calibration?: GamepadLearnCalibration;
  sliderGesture?: boolean;
  gestureMode?: GamepadGesture['mode'] | 'auto' | 'absolute';
  replaceExisting?: boolean;
  partner?: GamepadLearnCandidate;
  genericRole?: 'A' | 'B' | 'X' | 'Y';
}

/**
 * Gamepad counterpart to applyMidiLearnBinding(). The profile is created once
 * per physical controller identity, then axis/button controls are reused across
 * targets so one stick/button can fan out to several Visual Mood Lab controls.
 */
function applySingleGamepadBinding(
  source: ControlSurfaceDocument,
  candidate: GamepadLearnCandidate,
  request: GamepadLearnBindingRequest,
): LearnedBindingResult {
  const document = cloneDocument(source);
  let profile = candidate.profileId
    ? document.profiles.find((item) => item.id === candidate.profileId && item.transport === 'gamepad')
    : undefined;

  if (!profile) profile = findProfile(document.profiles, candidate);

  const createdProfile = !profile;
  if (!profile) {
    profile = {
      id: createId('gamepad-profile'),
      alias: candidate.fingerprint.name || 'Game Controller',
      transport: 'gamepad',
      fingerprint: {
        transport: 'gamepad',
        name: candidate.fingerprint.name,
        portId: candidate.inputId,
        mapping: candidate.fingerprint.mapping,
      },
      banks: [{ id: 'bank-a', label: 'Bank A', controls: [] }],
    };
    document.profiles.push(profile);
  }

  let virtualControl = findVirtualControl(profile, candidate.matcher);
  const createdVirtualControl = !virtualControl;

  if (!virtualControl) {
    let bank = profile.banks.find((item) => item.controls.length < CONTROLS_PER_BANK);
    if (!bank) {
      const index = profile.banks.length;
      bank = {
        id: `bank-gamepad-${index + 1}`,
        label: controllerBankLabelForIndex(index),
        controls: [],
      };
      profile.banks.push(bank);
    }

    virtualControl = {
      id: createId('gamepad-control'),
      label: candidate.label,
      matcher: { ...candidate.matcher },
      calibration: candidate.matcher.input === 'axis'
        ? normalizeCalibration(request.calibration)
        : undefined,
    };
    bank.controls.push(virtualControl);
  } else if (candidate.matcher.input === 'axis' && request.calibration) {
    virtualControl.calibration = normalizeCalibration({
      ...virtualControl.calibration,
      ...request.calibration,
    });
  }

  const bank = profile.banks.find((item) => item.controls.some((control) => control.id === virtualControl!.id))!;
  let mapping = document.mappings.find((item) => item.profileId === profile!.id);
  if (!mapping) {
    mapping = {
      id: createId('gamepad-map'),
      profileId: profile.id,
      activeBankId: bank.id,
      writeMode: request.writeMode,
      bindings: [],
    };
    document.mappings.push(mapping);
  }
  mapping.activeBankId = bank.id;

  const targetKey = stableTargetKey(request.target);
  let binding = mapping.bindings.find(
    (item) => item.virtualControlId === virtualControl!.id && stableTargetKey(item.target) === targetKey,
  );
  const createdBinding = !binding;

  if (!binding) {
    binding = createBinding(virtualControl.id, request);
    mapping.bindings.push(binding);
  } else {
    binding.path = request.path;
    binding.target = request.target;
    binding.enabled = true;
    binding.takeover = request.takeover;
    binding.writeMode = request.writeMode;
    binding.smoothing = request.path === 'modulation' ? clampSmoothing(request.smoothing ?? 0.12) : 0;
    binding.invert = request.path === 'modulation' ? Boolean(request.invert) : false;
    binding.amount = request.path === 'modulation' ? clampAmount(request.amount ?? 0.3) : undefined;
    if (request.path === 'action') binding.actionMode = binding.actionMode ?? 'trigger';
  }

  mapping.writeMode = request.writeMode;

  return {
    document,
    profile,
    mapping,
    virtualControl,
    binding,
    createdProfile,
    createdVirtualControl,
    createdBinding,
  };
}

export function updateGamepadControlCalibration(
  source: ControlSurfaceDocument,
  profileId: string,
  virtualControlId: string,
  patch: GamepadLearnCalibration,
): ControlSurfaceDocument {
  const document = cloneDocument(source);
  const profile = document.profiles.find((item) => item.id === profileId && item.transport === 'gamepad');
  if (!profile) return document;
  const control = profile.banks.flatMap((bank) => bank.controls).find((item) => item.id === virtualControlId);
  if (!control || control.matcher.transport !== 'gamepad' || control.matcher.input !== 'axis') return document;
  control.calibration = normalizeCalibration({ ...control.calibration, ...patch });
  return document;
}

function createBinding(virtualControlId: string, request: GamepadLearnBindingRequest): ControllerBinding {
  return {
    id: createId('gamepad-binding'),
    virtualControlId,
    path: request.path,
    target: request.target,
    enabled: true,
    takeover: request.takeover,
    writeMode: request.writeMode,
    smoothing: request.path === 'modulation' ? clampSmoothing(request.smoothing ?? 0.12) : 0,
    invert: request.path === 'modulation' ? Boolean(request.invert) : false,
    curve: 'linear',
    amount: request.path === 'modulation' ? clampAmount(request.amount ?? 0.3) : undefined,
    actionMode: request.path === 'action' ? 'trigger' : undefined,
  };
}

function findProfile(profiles: DeviceProfile[], candidate: GamepadLearnCandidate): DeviceProfile | undefined {
  const exact = profiles.find(
    (profile) => profile.transport === 'gamepad' && profile.fingerprint.portId === candidate.inputId &&
      normalize(profile.fingerprint.name) === normalize(candidate.fingerprint.name) &&
      normalize(profile.fingerprint.mapping) === normalize(candidate.fingerprint.mapping),
  );
  if (exact) return exact;

  const name = normalize(candidate.fingerprint.name);
  const mapping = normalize(candidate.fingerprint.mapping);
  return profiles.find((profile) =>
    profile.transport === 'gamepad' &&
    normalize(profile.fingerprint.name) === name &&
    normalize(profile.fingerprint.mapping) === mapping,
  );
}

function findVirtualControl(
  profile: DeviceProfile,
  matcher: Extract<PhysicalControlMatcher, { transport: 'gamepad' }>,
): VirtualControl | undefined {
  return profile.banks
    .flatMap((bank) => bank.controls)
    .find((control) =>
      control.matcher.transport === 'gamepad' &&
      control.matcher.input === matcher.input &&
      control.matcher.index === matcher.index,
    );
}

function normalizeCalibration(calibration?: Partial<GamepadCalibration>): GamepadCalibration {
  return {
    center: finite(calibration?.center, 0),
    min: finite(calibration?.min, -1),
    max: finite(calibration?.max, 1),
    deadzone: clampDeadzone(calibration?.deadzone ?? 0.08),
    invert: Boolean(calibration?.invert),
    curve: calibration?.curve === 'log' || calibration?.curve === 'exp' ? calibration.curve : 'linear',
  };
}

function stableTargetKey(target: ControllerBinding['target']): string {
  const scope = target.scope === 'focused' ? 'focused' : `${target.scope}:${target.cardId ?? ''}`;
  if (target.domain === 'parameter') return `${scope}:parameter:${target.controlId}`;
  if (target.domain === 'effect') return `${scope}:effect:${target.effectInstanceId}:${target.controlId}`;
  return `${scope}:action:${target.actionId}:${target.controlId ?? ''}`;
}

function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return 0.3;
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

function clampSmoothing(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 0.95 ? 0.95 : value;
}

function clampDeadzone(value: number): number {
  if (!Number.isFinite(value)) return 0.08;
  return value < 0 ? 0 : value > 0.5 ? 0.5 : value;
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function cloneDocument(document: ControlSurfaceDocument): ControlSurfaceDocument {
  return JSON.parse(JSON.stringify(document)) as ControlSurfaceDocument;
}

function createId(prefix: string): string {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${id}`;
}

/** Atomic Learn transaction: both directions of a pair always share a target. */
export function applyGamepadLearnBinding(source: ControlSurfaceDocument, candidate: GamepadLearnCandidate, request: GamepadLearnBindingRequest): LearnedBindingResult {
  const enabled = request.path === 'direct' && request.sliderGesture;
  const isStandard = candidate.fingerprint.mapping === 'standard';
  const pair = enabled && candidate.matcher.input === 'button' && (request.gestureMode ?? 'auto') === 'auto'
    ? (isStandard ? standardPair(candidate.matcher.index) : null) : null;
  const partner = request.partner ?? (pair ? { ...candidate,
    matcher: { ...candidate.matcher, input: 'button' as const, index: pair.find(i => i !== candidate.matcher.index)! },
    label: STANDARD_BUTTON_LABELS[pair.find(i => i !== candidate.matcher.index)!]! } : undefined);
  if (partner && partner.inputId !== candidate.inputId) throw new Error('Use the same controller for both buttons.');
  if (partner && partner.matcher.index === candidate.matcher.index) throw new Error('Press the other button of this pair.');
  let result = applySingleGamepadBinding(source, candidate, request);
  if (!enabled || request.gestureMode === 'absolute') { delete result.binding.gesture; return result; }
  const genericRole = !isStandard ? request.genericRole : undefined;
  const firstMode = genericRole ? (genericRole === 'A' || genericRole === 'X' ? 'decrease' : 'increase')
    : (request.gestureMode && request.gestureMode !== 'auto' ? request.gestureMode : defaultGamepadGesture(candidate.matcher.input, isStandard ? candidate.matcher.index : 100).mode);
  result.binding.gesture = { mode: firstMode, doubleTap: candidate.matcher.input === 'button' && (Boolean(genericRole) || (isStandard && candidate.matcher.index < 4)) };
  result.virtualControl.label = isStandard && candidate.matcher.input === 'button' ? STANDARD_BUTTON_LABELS[candidate.matcher.index] ?? candidate.label : genericRole ?? candidate.label;
  // Standard Y axes read negative for up. Direct relative gestures use up=+.
  if (candidate.matcher.input === 'axis' && isStandard && candidate.matcher.index % 2 === 1 && result.virtualControl.calibration) {
    result.virtualControl.calibration.invert = !Boolean(request.calibration?.invert);
  }
  if (!partner) return result;
  const firstId = result.binding.id;
  const other = applySingleGamepadBinding(result.document, partner, request);
  result = { ...other, binding: other.mapping.bindings.find(b => b.id === firstId)!, virtualControl: other.profile.banks.flatMap(b => b.controls).find(c => c.id === result.virtualControl.id)! };
  const memberIds = new Set([result.binding.virtualControlId, other.binding.virtualControlId]);
  const conflicts = other.mapping.bindings.filter(b => memberIds.has(b.virtualControlId) && b.id !== firstId && b.id !== other.binding.id && !b.pairId);
  if (conflicts.length && !request.replaceExisting) throw new Error('This pair already has another assignment. Enable Replace existing assignment to move both buttons.');
  // Existing managed pairs move together. Explicit fan-out survives unless the user requests replacement.
  other.mapping.bindings = other.mapping.bindings.filter(b => !memberIds.has(b.virtualControlId) || b.id === firstId || b.id === other.binding.id);
  const pairId = result.binding.pairId ?? other.binding.pairId ?? createId('gamepad-pair');
  result.binding.pairId = pairId;
  other.binding.pairId = pairId;
  other.binding.gesture = { mode: firstMode === 'decrease' ? 'increase' : 'decrease', doubleTap: result.binding.gesture?.doubleTap };
  if (genericRole) other.virtualControl.label = ({ A: 'B', B: 'A', X: 'Y', Y: 'X' } as const)[genericRole];
  return result;
}
