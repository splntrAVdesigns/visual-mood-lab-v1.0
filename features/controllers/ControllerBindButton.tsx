'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@/components/ui';
import type { Control } from '@/renderers/control-schema';
import {
  applyMidiLearnBinding,
  bindingsForTarget,
  createEmptyControlSurfaceDocument,
  getMidiControlSurface,
  loadControlSurfaceDocument,
  reloadMidiControlSurfaceConfiguration,
  removeControllerBinding,
  requestMidiControlSurfaceAccess,
  saveControlSurfaceDocument,
  updateControllerBinding,
  type ControllerWriteMode,
  type ControlSurfaceDocument,
  type MidiRelativeMode,
  type MidiRuntimeSnapshot,
  type TakeoverMode,
  type TargetRef,
} from '@/lib/control-surface';
import s from './ControllerBindButton.module.css';

interface ControllerBindButtonProps {
  control: Control;
  itemId: string;
}

type ScopeChoice = 'focused' | 'pinned';

/**
 * Compact Inspector affordance for Phase 4.97C.
 *
 * The device/profile layer stays invisible until it is useful: click MIDI,
 * choose the behavior, hit Learn, move a physical control. If the device has
 * never been seen before, applyMidiLearnBinding creates its reusable profile,
 * first bank and mapping automatically. Learning the same knob against another
 * parameter reuses the virtual control and adds another binding (fan-out).
 */
export function ControllerBindButton({ control, itemId }: ControllerBindButtonProps) {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<ControlSurfaceDocument>(createEmptyControlSurfaceDocument());
  const [snapshot, setSnapshot] = useState<MidiRuntimeSnapshot | null>(null);
  const [scope, setScope] = useState<ScopeChoice>('focused');
  const [writeMode, setWriteMode] = useState<ControllerWriteMode>('live');
  const [takeover, setTakeover] = useState<TakeoverMode>('pickup');
  const [relativeMode, setRelativeMode] = useState<MidiRelativeMode>('absolute');
  const [inputId, setInputId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const cancelLearnRef = useRef<(() => void) | null>(null);

  const isTrigger = control.kind === 'trigger';
  const eligible = isTrigger || control.kind === 'slider' || control.kind === 'stepper' || control.kind === 'toggle' || control.kind === 'select';

  useEffect(() => {
    if (!eligible) return;
    const loaded = loadControlSurfaceDocument();
    setDocument(loaded.document);
    const runtime = getMidiControlSurface();
    return runtime.subscribe(setSnapshot);
  }, [eligible]);

  useEffect(() => () => cancelLearnRef.current?.(), []);

  const focusedTarget = useMemo(() => targetFor(control, 'focused', itemId), [control, itemId]);
  const pinnedTarget = useMemo(() => targetFor(control, 'pinned', itemId), [control, itemId]);

  const bindings = useMemo(() => {
    const focused = bindingsForTarget(document, focusedTarget);
    const pinned = bindingsForTarget(document, pinnedTarget);
    const seen = new Set<string>();
    return [...focused, ...pinned].filter((row) => {
      if (seen.has(row.binding.id)) return false;
      seen.add(row.binding.id);
      return true;
    });
  }, [document, focusedTarget, pinnedTarget]);

  if (!eligible) return null;

  const close = () => {
    cancelLearnRef.current?.();
    cancelLearnRef.current = null;
    setNotice(null);
    setOpen(false);
  };

  const persist = (next: ControlSurfaceDocument) => {
    saveControlSurfaceDocument(next);
    reloadMidiControlSurfaceConfiguration();
    setDocument(next);
  };

  const ensureMidi = async (): Promise<boolean> => {
    const current = getMidiControlSurface().snapshot();
    if (current.accessStatus === 'granted') return true;
    const next = await requestMidiControlSurfaceAccess();
    setSnapshot(next);
    if (next.accessStatus !== 'granted') {
      setNotice(next.error ?? 'MIDI access was not granted.');
      return false;
    }
    return true;
  };

  const startLearn = async () => {
    setNotice(null);
    if (!(await ensureMidi())) return;

    cancelLearnRef.current?.();
    const runtime = getMidiControlSurface();
    const target = scope === 'pinned' ? pinnedTarget : focusedTarget;

    cancelLearnRef.current = runtime.startLearn(
      {
        inputId: inputId || undefined,
        allowCC: !isTrigger,
        allowNotes: true,
        allowPitchBend: !isTrigger,
        relativeMode,
      },
      (candidate) => {
        const current = loadControlSurfaceDocument().document;
        const result = applyMidiLearnBinding(current, candidate, {
          target,
          targetLabel: control.label,
          path: isTrigger ? 'action' : 'direct',
          writeMode: isTrigger ? 'live' : writeMode,
          takeover: isTrigger ? 'jump' : takeover,
          relativeMode,
        });
        persist(result.document);
        cancelLearnRef.current = null;
        setNotice(`${result.profile.alias} · ${result.virtualControl.label} → ${control.label}`);
      },
    );
  };

  const removeBinding = (bindingId: string) => {
    persist(removeControllerBinding(document, bindingId));
    setNotice('Binding removed.');
  };

  const updateBinding = (bindingId: string, nextTakeover: TakeoverMode, nextWriteMode: ControllerWriteMode) => {
    persist(updateControllerBinding(document, bindingId, { takeover: nextTakeover, writeMode: nextWriteMode }));
  };

  const connectedDevices = snapshot?.devices.filter((device) => device.state === 'connected') ?? [];
  const accessStatus = snapshot?.accessStatus ?? 'idle';

  return (
    <>
      <button
        type="button"
        className={s.bindButton}
        data-bound={bindings.length > 0 ? 'true' : undefined}
        onClick={() => {
          const loaded = loadControlSurfaceDocument();
          setDocument(loaded.document);
          setOpen(true);
        }}
        aria-label={`MIDI bind ${control.label}`}
        title={bindings.length ? `${bindings.length} MIDI binding${bindings.length === 1 ? '' : 's'}` : `MIDI learn ${control.label}`}
      >
        <span className={s.bindDot} />
        {bindings.length > 0 ? `M${bindings.length}` : 'MIDI'}
      </button>

      <Dialog open={open} title={`Controller · ${control.label}`} onClose={close}>
        <div className={s.dialogStack}>
          <div className={s.statusRow}>
            <span className={s.statusLabel}>Web MIDI</span>
            <span className={s.statusValue} data-ok={accessStatus === 'granted' ? 'true' : undefined}>
              {statusLabel(accessStatus)}
            </span>
          </div>

          {accessStatus !== 'granted' && (
            <button type="button" className={s.primaryButton} onClick={() => void ensureMidi()}>
              Enable MIDI
            </button>
          )}

          {accessStatus === 'granted' && (
            <>
              <div className={s.deviceLine}>
                {connectedDevices.length > 0
                  ? `${connectedDevices.length} MIDI input${connectedDevices.length === 1 ? '' : 's'} connected`
                  : 'MIDI enabled — connect a controller and move a control.'}
              </div>

              <label className={s.field}>
                <span>Listen to</span>
                <select value={inputId} onChange={(event) => setInputId(event.target.value)}>
                  <option value="">Any connected MIDI input</option>
                  {connectedDevices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.manufacturer ? `${device.manufacturer} · ` : ''}{device.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className={s.twoCol}>
                <label className={s.field}>
                  <span>Target</span>
                  <select value={scope} onChange={(event) => setScope(event.target.value as ScopeChoice)}>
                    <option value="focused">Focused tile</option>
                    <option value="pinned">Pinned to this tile</option>
                  </select>
                </label>

                {!isTrigger && (
                  <label className={s.field}>
                    <span>Mode</span>
                    <select value={writeMode} onChange={(event) => setWriteMode(event.target.value as ControllerWriteMode)}>
                      <option value="live">Live</option>
                      <option value="write">Write</option>
                    </select>
                  </label>
                )}
              </div>

              {!isTrigger && (
                <div className={s.twoCol}>
                  <label className={s.field}>
                    <span>Takeover</span>
                    <select value={takeover} onChange={(event) => setTakeover(event.target.value as TakeoverMode)}>
                      <option value="pickup">Pickup</option>
                      <option value="jump">Jump</option>
                      <option value="scaled">Scaled</option>
                    </select>
                  </label>

                  <label className={s.field}>
                    <span>CC encoder</span>
                    <select value={relativeMode} onChange={(event) => setRelativeMode(event.target.value as MidiRelativeMode)}>
                      <option value="absolute">Absolute</option>
                      <option value="twos-complement">Two's complement</option>
                      <option value="binary-offset">Binary offset</option>
                      <option value="signed-bit">Signed bit</option>
                    </select>
                  </label>
                </div>
              )}

              <button
                type="button"
                className={s.learnButton}
                data-learning={snapshot?.learning ? 'true' : undefined}
                onClick={() => void startLearn()}
              >
                {snapshot?.learning ? 'Listening… move a control' : 'Learn MIDI control'}
              </button>
            </>
          )}

          {notice && <div className={s.notice}>{notice}</div>}

          {bindings.length > 0 && (
            <section className={s.boundSection}>
              <div className={s.sectionTitle}>Active bindings</div>
              {bindings.map(({ binding, profile, control: virtualControl }) => (
                <div key={binding.id} className={s.bindingCard}>
                  <div className={s.bindingTop}>
                    <div>
                      <strong>{virtualControl?.label ?? 'MIDI control'}</strong>
                      <span>{profile.alias} · {binding.target.scope === 'pinned' ? 'Pinned' : 'Focused'}</span>
                    </div>
                    <button type="button" className={s.removeButton} onClick={() => removeBinding(binding.id)}>
                      Remove
                    </button>
                  </div>

                  {binding.path === 'direct' && (
                    <div className={s.bindingSettings}>
                      <select
                        value={binding.takeover ?? 'pickup'}
                        aria-label="Takeover mode"
                        onChange={(event) => updateBinding(
                          binding.id,
                          event.target.value as TakeoverMode,
                          binding.writeMode ?? 'live',
                        )}
                      >
                        <option value="pickup">Pickup</option>
                        <option value="jump">Jump</option>
                        <option value="scaled">Scaled</option>
                      </select>
                      <select
                        value={binding.writeMode ?? 'live'}
                        aria-label="Write mode"
                        onChange={(event) => updateBinding(
                          binding.id,
                          binding.takeover ?? 'pickup',
                          event.target.value as ControllerWriteMode,
                        )}
                      >
                        <option value="live">Live</option>
                        <option value="write">Write</option>
                      </select>
                    </div>
                  )}
                </div>
              ))}
              <p className={s.fanoutHint}>Learn the same hardware control on another parameter to fan it out to both targets.</p>
            </section>
          )}
        </div>
      </Dialog>
    </>
  );
}

function targetFor(control: Control, scope: ScopeChoice, itemId: string): TargetRef {
  const card = scope === 'pinned' ? { cardId: itemId } : {};
  if (control.kind === 'trigger') {
    return {
      scope,
      ...card,
      domain: 'action',
      actionId: 'tile.trigger',
      controlId: control.id,
    };
  }
  return {
    scope,
    ...card,
    domain: 'parameter',
    controlId: control.id,
  };
}

function statusLabel(status: MidiRuntimeSnapshot['accessStatus']): string {
  switch (status) {
    case 'granted': return 'Ready';
    case 'requesting': return 'Requesting…';
    case 'denied': return 'Permission denied';
    case 'unsupported': return 'Not supported';
    case 'insecure-context': return 'HTTPS required';
    case 'error': return 'Error';
    default: return 'Not enabled';
  }
}
