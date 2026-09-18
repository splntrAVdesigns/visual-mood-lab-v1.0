import {
  CONTROLS_PER_BANK,
  type ControlBank,
  type ControlSurfaceDocument,
} from './types';
import { parseControlSurfaceDocument } from './persistence';

export const CONTROLLER_PRESET_STORAGE_KEY = 'vml.control-surface.presets.v1';

export interface ControllerPreset {
  id: string;
  name: string;
  createdAt: string;
  document: ControlSurfaceDocument;
}

export interface ControllerDocumentMutation {
  document: ControlSurfaceDocument;
  changed: boolean;
  error?: string;
}

/** Zero-based index -> Bank A, Bank B ... Bank Z, Bank AA, Bank AB ... */
export function controllerBankLabelForIndex(index: number): string {
  let value = Math.max(0, Math.floor(index)) + 1;
  let letters = '';
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26);
  }
  return `Bank ${letters}`;
}

export function nextControllerBankLabel(banks: ControlBank[]): string {
  return controllerBankLabelForIndex(banks.length);
}

/**
 * One-time compatibility cleanup for banks auto-created by older 4.97F builds
 * as "Bank 2", "Bank 3", etc. Only exact system-style labels matching their
 * ordinal position are changed; custom user labels are never touched.
 */
export function normalizeGeneratedControllerBankLabels(
  source: ControlSurfaceDocument,
): ControllerDocumentMutation {
  const document = cloneDocument(source);
  let changed = false;

  for (const profile of document.profiles) {
    profile.banks.forEach((bank, index) => {
      const legacy = `Bank ${index + 1}`;
      if (bank.label !== legacy) return;
      bank.label = controllerBankLabelForIndex(index);
      changed = true;
    });
  }

  return { document, changed };
}

export function setActiveControllerBank(
  source: ControlSurfaceDocument,
  profileId: string,
  bankId: string,
): ControllerDocumentMutation {
  const document = cloneDocument(source);
  const profile = document.profiles.find((item) => item.id === profileId);
  if (!profile) return { document, changed: false, error: 'Controller profile not found.' };
  if (!profile.banks.some((bank) => bank.id === bankId)) {
    return { document, changed: false, error: 'Controller bank not found.' };
  }

  let changed = false;
  for (const mapping of document.mappings) {
    if (mapping.profileId !== profileId || mapping.activeBankId === bankId) continue;
    mapping.activeBankId = bankId;
    changed = true;
  }
  return { document, changed };
}

export function addControllerBank(
  source: ControlSurfaceDocument,
  profileId: string,
): ControllerDocumentMutation {
  const document = cloneDocument(source);
  const profile = document.profiles.find((item) => item.id === profileId);
  if (!profile) return { document, changed: false, error: 'Controller profile not found.' };

  const bank = {
    id: createId('bank'),
    label: nextControllerBankLabel(profile.banks),
    controls: [],
  };
  profile.banks.push(bank);

  for (const mapping of document.mappings) {
    if (mapping.profileId === profileId) mapping.activeBankId = bank.id;
  }

  return { document, changed: true };
}

export function renameControllerBank(
  source: ControlSurfaceDocument,
  profileId: string,
  bankId: string,
  label: string,
): ControllerDocumentMutation {
  const document = cloneDocument(source);
  const profile = document.profiles.find((item) => item.id === profileId);
  const bank = profile?.banks.find((item) => item.id === bankId);
  if (!bank) return { document, changed: false, error: 'Controller bank not found.' };

  const next = label.trim().slice(0, 40);
  if (!next || next === bank.label) return { document, changed: false };
  bank.label = next;
  return { document, changed: true };
}

export function removeEmptyControllerBank(
  source: ControlSurfaceDocument,
  profileId: string,
  bankId: string,
): ControllerDocumentMutation {
  const document = cloneDocument(source);
  const profile = document.profiles.find((item) => item.id === profileId);
  if (!profile) return { document, changed: false, error: 'Controller profile not found.' };
  if (profile.banks.length <= 1) {
    return { document, changed: false, error: 'A controller profile must keep at least one bank.' };
  }

  const bank = profile.banks.find((item) => item.id === bankId);
  if (!bank) return { document, changed: false, error: 'Controller bank not found.' };
  if (bank.controls.length > 0) {
    return { document, changed: false, error: 'Only empty banks can be removed.' };
  }

  profile.banks = profile.banks.filter((item) => item.id !== bankId);
  const fallback = profile.banks[0]!.id;
  for (const mapping of document.mappings) {
    if (mapping.profileId === profileId && mapping.activeBankId === bankId) {
      mapping.activeBankId = fallback;
    }
  }
  return { document, changed: true };
}

export function renameControllerProfile(
  source: ControlSurfaceDocument,
  profileId: string,
  alias: string,
): ControllerDocumentMutation {
  const document = cloneDocument(source);
  const profile = document.profiles.find((item) => item.id === profileId);
  if (!profile) return { document, changed: false, error: 'Controller profile not found.' };
  const next = alias.trim().slice(0, 64);
  if (!next || next === profile.alias) return { document, changed: false };
  profile.alias = next;
  return { document, changed: true };
}

export function countBindingsForVirtualControl(
  document: ControlSurfaceDocument,
  profileId: string,
  virtualControlId: string,
): number {
  return document.mappings
    .filter((mapping) => mapping.profileId === profileId)
    .reduce(
      (total, mapping) => total + mapping.bindings.filter((binding) => binding.virtualControlId === virtualControlId).length,
      0,
    );
}

export function controllerBankCapacityLabel(count: number): string {
  return `${Math.min(count, CONTROLS_PER_BANK)} / ${CONTROLS_PER_BANK}`;
}

export function loadControllerPresets(): ControllerPreset[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(CONTROLLER_PRESET_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return [];
      const checked = parseControlSurfaceDocument(item.document);
      return [{
        id: item.id,
        name: item.name.slice(0, 64),
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        document: checked.document,
      } satisfies ControllerPreset];
    });
  } catch {
    return [];
  }
}

export function saveControllerPreset(
  name: string,
  document: ControlSurfaceDocument,
): ControllerPreset[] {
  const clean = name.trim().slice(0, 64);
  if (!clean) return loadControllerPresets();
  const presets = loadControllerPresets();
  const existing = presets.find((preset) => preset.name.toLowerCase() === clean.toLowerCase());
  const nextPreset: ControllerPreset = {
    id: existing?.id ?? createId('controller-preset'),
    name: clean,
    createdAt: new Date().toISOString(),
    document: cloneDocument(document),
  };
  const next = existing
    ? presets.map((preset) => preset.id === existing.id ? nextPreset : preset)
    : [...presets, nextPreset];
  storePresets(next);
  return next;
}

export function deleteControllerPreset(id: string): ControllerPreset[] {
  const next = loadControllerPresets().filter((preset) => preset.id !== id);
  storePresets(next);
  return next;
}

function storePresets(presets: ControllerPreset[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CONTROLLER_PRESET_STORAGE_KEY, JSON.stringify(presets));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
