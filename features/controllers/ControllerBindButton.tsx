'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, Field, FieldActionProvider, Slider, Toggle, formatValue } from '@/components/ui';
import { defaultAmountFor } from '@/lib/modulation/bus';
import type { Control } from '@/renderers/control-schema';
import {
  applyGamepadLearnBinding,
  applyMidiLearnBinding,
  bindingsForTarget,
  createEmptyControlSurfaceDocument,
  enableGamepadControlSurface,
  getGamepadControlSurface,
  getMidiControlSurface,
  loadControlSurfaceDocument,
  reloadGamepadControlSurfaceConfiguration,
  reloadMidiControlSurfaceConfiguration,
  removeControllerBinding,
  requestMidiControlSurfaceAccess,
  saveControlSurfaceDocument,
  updateControllerBinding,
  updateGamepadControlCalibration,
  type ControllerBindingPatch,
  type ControllerTransport,
  type ControllerWriteMode,
  type ControlSurfaceDocument,
  type GamepadRuntimeSnapshot,
  type MidiRelativeMode,
  type MidiRuntimeSnapshot,
  type ResponseCurve,
  type TakeoverMode,
  type TargetRef,
} from '@/lib/control-surface';
import s from './ControllerBindButton.module.css';

interface ControllerBindButtonProps {
  control: Control;
  itemId: string;
  effectInstanceId?: string;
  targetLabel?: string;
}

type ScopeChoice = 'focused' | 'pinned';
type ContinuousPathChoice = 'direct' | 'modulation';

/**
 * Compact hardware binding affordance shared by tile parameters and VFX.
 * The visible pill is intentionally labelled MIDI per product UI language,
 * while the dialog still supports MIDI and Gamepad from the same entry point.
 */
export function ControllerBindButton({
  control,
  itemId,
  effectInstanceId,
  targetLabel,
}: ControllerBindButtonProps) {
  const [open, setOpen] = useState(false);
  const [transport, setTransport] = useState<ControllerTransport>('midi');
  const [document, setDocument] = useState<ControlSurfaceDocument>(createEmptyControlSurfaceDocument());
  const [midiSnapshot, setMidiSnapshot] = useState<MidiRuntimeSnapshot | null>(null);
  const [gamepadSnapshot, setGamepadSnapshot] = useState<GamepadRuntimeSnapshot | null>(null);
  const [scope, setScope] = useState<ScopeChoice>('focused');
  const [path, setPath] = useState<ContinuousPathChoice>('direct');
  const [writeMode, setWriteMode] = useState<ControllerWriteMode>('live');
  const [takeover, setTakeover] = useState<TakeoverMode>('pickup');
  const [relativeMode, setRelativeMode] = useState<MidiRelativeMode>('absolute');
  const [amount, setAmount] = useState(() => defaultAmountFor(control));
  const [smoothing, setSmoothing] = useState(0.12);
  const [invert, setInvert] = useState(false);
  const [midiInputId, setMidiInputId] = useState('');
  const [gamepadIndex, setGamepadIndex] = useState('');
  const [axisDeadzone, setAxisDeadzone] = useState(0.08);
  const [axisInvert, setAxisInvert] = useState(false);
  const [axisCurve, setAxisCurve] = useState<ResponseCurve>('linear');
  const [notice, setNotice] = useState<string | null>(null);
  const cancelLearnRef = useRef<(() => void) | null>(null);

  const isTrigger = control.kind === 'trigger';
  // `midi: false` (@nomidi) is a per-control opt-out — used for seed / reseed controls.
  const eligible =
    control.midi !== false &&
    (isTrigger ||
    control.kind === 'slider' ||
    control.kind === 'stepper' ||
    control.kind === 'toggle' ||
    control.kind === 'select');
  const canModulate =
    control.modulatable === true && (control.kind === 'slider' || control.kind === 'stepper');

  // Binding visibility still hydrates immediately, but Phase 4.97F.3 stops
  // every closed MIDI pill from subscribing to high-frequency diagnostic
  // snapshots. Runtime device activity is only relevant while this tool is
  // actually open; bound/unbound state comes from the persisted document.
  useEffect(() => {
    if (!eligible) return;
    setDocument(loadControlSurfaceDocument().document);
  }, [eligible]);

  useEffect(() => {
    if (!eligible || !open) return;
    const midi = getMidiControlSurface();
    const gamepad = getGamepadControlSurface();
    const unsubscribeMidi = midi.subscribe(setMidiSnapshot);
    const unsubscribeGamepad = gamepad.subscribe(setGamepadSnapshot);
    return () => {
      unsubscribeMidi();
      unsubscribeGamepad();
    };
  }, [eligible, open]);

  useEffect(() => () => cancelLearnRef.current?.(), []);

  const focusedTarget = useMemo(
    () => targetFor(control, 'focused', itemId, effectInstanceId),
    [control, itemId, effectInstanceId],
  );
  const pinnedTarget = useMemo(
    () => targetFor(control, 'pinned', itemId, effectInstanceId),
    [control, itemId, effectInstanceId],
  );

  const allBindings = useMemo(() => {
    const rows = [
      ...bindingsForTarget(document, focusedTarget),
      ...bindingsForTarget(document, pinnedTarget),
    ];
    const seen = new Set<string>();
    return rows.filter((row) => {
      if (seen.has(row.binding.id)) return false;
      seen.add(row.binding.id);
      return true;
    });
  }, [document, focusedTarget, pinnedTarget]);

  const bindings = useMemo(
    () => allBindings.filter((row) => row.profile.transport === transport),
    [allBindings, transport],
  );

  if (!eligible) return null;

  const displayLabel = targetLabel ?? control.label;

  const close = () => {
    cancelLearnRef.current?.();
    cancelLearnRef.current = null;
    setNotice(null);
    setOpen(false);
  };

  const persist = (next: ControlSurfaceDocument, changedTransport: ControllerTransport) => {
    saveControlSurfaceDocument(next);
    if (changedTransport === 'midi') reloadMidiControlSurfaceConfiguration();
    else reloadGamepadControlSurfaceConfiguration();
    setDocument(next);
  };

  const ensureMidi = async (): Promise<boolean> => {
    const current = getMidiControlSurface().snapshot();
    if (current.accessStatus === 'granted') return true;
    const next = await requestMidiControlSurfaceAccess();
    setMidiSnapshot(next);
    if (next.accessStatus !== 'granted') {
      setNotice(next.error ?? 'MIDI access was not granted.');
      return false;
    }
    return true;
  };

  const ensureGamepad = (): boolean => {
    const next = enableGamepadControlSurface();
    setGamepadSnapshot(next);
    if (!next.supported) {
      setNotice(next.error ?? 'Gamepad API is not supported in this browser.');
      return false;
    }
    return true;
  };

  const learnRequest = () => {
    const selectedPath = selectedBehavior(isTrigger, canModulate, path);
    return {
      target: scope === 'pinned' ? pinnedTarget : focusedTarget,
      targetLabel: displayLabel,
      selectedPath,
    };
  };

  const startMidiLearn = async () => {
    setNotice(null);
    if (!(await ensureMidi())) return;
    cancelLearnRef.current?.();
    const { target, targetLabel: label, selectedPath } = learnRequest();

    cancelLearnRef.current = getMidiControlSurface().startLearn(
      {
        inputId: midiInputId || undefined,
        allowCC: !isTrigger,
        allowNotes: true,
        allowPitchBend: !isTrigger,
        relativeMode,
      },
      (candidate) => {
        const result = applyMidiLearnBinding(loadControlSurfaceDocument().document, candidate, {
          target,
          targetLabel: label,
          path: selectedPath,
          writeMode: selectedPath === 'direct' ? writeMode : 'live',
          takeover: selectedPath === 'direct' ? takeover : 'jump',
          relativeMode,
          amount: selectedPath === 'modulation' ? amount : undefined,
          smoothing: selectedPath === 'modulation' ? smoothing : undefined,
          invert: selectedPath === 'modulation' ? invert : undefined,
        });
        persist(result.document, 'midi');
        cancelLearnRef.current = null;
        setNotice(`${result.virtualControl.label} → ${displayLabel} · ${behaviorLabel(selectedPath)}`);
      },
    );
  };

  const startGamepadLearn = () => {
    setNotice(null);
    if (!ensureGamepad()) return;
    cancelLearnRef.current?.();
    const { target, targetLabel: label, selectedPath } = learnRequest();

    cancelLearnRef.current = getGamepadControlSurface().startLearn(
      {
        gamepadIndex: gamepadIndex === '' ? undefined : Number(gamepadIndex),
        allowAxes: !isTrigger,
        allowButtons: true,
      },
      (candidate) => {
        const result = applyGamepadLearnBinding(loadControlSurfaceDocument().document, candidate, {
          target,
          targetLabel: label,
          path: selectedPath,
          writeMode: selectedPath === 'direct' ? writeMode : 'live',
          takeover: selectedPath === 'direct' ? takeover : 'jump',
          amount: selectedPath === 'modulation' ? amount : undefined,
          smoothing: selectedPath === 'modulation' ? smoothing : undefined,
          invert: selectedPath === 'modulation' ? invert : undefined,
          calibration: candidate.matcher.input === 'axis'
            ? { deadzone: axisDeadzone, invert: axisInvert, curve: axisCurve }
            : undefined,
        });
        persist(result.document, 'gamepad');
        cancelLearnRef.current = null;
        setNotice(`${result.virtualControl.label} → ${displayLabel} · ${behaviorLabel(selectedPath)}`);
      },
    );
  };

  const removeBinding = (bindingId: string) => {
    persist(removeControllerBinding(document, bindingId), transport);
    setNotice('Binding removed.');
  };

  const patchBinding = (bindingId: string, patch: ControllerBindingPatch) => {
    persist(updateControllerBinding(document, bindingId, patch), transport);
  };

  const patchGamepadCalibration = (
    profileId: string,
    virtualControlId: string,
    patch: { deadzone?: number; invert?: boolean; curve?: ResponseCurve },
  ) => {
    persist(updateGamepadControlCalibration(document, profileId, virtualControlId, patch), 'gamepad');
  };

  const midiDevices = midiSnapshot?.devices.filter((device) => device.state === 'connected') ?? [];
  const gamepads = gamepadSnapshot?.devices.filter((device) => device.connected) ?? [];
  const midiStatus = midiSnapshot?.accessStatus ?? 'idle';
  const listening = transport === 'midi' ? midiSnapshot?.learning : gamepadSnapshot?.learning;

  return (
    <>
      <button
        type="button"
        className={s.bindButton}
        data-bound={allBindings.length > 0 ? 'true' : undefined}
        onClick={() => {
          setDocument(loadControlSurfaceDocument().document);
          setOpen(true);
        }}
        aria-label={`MIDI and controller binding for ${displayLabel}`}
        title={allBindings.length
          ? `${allBindings.length} hardware binding${allBindings.length === 1 ? '' : 's'} · open MIDI / gamepad setup`
          : `Bind MIDI or gamepad to ${displayLabel}`}
      >
        <span className={s.bindDot} />
        MIDI
      </button>

      <FieldActionProvider value={null}>
        <Dialog compact desktopSidecar open={open} title={`Controller · ${displayLabel}`} onClose={close}>
          <div className={s.dialogStack}>
            <div className={s.transportTabs} role="tablist" aria-label="Controller transport">
              {(['midi', 'gamepad'] as ControllerTransport[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={s.transportTab}
                  data-active={transport === kind ? 'true' : undefined}
                  onClick={() => {
                    cancelLearnRef.current?.();
                    cancelLearnRef.current = null;
                    setTransport(kind);
                    setNotice(null);
                  }}
                >
                  {kind === 'midi' ? 'MIDI' : 'GAMEPAD'}
                </button>
              ))}
            </div>

            {transport === 'midi' ? (
              <MidiDeviceSection
                status={midiStatus}
                error={midiSnapshot?.error ?? null}
                devices={midiDevices}
                inputId={midiInputId}
                onInputChange={setMidiInputId}
                onEnable={() => void ensureMidi()}
              />
            ) : (
              <GamepadDeviceSection
                snapshot={gamepadSnapshot}
                gamepads={gamepads}
                gamepadIndex={gamepadIndex}
                onGamepadChange={setGamepadIndex}
                onEnable={ensureGamepad}
              />
            )}

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
                  <span>Behavior</span>
                  <select
                    value={canModulate ? path : 'direct'}
                    disabled={!canModulate}
                    onChange={(event) => setPath(event.target.value as ContinuousPathChoice)}
                  >
                    <option value="direct">Direct</option>
                    {canModulate && <option value="modulation">Modulation</option>}
                  </select>
                </label>
              )}
            </div>

            {!isTrigger && path === 'direct' && (
              <div className={s.twoCol}>
                <label className={s.field}>
                  <span>Mode</span>
                  <select value={writeMode} onChange={(event) => setWriteMode(event.target.value as ControllerWriteMode)}>
                    <option value="live">Live</option>
                    <option value="write">Write</option>
                  </select>
                </label>
                <label className={s.field}>
                  <span>Takeover</span>
                  <select value={takeover} onChange={(event) => setTakeover(event.target.value as TakeoverMode)}>
                    <option value="pickup">Pickup</option>
                    <option value="jump">Jump</option>
                    <option value="scaled">Scaled</option>
                  </select>
                </label>
              </div>
            )}

            {!isTrigger && canModulate && path === 'modulation' && (
              <div className={s.modLearnBlock}>
                <Field label="Amount" value={formatValue(amount, 0.01)}>
                  <Slider label={`${displayLabel} controller amount`} value={amount} min={0} max={1} step={0.01} onChange={setAmount} />
                </Field>
                <Field label="Smoothing" value={formatValue(smoothing, 0.01)}>
                  <Slider label={`${displayLabel} controller smoothing`} value={smoothing} min={0} max={0.95} step={0.01} onChange={setSmoothing} />
                </Field>
                <div className={s.invertLine}>
                  <span>Invert</span>
                  <Toggle checked={invert} label="Invert controller modulation" onChange={setInvert} />
                </div>
              </div>
            )}

            {!isTrigger && (
              <details className={s.advancedBlock}>
                <summary>Advanced input</summary>
                {transport === 'midi' ? (
                  <label className={s.field}>
                    <span>CC encoder</span>
                    <select value={relativeMode} onChange={(event) => setRelativeMode(event.target.value as MidiRelativeMode)}>
                      <option value="absolute">Absolute</option>
                      <option value="twos-complement">Two&apos;s complement</option>
                      <option value="binary-offset">Binary offset</option>
                      <option value="signed-bit">Signed bit</option>
                    </select>
                  </label>
                ) : (
                  <div className={s.calibrationBlock}>
                    <Field label="Deadzone" value={formatValue(axisDeadzone, 0.01)}>
                      <Slider label="Gamepad axis deadzone" value={axisDeadzone} min={0} max={0.5} step={0.01} onChange={setAxisDeadzone} />
                    </Field>
                    <label className={s.field}>
                      <span>Response</span>
                      <select value={axisCurve} onChange={(event) => setAxisCurve(event.target.value as ResponseCurve)}>
                        <option value="linear">Linear</option>
                        <option value="log">Soft / expanded</option>
                        <option value="exp">Firm / precise</option>
                      </select>
                    </label>
                    <div className={s.invertLine}>
                      <span>Invert axis</span>
                      <Toggle checked={axisInvert} label="Invert gamepad axis" onChange={setAxisInvert} />
                    </div>
                  </div>
                )}
              </details>
            )}

            <button
              type="button"
              className={s.learnButton}
              data-learning={listening ? 'true' : undefined}
              onClick={() => transport === 'midi' ? void startMidiLearn() : startGamepadLearn()}
            >
              {listening
                ? 'Listening… move a control'
                : transport === 'midi' ? 'Learn MIDI' : 'Learn gamepad'}
            </button>

            {notice && <div className={s.notice}>{notice}</div>}

            {bindings.length > 0 && (
              <section className={s.boundSection}>
                <div className={s.sectionTitle}>Active bindings</div>
                {bindings.map(({ binding, profile, control: virtualControl }) => {
                  const isGamepadAxis =
                    profile.transport === 'gamepad' &&
                    virtualControl?.matcher.transport === 'gamepad' &&
                    virtualControl.matcher.input === 'axis';
                  return (
                    <div key={binding.id} className={s.bindingCard}>
                      <div className={s.bindingTop}>
                        <div>
                          <strong>{virtualControl?.label ?? 'Controller input'}</strong>
                          <span>{profile.alias} · {behaviorLabel(binding.path)} · {binding.target.scope === 'pinned' ? 'Pinned' : 'Focused'}</span>
                        </div>
                        <button type="button" className={s.removeButton} onClick={() => removeBinding(binding.id)}>Remove</button>
                      </div>

                      {binding.path === 'direct' && (
                        <div className={s.bindingSettings}>
                          <select value={binding.takeover ?? 'pickup'} aria-label="Takeover mode" onChange={(event) => patchBinding(binding.id, { takeover: event.target.value as TakeoverMode })}>
                            <option value="pickup">Pickup</option>
                            <option value="jump">Jump</option>
                            <option value="scaled">Scaled</option>
                          </select>
                          <select value={binding.writeMode ?? 'live'} aria-label="Write mode" onChange={(event) => patchBinding(binding.id, { writeMode: event.target.value as ControllerWriteMode })}>
                            <option value="live">Live</option>
                            <option value="write">Write</option>
                          </select>
                        </div>
                      )}

                      {binding.path === 'modulation' && (
                        <div className={s.bindingModSettings}>
                          <Field label="Amount" value={formatValue(binding.amount ?? 0.3, 0.01)}>
                            <Slider label={`${displayLabel} binding amount`} value={binding.amount ?? 0.3} min={0} max={1} step={0.01} onChange={(value) => patchBinding(binding.id, { amount: value })} />
                          </Field>
                          <Field label="Smoothing" value={formatValue(binding.smoothing ?? 0, 0.01)}>
                            <Slider label={`${displayLabel} binding smoothing`} value={binding.smoothing ?? 0} min={0} max={0.95} step={0.01} onChange={(value) => patchBinding(binding.id, { smoothing: value })} />
                          </Field>
                        </div>
                      )}

                      {isGamepadAxis && virtualControl && (
                        <details className={s.advancedBlock}>
                          <summary>Axis calibration</summary>
                          <Field label="Deadzone" value={formatValue(virtualControl.calibration?.deadzone ?? 0.08, 0.01)}>
                            <Slider
                              label={`${virtualControl.label} deadzone`}
                              value={virtualControl.calibration?.deadzone ?? 0.08}
                              min={0}
                              max={0.5}
                              step={0.01}
                              onChange={(value) => patchGamepadCalibration(profile.id, virtualControl.id, { deadzone: value })}
                            />
                          </Field>
                          <label className={s.field}>
                            <span>Response</span>
                            <select value={virtualControl.calibration?.curve ?? 'linear'} onChange={(event) => patchGamepadCalibration(profile.id, virtualControl.id, { curve: event.target.value as ResponseCurve })}>
                              <option value="linear">Linear</option>
                              <option value="log">Soft / expanded</option>
                              <option value="exp">Firm / precise</option>
                            </select>
                          </label>
                          <div className={s.invertLine}>
                            <span>Invert axis</span>
                            <Toggle checked={Boolean(virtualControl.calibration?.invert)} label={`Invert ${virtualControl.label}`} onChange={(value) => patchGamepadCalibration(profile.id, virtualControl.id, { invert: value })} />
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </section>
            )}
          </div>
        </Dialog>
      </FieldActionProvider>
    </>
  );
}

function MidiDeviceSection({ status, error, devices, inputId, onInputChange, onEnable }: {
  status: MidiRuntimeSnapshot['accessStatus'];
  error: string | null;
  devices: MidiRuntimeSnapshot['devices'];
  inputId: string;
  onInputChange: (value: string) => void;
  onEnable: () => void;
}) {
  return (
    <div className={s.deviceBlock}>
      <div className={s.statusRow}>
        <span className={s.statusLabel}>Web MIDI</span>
        <span className={s.statusValue} data-ok={status === 'granted' ? 'true' : undefined}>{midiStatusLabel(status)}</span>
      </div>
      {status !== 'granted' ? (
        <button type="button" className={s.primaryButton} onClick={onEnable}>Enable MIDI</button>
      ) : (
        <label className={s.field}>
          <span>Input</span>
          <select value={inputId} onChange={(event) => onInputChange(event.target.value)}>
            <option value="">Any MIDI input</option>
            {devices.map((device) => <option key={device.id} value={device.id}>{device.manufacturer ? `${device.manufacturer} · ` : ''}{device.name}</option>)}
          </select>
        </label>
      )}
      {error && status !== 'granted' && <div className={s.notice}>{error}</div>}
    </div>
  );
}

function GamepadDeviceSection({ snapshot, gamepads, gamepadIndex, onGamepadChange, onEnable }: {
  snapshot: GamepadRuntimeSnapshot | null;
  gamepads: GamepadRuntimeSnapshot['devices'];
  gamepadIndex: string;
  onGamepadChange: (value: string) => void;
  onEnable: () => boolean;
}) {
  const active = Boolean(snapshot?.active);
  return (
    <div className={s.deviceBlock}>
      <div className={s.statusRow}>
        <span className={s.statusLabel}>Gamepad API</span>
        <span className={s.statusValue} data-ok={active ? 'true' : undefined}>{gamepadStatusLabel(snapshot)}</span>
      </div>
      {!active ? (
        <button type="button" className={s.primaryButton} onClick={() => onEnable()}>Enable gamepads</button>
      ) : (
        <label className={s.field}>
          <span>Input</span>
          <select value={gamepadIndex} onChange={(event) => onGamepadChange(event.target.value)}>
            <option value="">Any gamepad</option>
            {gamepads.map((device) => <option key={device.inputId} value={device.index}>{device.id}</option>)}
          </select>
        </label>
      )}
      {snapshot?.error && <div className={s.notice}>{snapshot.error}</div>}
    </div>
  );
}

function targetFor(
  control: Control,
  scope: ScopeChoice,
  itemId: string,
  effectInstanceId?: string,
): TargetRef {
  const card = scope === 'pinned' ? { cardId: itemId } : {};
  if (effectInstanceId && control.kind !== 'trigger') {
    return { scope, ...card, domain: 'effect', effectInstanceId, controlId: control.id };
  }
  if (control.kind === 'trigger') {
    return { scope, ...card, domain: 'action', actionId: 'tile.trigger', controlId: control.id };
  }
  return { scope, ...card, domain: 'parameter', controlId: control.id };
}

function selectedBehavior(isTrigger: boolean, canModulate: boolean, path: ContinuousPathChoice) {
  return isTrigger ? 'action' as const : canModulate ? path : 'direct' as const;
}

function behaviorLabel(path: 'direct' | 'modulation' | 'action'): string {
  if (path === 'modulation') return 'Modulation';
  if (path === 'action') return 'Action';
  return 'Direct';
}

function midiStatusLabel(status: MidiRuntimeSnapshot['accessStatus']): string {
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

function gamepadStatusLabel(snapshot: GamepadRuntimeSnapshot | null): string {
  if (!snapshot) return 'Not enabled';
  if (!snapshot.supported) return 'Not supported';
  if (snapshot.status === 'error') return 'Error';
  if (snapshot.active) return 'Ready';
  return 'Not enabled';
}
