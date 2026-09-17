import {
  CONTROLS_PER_BANK,
  type ControllerBinding,
  type ControllerMapping,
  type ControllerPath,
  type ControllerWriteMode,
  type ControlSurfaceDocument,
  type DeviceProfile,
  type MidiRelativeMode,
  type PhysicalControlMatcher,
  type TakeoverMode,
  type TargetRef,
  type VirtualControl,
} from './types';
import type { MidiLearnCandidate } from './midi-types';

export interface LearnBindingRequest {
  target: TargetRef;
  targetLabel: string;
  path: ControllerPath;
  writeMode: ControllerWriteMode;
  takeover: TakeoverMode;
  relativeMode?: MidiRelativeMode;
  /** Modulation path depth, 0..1 in the current UI. */
  amount?: number;
  /** Controller-input smoothing, 0 = none, 0.95 = heavy. */
  smoothing?: number;
  /** Invert the normalized controller signal before applying modulation. */
  invert?: boolean;
}


export interface LearnedBindingResult {
  document: ControlSurfaceDocument;
  profile: DeviceProfile;
  mapping: ControllerMapping;
  virtualControl: VirtualControl;
  binding: ControllerBinding;
  createdProfile: boolean;
  createdVirtualControl: boolean;
  createdBinding: boolean;
}

/**
 * Merge one MIDI Learn candidate into the versioned control-surface document.
 * The physical control is learned once at the profile layer; binding the same
 * knob/pad to another VML target simply adds another binding to the SAME
 * virtualControlId, which is the fan-out behavior Phase 4.97C requires.
 */
export function applyMidiLearnBinding(
  source: ControlSurfaceDocument,
  candidate: MidiLearnCandidate,
  request: LearnBindingRequest,
): LearnedBindingResult {
  const document = cloneDocument(source);
  let profile = candidate.profileId
    ? document.profiles.find((item) => item.id === candidate.profileId)
    : undefined;

  if (!profile) profile = findProfileByFingerprint(document.profiles, candidate);

  const createdProfile = !profile;
  if (!profile) {
    profile = {
      id: createId('midi-profile'),
      alias: candidate.fingerprint.name || candidate.fingerprint.manufacturer || 'MIDI Controller',
      transport: 'midi',
      fingerprint: {
        transport: 'midi',
        manufacturer: candidate.fingerprint.manufacturer,
        name: candidate.fingerprint.name,
        portId: candidate.fingerprint.portId || candidate.inputId,
      },
      banks: [{ id: 'bank-a', label: 'Bank A', controls: [] }],
      defaultRelativeMode: request.relativeMode ?? 'absolute',
    };
    document.profiles.push(profile);
  }

  const matcher = withRelativeMode(candidate.matcher, request.relativeMode);
  let virtualControl = findVirtualControl(profile, matcher);
  const createdVirtualControl = !virtualControl;

  if (!virtualControl) {
    let bank = profile.banks.find((item) => item.controls.length < CONTROLS_PER_BANK);
    if (!bank) {
      const index = profile.banks.length;
      bank = {
        id: `bank-${String.fromCharCode(97 + Math.min(index, 25))}-${index + 1}`,
        label: `Bank ${index + 1}`,
        controls: [],
      };
      profile.banks.push(bank);
    }

    virtualControl = {
      id: createId('midi-control'),
      label: learnedControlLabel(candidate),
      matcher,
    };
    bank.controls.push(virtualControl);
  }

  const bank = profile.banks.find((item) => item.controls.some((control) => control.id === virtualControl!.id))!;
  let mapping = document.mappings.find((item) => item.profileId === profile!.id);
  if (!mapping) {
    mapping = {
      id: createId('midi-map'),
      profileId: profile.id,
      activeBankId: bank.id,
      writeMode: request.writeMode,
      bindings: [],
    };
    document.mappings.push(mapping);
  }

  // Learning a control from a different bank makes that bank the active one
  // for this profile. Eight controls remain visible at once, while the data
  // model itself stays unlimited-bank as approved in 4.97A.
  mapping.activeBankId = bank.id;

  const targetKey = stableTargetKey(request.target);
  let binding = mapping.bindings.find(
    (item) => item.virtualControlId === virtualControl!.id && stableTargetKey(item.target) === targetKey,
  );
  const createdBinding = !binding;

  if (!binding) {
    binding = {
      id: createId('midi-binding'),
      virtualControlId: virtualControl.id,
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

export function removeControllerBinding(
  source: ControlSurfaceDocument,
  bindingId: string,
): ControlSurfaceDocument {
  const document = cloneDocument(source);
  for (const mapping of document.mappings) {
    mapping.bindings = mapping.bindings.filter((binding) => binding.id !== bindingId);
  }
  return document;
}

export type ControllerBindingPatch = Partial<
  Pick<
    ControllerBinding,
    'takeover' | 'writeMode' | 'amount' | 'smoothing' | 'invert' | 'curve' | 'enabled'
  >
>;

export function updateControllerBinding(
  source: ControlSurfaceDocument,
  bindingId: string,
  patch: ControllerBindingPatch,
): ControlSurfaceDocument {
  const document = cloneDocument(source);
  for (const mapping of document.mappings) {
    const binding = mapping.bindings.find((item) => item.id === bindingId);
    if (!binding) continue;
    if (patch.takeover !== undefined) binding.takeover = patch.takeover;
    if (patch.writeMode !== undefined) binding.writeMode = patch.writeMode;
    if (patch.amount !== undefined) binding.amount = clampAmount(patch.amount);
    if (patch.smoothing !== undefined) binding.smoothing = clampSmoothing(patch.smoothing);
    if (patch.invert !== undefined) binding.invert = patch.invert;
    if (patch.curve !== undefined) binding.curve = patch.curve;
    if (patch.enabled !== undefined) binding.enabled = patch.enabled;
  }
  return document;
}

export function bindingsForTarget(
  document: ControlSurfaceDocument,
  target: TargetRef,
): Array<{ binding: ControllerBinding; mapping: ControllerMapping; profile: DeviceProfile; control?: VirtualControl }> {
  const key = stableTargetKey(target);
  const rows: Array<{ binding: ControllerBinding; mapping: ControllerMapping; profile: DeviceProfile; control?: VirtualControl }> = [];

  for (const mapping of document.mappings) {
    const profile = document.profiles.find((item) => item.id === mapping.profileId);
    if (!profile) continue;
    for (const binding of mapping.bindings) {
      if (stableTargetKey(binding.target) !== key) continue;
      const control = profile.banks.flatMap((bank) => bank.controls).find((item) => item.id === binding.virtualControlId);
      rows.push({ binding, mapping, profile, control });
    }
  }
  return rows;
}

export function stableTargetKey(target: TargetRef): string {
  const scope = target.scope === 'focused' ? 'focused' : `${target.scope}:${target.cardId ?? ''}`;
  if (target.domain === 'parameter') return `${scope}:parameter:${target.controlId}`;
  if (target.domain === 'effect') return `${scope}:effect:${target.effectInstanceId}:${target.controlId}`;
  return `${scope}:action:${target.actionId}:${target.controlId ?? ''}`;
}

function withRelativeMode(
  matcher: Extract<PhysicalControlMatcher, { transport: 'midi' }>,
  relativeMode?: MidiRelativeMode,
): Extract<PhysicalControlMatcher, { transport: 'midi' }> {
  if (matcher.message !== 'cc') return { ...matcher };
  return { ...matcher, relativeMode: relativeMode ?? matcher.relativeMode ?? 'absolute' };
}

function findVirtualControl(profile: DeviceProfile, matcher: Extract<PhysicalControlMatcher, { transport: 'midi' }>) {
  return profile.banks
    .flatMap((bank) => bank.controls)
    .find((control) => control.matcher.transport === 'midi' && sameMidiMatcher(control.matcher, matcher));
}

function sameMidiMatcher(
  a: Extract<PhysicalControlMatcher, { transport: 'midi' }>,
  b: Extract<PhysicalControlMatcher, { transport: 'midi' }>,
): boolean {
  if (a.message !== b.message || a.channel !== b.channel) return false;
  if (a.message === 'cc' && b.message === 'cc') {
    return a.cc === b.cc && (a.relativeMode ?? 'absolute') === (b.relativeMode ?? 'absolute');
  }
  if (a.message === 'note' && b.message === 'note') return a.note === b.note;
  return a.message === 'pitchbend' && b.message === 'pitchbend';
}

function findProfileByFingerprint(profiles: DeviceProfile[], candidate: MidiLearnCandidate): DeviceProfile | undefined {
  const manufacturer = normalize(candidate.fingerprint.manufacturer);
  const name = normalize(candidate.fingerprint.name);
  return profiles.find((profile) => {
    if (profile.transport !== 'midi') return false;
    const samePort = profile.fingerprint.portId && profile.fingerprint.portId === candidate.inputId;
    if (samePort) return true;
    return Boolean(name && normalize(profile.fingerprint.name) === name && normalize(profile.fingerprint.manufacturer) === manufacturer);
  });
}

function learnedControlLabel(candidate: MidiLearnCandidate): string {
  const matcher = candidate.matcher;
  if (matcher.message === 'cc') return `CC ${matcher.cc}`;
  if (matcher.message === 'note') return `Note ${matcher.note}`;
  return 'Pitch Bend';
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function cloneDocument(document: ControlSurfaceDocument): ControlSurfaceDocument {
  return JSON.parse(JSON.stringify(document)) as ControlSurfaceDocument;
}


function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return 0.3;
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

function clampSmoothing(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 0.95 ? 0.95 : value;
}

function createId(prefix: string): string {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${id}`;
}
