'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import {
  addControllerBank,
  controllerBankCapacityLabel,
  countBindingsForVirtualControl,
  deleteControllerPreset,
  loadControllerPresets,
  loadControlSurfaceDocument,
  parseControlSurfaceDocument,
  reloadGamepadControlSurfaceConfiguration,
  reloadMidiControlSurfaceConfiguration,
  removeEmptyControllerBank,
  renameControllerBank,
  renameControllerProfile,
  saveControllerPreset,
  saveControlSurfaceDocument,
  serializeControlSurfaceDocument,
  setActiveControllerBank,
  type ControlSurfaceDocument,
  type ControllerPreset,
} from '@/lib/control-surface';
import s from './ControllerPanel.module.css';

interface ControllerPanelProps {
  itemId: string;
}

/**
 * Phase 4.97F transport-neutral controller workspace. The per-parameter CTRL
 * pill remains the fastest Learn path; this view manages the reusable layer:
 * device profiles, 8-control banks, presets, and JSON portability.
 */
export function ControllerPanel({ itemId }: ControllerPanelProps) {
  const [document, setDocument] = useState<ControlSurfaceDocument>(() => loadControlSurfaceDocument().document);
  const [presets, setPresets] = useState<ControllerPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDocument(loadControlSurfaceDocument().document);
    setPresets(loadControllerPresets());
  }, [itemId]);

  const bindingCount = useMemo(
    () => document.mappings.reduce((total, mapping) => total + mapping.bindings.length, 0),
    [document],
  );

  const applyDocument = (next: ControlSurfaceDocument, message?: string) => {
    saveControlSurfaceDocument(next);
    reloadMidiControlSurfaceConfiguration();
    reloadGamepadControlSurfaceConfiguration();
    setDocument(next);
    if (message) setNotice(message);
  };

  const applyMutation = (mutation: { document: ControlSurfaceDocument; changed: boolean; error?: string }, message: string) => {
    if (mutation.error) {
      setNotice(mutation.error);
      return;
    }
    if (mutation.changed) applyDocument(mutation.document, message);
  };

  const exportMappings = () => {
    const blob = new Blob([serializeControlSurfaceDocument(document)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `visual-mood-lab-controller-map-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice('Controller map exported.');
  };

  const importMappings = async (file: File) => {
    const parsed = parseControlSurfaceDocument(await file.text());
    if (parsed.warnings.length > 0 && parsed.document.profiles.length === 0 && parsed.document.mappings.length === 0) {
      setNotice(parsed.warnings[0] ?? 'Import failed.');
      return;
    }
    applyDocument(parsed.document, parsed.warnings.length ? `Imported with ${parsed.warnings.length} warning(s).` : 'Controller map imported.');
  };

  const savePreset = () => {
    const next = saveControllerPreset(presetName, document);
    if (!presetName.trim()) {
      setNotice('Enter a preset name first.');
      return;
    }
    setPresets(next);
    const saved = next.find((preset) => preset.name.toLowerCase() === presetName.trim().toLowerCase());
    if (saved) setSelectedPresetId(saved.id);
    setPresetName('');
    setNotice('Controller preset saved.');
  };

  const loadPreset = () => {
    const preset = presets.find((item) => item.id === selectedPresetId);
    if (!preset) return;
    applyDocument(JSON.parse(JSON.stringify(preset.document)) as ControlSurfaceDocument, `Loaded preset “${preset.name}”.`);
  };

  const removePreset = () => {
    if (!selectedPresetId) return;
    const next = deleteControllerPreset(selectedPresetId);
    setPresets(next);
    setSelectedPresetId(next[0]?.id ?? '');
    setNotice('Controller preset removed.');
  };

  return (
    <div className={s.panel}>
      <div className={s.summary}>
        <div>
          <strong>{document.profiles.length}</strong>
          <span>devices</span>
        </div>
        <div>
          <strong>{bindingCount}</strong>
          <span>bindings</span>
        </div>
        <div>
          <strong>{document.profiles.reduce((total, profile) => total + profile.banks.length, 0)}</strong>
          <span>banks</span>
        </div>
      </div>

      {document.profiles.length === 0 && (
        <div className={s.empty}>
          No controller profile yet. Use the <strong>CTRL</strong> button beside any parameter or VFX value, then move a MIDI or gamepad control.
        </div>
      )}

      {document.profiles.map((profile) => {
        const mapping = document.mappings.find((item) => item.profileId === profile.id);
        const activeBank = profile.banks.find((bank) => bank.id === mapping?.activeBankId) ?? profile.banks[0];
        if (!activeBank) return null;

        return (
          <section key={profile.id} className={s.profileCard}>
            <div className={s.profileHead}>
              <input
                className={s.profileName}
                defaultValue={profile.alias}
                aria-label="Controller name"
                onBlur={(event) => applyMutation(
                  renameControllerProfile(document, profile.id, event.currentTarget.value),
                  'Controller renamed.',
                )}
              />
              <span className={s.transportBadge}>{profile.transport}</span>
            </div>

            <div className={s.bankToolbar}>
              <label>
                <span>Bank</span>
                <select
                  value={activeBank.id}
                  onChange={(event) => applyMutation(
                    setActiveControllerBank(document, profile.id, event.target.value),
                    'Active bank changed.',
                  )}
                >
                  {profile.banks.map((bank) => (
                    <option key={bank.id} value={bank.id}>{bank.label} · {controllerBankCapacityLabel(bank.controls.length)}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={s.smallButton}
                onClick={() => applyMutation(addControllerBank(document, profile.id), 'New bank created and selected.')}
              >
                + Bank
              </button>
            </div>

            <div className={s.bankNameRow}>
              <input
                className={s.bankName}
                key={activeBank.id}
                defaultValue={activeBank.label}
                aria-label="Bank name"
                onBlur={(event) => applyMutation(
                  renameControllerBank(document, profile.id, activeBank.id, event.currentTarget.value),
                  'Bank renamed.',
                )}
              />
              <span>{controllerBankCapacityLabel(activeBank.controls.length)}</span>
              {activeBank.controls.length === 0 && profile.banks.length > 1 && (
                <button
                  type="button"
                  className={s.removeLink}
                  onClick={() => applyMutation(
                    removeEmptyControllerBank(document, profile.id, activeBank.id),
                    'Empty bank removed.',
                  )}
                >
                  Remove
                </button>
              )}
            </div>

            <div className={s.controlGrid}>
              {Array.from({ length: 8 }, (_, index) => {
                const control = activeBank.controls[index];
                return (
                  <div key={control?.id ?? `empty-${index}`} className={s.controlSlot} data-empty={!control ? 'true' : undefined}>
                    <span className={s.slotNumber}>{index + 1}</span>
                    {control ? (
                      <>
                        <strong>{control.label}</strong>
                        <span>{countBindingsForVirtualControl(document, profile.id, control.id)} route(s)</span>
                      </>
                    ) : (
                      <span>Empty</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className={s.toolsSection}>
        <div className={s.sectionTitle}>Presets</div>
        <div className={s.inlineForm}>
          <input
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="Preset name"
            aria-label="Controller preset name"
          />
          <button type="button" className={s.smallButton} onClick={savePreset}>Save</button>
        </div>
        {presets.length > 0 && (
          <div className={s.inlineForm}>
            <select value={selectedPresetId} onChange={(event) => setSelectedPresetId(event.target.value)}>
              <option value="">Choose preset…</option>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
            <button type="button" className={s.smallButton} disabled={!selectedPresetId} onClick={loadPreset}>Load</button>
            <button type="button" className={s.removeLink} disabled={!selectedPresetId} onClick={removePreset}>Delete</button>
          </div>
        )}
      </section>

      <section className={s.toolsSection}>
        <div className={s.sectionTitle}>Portability</div>
        <div className={s.portabilityRow}>
          <Button variant="outline" onClick={exportMappings}>Export JSON</Button>
          <Button variant="outline" onClick={() => importRef.current?.click()}>Import JSON</Button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className={s.hiddenInput}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void importMappings(file);
              event.currentTarget.value = '';
            }}
          />
        </div>
        <p className={s.help}>Exports include device profiles, banks, calibration, Direct/Modulation/Action routes, and Focused/Pinned targets.</p>
      </section>

      {notice && <div className={s.notice}>{notice}</div>}
    </div>
  );
}
