'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, Field, Slider, Toggle, formatValue } from '@/components/ui';
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
}

type ScopeChoice = 'focused' | 'pinned';
type ContinuousPathChoice = 'direct' | 'modulation';

/**
 * One compact hardware-control entry point for MIDI and Gamepad.
 *
 * Phase 4.97E folds Gamepad Learn into the same Inspector affordance instead
 * of adding a second button to every row. Transport selection lives inside
 * the dialog; Direct / Modulation / Action, Focused / Pinned, fan-out, and
 * runtime semantics are shared underneath.
 */
export function ControllerBindButton({ control, itemId }: ControllerBindButtonProps) {
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
  const eligible =
    isTrigger ||
    control.kind === 'slider' ||
    control.kind === 'stepper' ||
    control.kind === 'toggle' ||
    control.kind === 'select';
  const canModulate =
    control.modulatable === true && (control.kind === 'slider' || control.kind === 'stepper');

  useEffect(() => {
    if (!eligible) return;
    const loaded = loadControlSurfaceDocument();
    setDocument(loaded.document);
    const unsubscribeMidi = getMidiControlSurface().subscribe(setMidiSnapshot);
    const unsubscribeGamepad = getGamepadControlSurface().subscribe(setGamepadSnapshot);
    return () => {
      unsubscribeMidi();
      unsubscribeGamepad();
    };
  }, [eligible]);

  useEffect(() => () => cancelLearnRef.current?.(), []);

  const focusedTarget = useMemo(() => targetFor(control, 'focused', itemId), [control, itemId]);
  const pinnedTarget = useMemo(() => targetFor(control, 'pinned', itemId), [control, itemId]);

  const allBindings = useMemo(() => {
    const focused = bindingsForTarget(document, focusedTarget);
    const pinned = bindingsForTarget(document, pinnedTarget);
    const seen = new Set<string>();
    return [...focused, ...pinned].filter((row) => {
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

  const startMidiLearn = async () => {
    setNotice(null);
    if (!(await ensureMidi())) return;
    cancelLearnRef.current?.();

    const target = scope === 'pinned' ? pinnedTarget : focusedTarget;
    const selectedPath = selectedBehavior(isTrigger, canModulate, path);
    cancelLearnRef.current = getMidiControlSurface().startLearn(
      {
        inputId: midiInputId || undefined,
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
        setNotice(`${result.profile.alias} · ${result.virtualControl.label} → ${control.label} · ${behaviorLabel(selectedPath)}`);
      },
    );
  };

  const startGamepadLearn = () => {
    setNotice(null);
    if (!ensureGamepad()) return;
    cancelLearnRef.current?.();

    const target = scope === 'pinned' ? pinnedTarget : focusedTarget;
    const selectedPath = selectedBehavior(isTrigger, canModulate, path);
    cancelLearnRef.current = getGamepadControlSurface().startLearn(
      {
        gamepadIndex: gamepadIndex === '' ? undefined : Number(gamepadIndex),
        allowAxes: !isTrigger,
        allowButtons: true,
      },
      (candidate) => {
        const current = loadControlSurfaceDocument().document;
        const result = applyGamepadLearnBinding(current, candidate, {
          target,
          targetLabel: control.label,
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
        setNotice(`${result.profile.alias} · ${result.virtualControl.label} → ${control.label} · ${behaviorLabel(selectedPath)}`);
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
          const loaded = loadControlSurfaceDocument();
          setDocument(loaded.document);
          setOpen(true);
        }}
        aria-label={`Controller bind ${control.label}`}
        title={allBindings.length ? `${allBindings.length} controller binding${allBindings.length === 1 ? '' : 's'}` : `Bind controller to ${control.label}`}
      >
        <span className={s.bindDot} />
        {allBindings.length > 0 ? `C${allBindings.length}` : 'CTRL'}
      </button>

      <Dialog open={open} title={`Controller · ${control.label}`} onClose={close}>
        <div className={s.dialogStack}>
          <div className={s.transportTabs} role="tablist" aria-label="Controller transport">
            <button
              type="button"
              className={s.transportTab}
              data-active={transport === 'midi' ? 'true' : undefined}
              onClick={() => {
                cancelLearnRef.current?.();
                cancelLearnRef.current = null;
                setTransport('midi');
                setNotice(null);
              }}
            >
              MIDI
            </button>
            <button
              type="button"
              className={s.transportTab}
              data-active={transport === 'gamepad' ? 'true' : undefined}
              onClick={() => {
                cancelLearnRef.current?.();
                cancelLearnRef.current = null;
                setTransport('gamepad');
                setNotice(null);
              }}
            >
              GAMEPAD
            </button>
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

            {!isTrigger && canModulate ? (
              <label className={s.field}>
                <span>Behavior</span>
                <select value={path} onChange={(event) => setPath(event.target.value as ContinuousPathChoice)}>
                  <option value="direct">Direct control</option>
                  <option value="modulation">Modulation</option>
                </select>
              </label>
            ) : !isTrigger ? (
              <label className={s.field}>
                <span>Behavior</span>
                <select value="direct" disabled>
                  <option value="direct">Direct control</option>
                </select>
              </label>
            ) : null}
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
              <div className={s.modLearnTitle}>Controller modulation</div>
              <Field label="Amount" value={formatValue(amount, 0.01)}>
                <Slider label={`${control.label} controller modulation amount`} value={amount} min={0} max={1} step={0.01} onChange={setAmount} />
              </Field>
              <Field label="Smoothing" value={formatValue(smoothing, 0.01)}>
                <Slider label={`${control.label} controller modulation smoothing`} value={smoothing} min={0} max={0.95} step={0.01} onChange={setSmoothing} />
              </Field>
              <div className={s.invertLine}>
                <span>Invert signal</span>
                <Toggle checked={invert} label="Invert controller modulation" onChange={setInvert} />
              </div>
              <p className={s.modHint}>Moves around the saved value. LFO, Audio, or Mic modulation can continue layering on top.</p>
            </div>
          )}

          {transport === 'midi' && !isTrigger && (
            <label className={s.field}>
              <span>CC encoder</span>
              <select value={relativeMode} onChange={(event) => setRelativeMode(event.target.value as MidiRelativeMode)}>
                <option value="absolute">Absolute</option>
                <option value="twos-complement">Two&apos;s complement</option>
                <option value="binary-offset">Binary offset</option>
                <option value="signed-bit">Signed bit</option>
              </select>
            </label>
          )}

          {transport === 'gamepad' && !isTrigger && (
            <div className={s.calibrationBlock}>
              <div className={s.modLearnTitle}>Axis calibration</div>
              <Field label="Deadzone" value={formatValue(axisDeadzone, 0.01)}>
                <Slider label="Gamepad axis deadzone" value={axisDeadzone} min={0} max={0.5} step={0.01} onChange={setAxisDeadzone} />
              </Field>
              <div className={s.twoCol}>
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
              <p className={s.modHint}>Standard dual-stick controllers use radial deadzones for axis pairs; generic controllers fall back to per-axis deadzones.</p>
            </div>
          )}

          <button
            type="button"
            className={s.learnButton}
            data-learning={listening ? 'true' : undefined}
            onClick={() => transport === 'midi' ? void startMidiLearn() : startGamepadLearn()}
          >
            {listening
              ? transport === 'midi' ? 'Listening… move a MIDI control' : 'Listening… move / press a gamepad control'
              : transport === 'midi' ? 'Learn MIDI control' : 'Learn gamepad control'}
          </button>

          {notice && <div className={s.notice}>{notice}</div>}

          {bindings.length > 0 && (
            <section className={s.boundSection}>
              <div className={s.sectionTitle}>Active {transport === 'midi' ? 'MIDI' : 'gamepad'} bindings</div>
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
                          <Slider label={`${control.label} binding amount`} value={binding.amount ?? 0.3} min={0} max={1} step={0.01} onChange={(value) => patchBinding(binding.id, { amount: value })} />
                        </Field>
                        <Field label="Smoothing" value={formatValue(binding.smoothing ?? 0, 0.01)}>
                          <Slider label={`${control.label} binding smoothing`} value={binding.smoothing ?? 0} min={0} max={0.95} step={0.01} onChange={(value) => patchBinding(binding.id, { smoothing: value })} />
                        </Field>
                        <div className={s.invertLine}>
                          <span>Invert signal</span>
                          <Toggle checked={Boolean(binding.invert)} label={`Invert ${control.label} controller modulation`} onChange={(value) => patchBinding(binding.id, { invert: value })} />
                        </div>
                      </div>
                    )}

                    {isGamepadAxis && virtualControl && (
                      <div className={s.calibrationBlock}>
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
                        <div className={s.twoCol}>
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
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <p className={s.fanoutHint}>Learn the same physical control on another parameter to fan it out to both targets.</p>
            </section>
          )}
        </div>
      </Dialog>
    </>
  );
}

function MidiDeviceSection({
  status,
  error,
  devices,
  inputId,
  onInputChange,
  onEnable,
}: {
  status: MidiRuntimeSnapshot['accessStatus'];
  error: string | null;
  devices: MidiRuntimeSnapshot['devices'];
  inputId: string;
  onInputChange: (value: string) => void;
  onEnable: () => void;
}) {
  return (
    <>
      <div className={s.statusRow}>
        <span className={s.statusLabel}>Web MIDI</span>
        <span className={s.statusValue} data-ok={status === 'granted' ? 'true' : undefined}>{midiStatusLabel(status)}</span>
      </div>
      {status !== 'granted' ? (
        <button type="button" className={s.primaryButton} onClick={onEnable}>Enable MIDI</button>
      ) : (
        <>
          <div className={s.deviceLine}>{devices.length > 0 ? `${devices.length} MIDI input${devices.length === 1 ? '' : 's'} connected` : 'MIDI enabled — connect a controller and move a control.'}</div>
          <label className={s.field}>
            <span>Listen to</span>
            <select value={inputId} onChange={(event) => onInputChange(event.target.value)}>
              <option value="">Any connected MIDI input</option>
              {devices.map((device) => <option key={device.id} value={device.id}>{device.manufacturer ? `${device.manufacturer} · ` : ''}{device.name}</option>)}
            </select>
          </label>
        </>
      )}
      {error && status !== 'granted' && <div className={s.notice}>{error}</div>}
    </>
  );
}

function GamepadDeviceSection({
  snapshot,
  gamepads,
  gamepadIndex,
  onGamepadChange,
  onEnable,
}: {
  snapshot: GamepadRuntimeSnapshot | null;
  gamepads: GamepadRuntimeSnapshot['devices'];
  gamepadIndex: string;
  onGamepadChange: (value: string) => void;
  onEnable: () => boolean;
}) {
  const active = Boolean(snapshot?.active);
  return (
    <>
      <div className={s.statusRow}>
        <span className={s.statusLabel}>Gamepad API</span>
        <span className={s.statusValue} data-ok={active ? 'true' : undefined}>{gamepadStatusLabel(snapshot)}</span>
      </div>
      {!active ? (
        <button type="button" className={s.primaryButton} onClick={() => onEnable()}>Enable gamepads</button>
      ) : (
        <>
          <div className={s.deviceLine}>{gamepads.length > 0 ? `${gamepads.length} game controller${gamepads.length === 1 ? '' : 's'} connected` : 'Gamepad polling is ready — press a button on the controller if the browser has not exposed it yet.'}</div>
          <label className={s.field}>
            <span>Listen to</span>
            <select value={gamepadIndex} onChange={(event) => onGamepadChange(event.target.value)}>
              <option value="">Any connected gamepad</option>
              {gamepads.map((device) => <option key={device.inputId} value={device.index}>{device.id}</option>)}
            </select>
          </label>
        </>
      )}
      {snapshot?.error && <div className={s.notice}>{snapshot.error}</div>}
    </>
  );
}

function targetFor(control: Control, scope: ScopeChoice, itemId: string): TargetRef {
  const card = scope === 'pinned' ? { cardId: itemId } : {};
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
