import {
  CONTROL_SURFACE_SCHEMA_VERSION,
  CONTROLS_PER_BANK,
  type ControlBank,
  type ControllerBinding,
  type ControllerMapping,
  type ControlSurfaceDocument,
  type DeviceProfile,
  type GamepadCalibration,
  type PhysicalControlMatcher,
  type TargetRef,
  type VirtualControl,
} from './types';

export const CONTROL_SURFACE_STORAGE_KEY = 'vml.control-surface.v1';
export const CONTROL_SURFACE_CHANGE_EVENT = 'vml:control-surface-change';

export interface ParsedControlSurfaceDocument {
  document: ControlSurfaceDocument;
  warnings: string[];
}

export function createEmptyControlSurfaceDocument(): ControlSurfaceDocument {
  return { schemaVersion: CONTROL_SURFACE_SCHEMA_VERSION, profiles: [], mappings: [] };
}

export function serializeControlSurfaceDocument(document: ControlSurfaceDocument): string {
  return JSON.stringify(document, null, 2);
}

/**
 * Migration/validation boundary for local persistence and JSON import. Invalid
 * rows are skipped with warnings; one broken profile must not brick the whole
 * controller subsystem. Future schema versions fail closed until a migration
 * exists rather than silently interpreting new shapes as v1.
 */
export function parseControlSurfaceDocument(raw: string | unknown): ParsedControlSurfaceDocument {
  const warnings: string[] = [];
  let input: unknown = raw;

  if (typeof raw === 'string') {
    try {
      input = JSON.parse(raw);
    } catch {
      return {
        document: createEmptyControlSurfaceDocument(),
        warnings: ['Controller document is not valid JSON; using an empty configuration.'],
      };
    }
  }

  if (!isRecord(input)) {
    return {
      document: createEmptyControlSurfaceDocument(),
      warnings: ['Controller document is not an object; using an empty configuration.'],
    };
  }

  const version = input.schemaVersion;
  if (version !== CONTROL_SURFACE_SCHEMA_VERSION) {
    return {
      document: createEmptyControlSurfaceDocument(),
      warnings: [`Unsupported controller schemaVersion ${String(version)}; expected ${CONTROL_SURFACE_SCHEMA_VERSION}.`],
    };
  }

  const profiles = Array.isArray(input.profiles)
    ? input.profiles.flatMap((value, index) => {
        const profile = parseProfile(value, warnings, index);
        return profile ? [profile] : [];
      })
    : [];
  if (!Array.isArray(input.profiles)) warnings.push('profiles was missing or invalid; using an empty profile list.');

  const profileIds = new Set(profiles.map((profile) => profile.id));
  const mappings = Array.isArray(input.mappings)
    ? input.mappings.flatMap((value, index) => {
        const mapping = parseMapping(value, warnings, index, profileIds);
        return mapping ? [mapping] : [];
      })
    : [];
  if (!Array.isArray(input.mappings)) warnings.push('mappings was missing or invalid; using an empty mapping list.');

  return {
    document: { schemaVersion: CONTROL_SURFACE_SCHEMA_VERSION, profiles, mappings },
    warnings,
  };
}

export function loadControlSurfaceDocument(): ParsedControlSurfaceDocument {
  if (typeof window === 'undefined') return { document: createEmptyControlSurfaceDocument(), warnings: [] };
  const raw = window.localStorage.getItem(CONTROL_SURFACE_STORAGE_KEY);
  return raw ? parseControlSurfaceDocument(raw) : { document: createEmptyControlSurfaceDocument(), warnings: [] };
}

export function saveControlSurfaceDocument(document: ControlSurfaceDocument): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CONTROL_SURFACE_STORAGE_KEY, serializeControlSurfaceDocument(document));
  // Same-tab localStorage writes do not fire a storage event. Publish a tiny
  // local event so Inspector/Modulate presentation can immediately reflect a
  // new Learn/remove/import without polling or high-frequency React updates.
  window.dispatchEvent(new Event(CONTROL_SURFACE_CHANGE_EVENT));
}

function parseProfile(value: unknown, warnings: string[], index: number): DeviceProfile | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.alias)) {
    warnings.push(`profiles[${index}] is invalid and was skipped.`);
    return null;
  }
  if (value.transport !== 'midi' && value.transport !== 'gamepad') {
    warnings.push(`profiles[${index}] has unsupported transport and was skipped.`);
    return null;
  }
  if (!isRecord(value.fingerprint)) {
    warnings.push(`profiles[${index}] has no valid fingerprint and was skipped.`);
    return null;
  }

  const banks: ControlBank[] = Array.isArray(value.banks)
    ? value.banks.flatMap((bank, bankIndex) => {
        const parsed = parseBank(bank, warnings, index, bankIndex);
        return parsed ? [parsed] : [];
      })
    : [];

  return {
    id: value.id,
    alias: value.alias,
    transport: value.transport,
    fingerprint: {
      transport: value.transport,
      manufacturer: optionalString(value.fingerprint.manufacturer),
      name: optionalString(value.fingerprint.name),
      portId: optionalString(value.fingerprint.portId),
      mapping: optionalString(value.fingerprint.mapping),
    },
    banks,
    defaultRelativeMode: isRelativeMode(value.defaultRelativeMode) ? value.defaultRelativeMode : undefined,
  };
}

function parseBank(value: unknown, warnings: string[], profileIndex: number, bankIndex: number): ControlBank | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.label) || !Array.isArray(value.controls)) {
    warnings.push(`profiles[${profileIndex}].banks[${bankIndex}] is invalid and was skipped.`);
    return null;
  }

  if (value.controls.length > CONTROLS_PER_BANK) {
    warnings.push(`profiles[${profileIndex}].banks[${bankIndex}] exceeded ${CONTROLS_PER_BANK} controls; extras were ignored.`);
  }

  const controls = value.controls.slice(0, CONTROLS_PER_BANK).flatMap((control, controlIndex) => {
    const parsed = parseVirtualControl(control);
    if (!parsed) {
      warnings.push(`profiles[${profileIndex}].banks[${bankIndex}].controls[${controlIndex}] is invalid and was skipped.`);
      return [];
    }
    return [parsed];
  });

  return { id: value.id, label: value.label, controls };
}

function parseVirtualControl(value: unknown): VirtualControl | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.label)) return null;
  const matcher = parseMatcher(value.matcher);
  if (!matcher) return null;
  const calibration: GamepadCalibration | undefined = isRecord(value.calibration)
    ? {
        center: finiteOptional(value.calibration.center),
        min: finiteOptional(value.calibration.min),
        max: finiteOptional(value.calibration.max),
        deadzone: finiteOptional(value.calibration.deadzone),
        invert: value.calibration.invert === undefined ? undefined : Boolean(value.calibration.invert),
        curve: value.calibration.curve === 'log' || value.calibration.curve === 'exp'
          ? value.calibration.curve
          : value.calibration.curve === 'linear'
            ? 'linear'
            : undefined,
      }
    : undefined;
  return { id: value.id, label: value.label, matcher, calibration };
}

function parseMatcher(value: unknown): PhysicalControlMatcher | null {
  if (!isRecord(value)) return null;
  if (value.transport === 'midi') {
    const channel = validMidiChannel(value.channel) ? value.channel : undefined;
    if (value.message === 'cc' && validMidiData(value.cc)) {
      return {
        transport: 'midi',
        message: 'cc',
        cc: value.cc,
        channel,
        relativeMode: isRelativeMode(value.relativeMode) ? value.relativeMode : undefined,
      };
    }
    if (value.message === 'note' && validMidiData(value.note)) {
      return { transport: 'midi', message: 'note', note: value.note, channel };
    }
    if (value.message === 'pitchbend') return { transport: 'midi', message: 'pitchbend', channel };
  }
  if (value.transport === 'gamepad' && (value.input === 'axis' || value.input === 'button')) {
    if (Number.isInteger(value.index) && typeof value.index === 'number' && value.index >= 0) {
      return { transport: 'gamepad', input: value.input, index: value.index };
    }
  }
  return null;
}

function parseMapping(
  value: unknown,
  warnings: string[],
  index: number,
  profileIds: Set<string>,
): ControllerMapping | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.profileId) || !isString(value.activeBankId)) {
    warnings.push(`mappings[${index}] is invalid and was skipped.`);
    return null;
  }
  if (!profileIds.has(value.profileId)) {
    warnings.push(`mappings[${index}] references an unknown profile and was skipped.`);
    return null;
  }

  const bindings: ControllerBinding[] = Array.isArray(value.bindings)
    ? value.bindings.flatMap((binding, bindingIndex) => {
        const parsed = parseBinding(binding);
        if (!parsed) {
          warnings.push(`mappings[${index}].bindings[${bindingIndex}] is invalid and was skipped.`);
          return [];
        }
        return [parsed];
      })
    : [];

  return {
    id: value.id,
    profileId: value.profileId,
    activeBankId: value.activeBankId,
    writeMode: value.writeMode === 'write' ? 'write' : 'live',
    bindings,
  };
}

function parseBinding(value: unknown): ControllerBinding | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.virtualControlId)) return null;
  if (value.path !== 'direct' && value.path !== 'modulation' && value.path !== 'action') return null;
  const target = parseTarget(value.target);
  if (!target) return null;

  return {
    id: value.id,
    virtualControlId: value.virtualControlId,
    path: value.path,
    target,
    enabled: value.enabled === undefined ? undefined : Boolean(value.enabled),
    takeover: value.takeover === 'jump' || value.takeover === 'scaled' ? value.takeover : 'pickup',
    writeMode: value.writeMode === 'write' ? 'write' : 'live',
    smoothing: finiteOptional(value.smoothing),
    invert: value.invert === undefined ? undefined : Boolean(value.invert),
    curve: value.curve === 'log' || value.curve === 'exp' ? value.curve : 'linear',
    amount: finiteOptional(value.amount),
    actionMode: value.actionMode === 'toggle' || value.actionMode === 'momentary' ? value.actionMode : 'trigger',
  };
}

function parseTarget(value: unknown): TargetRef | null {
  if (!isRecord(value)) return null;
  if (value.scope !== 'focused' && value.scope !== 'pinned' && value.scope !== 'global') return null;
  const cardId = optionalString(value.cardId);
  if (value.scope === 'pinned' && !cardId) return null;

  if (value.domain === 'parameter' && isString(value.controlId)) {
    return { scope: value.scope, cardId, domain: 'parameter', controlId: value.controlId };
  }
  if (value.domain === 'effect' && isString(value.effectInstanceId) && isString(value.controlId)) {
    return {
      scope: value.scope,
      cardId,
      domain: 'effect',
      effectInstanceId: value.effectInstanceId,
      controlId: value.controlId,
    };
  }
  if (value.domain === 'action' && isString(value.actionId)) {
    return {
      scope: value.scope,
      cardId,
      domain: 'action',
      actionId: value.actionId,
      controlId: optionalString(value.controlId),
    };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
  return isString(value) ? value : undefined;
}

function finiteOptional(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function validMidiChannel(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 1 && value <= 16;
}

function validMidiData(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0 && value <= 127;
}

function isRelativeMode(value: unknown): value is 'absolute' | 'twos-complement' | 'binary-offset' | 'signed-bit' {
  return value === 'absolute' || value === 'twos-complement' || value === 'binary-offset' || value === 'signed-bit';
}
