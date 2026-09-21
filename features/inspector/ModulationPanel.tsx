'use client';

import { useMemo, useState } from 'react';
import { PanelModeButton } from '@/features/panels/PanelModeButton';
import { usePanelCollapsed } from '@/features/panels/usePanelCollapsed';
import { Button, Field, IconButton, Select, Slider, formatValue } from '@/components/ui';
import { CloseIcon, ChevronDownIcon, ChevronRightIcon, ResetIcon } from '@/components/ui';
import { MOD_SOURCES, defaultAmountFor, defaultSmoothingFor, sourceMeta } from '@/lib/modulation/bus';
import { useTrackLoaded, useMicEnabled } from '@/lib/hooks/useTrackState';
import { ControllerPanel } from '@/features/controllers/ControllerPanel';
import {
  controllerTargetState,
  useControllerDocument,
  type ControllerTargetState,
} from '@/features/controllers/useControllerDocument';
import { RateStrip } from './controls/RateStrip';
import type { Control, Modulation, ModSource } from '@/renderers/control-schema';
import { useInspectorStore } from '@/stores';
import s from '../features.module.css';
import ui from './ModulationPanel.module.css';

interface ModulationPanelProps {
  controls: Control[];
  itemId: string;
  onClose: () => void;
  embedded?: boolean;
}

type ModulationView = 'signals' | 'controllers';

const DEFAULT_MOD_BASE: Omit<Modulation, 'amount'> = { source: 'lfo.sine', rate: 0.4, smoothing: 0 };
const SIGNAL_SOURCES = MOD_SOURCES.filter((source) => source.value !== 'midi.cc');

export function ModulationPanel({ controls, itemId, onClose, embedded = false }: ModulationPanelProps) {
  const mod = useInspectorStore((st) => st.mod);
  const setModulation = useInspectorStore((st) => st.setModulation);
  const trackLoaded = useTrackLoaded(itemId);
  const micEnabled = useMicEnabled(itemId);
  const controllerDocument = useControllerDocument();
  const [expanded, setExpanded] = useState<string | null>(controls[0]?.id ?? null);
  const [collapsed, toggleCollapsed] = usePanelCollapsed('mod');
  const [view, setView] = useState<ModulationView>('signals');

  const controllerById = useMemo(() => {
    const map = new Map<string, ControllerTargetState>();
    for (const control of controls) {
      map.set(control.id, controllerTargetState(controllerDocument, itemId, control.id));
    }
    return map;
  }, [controllerDocument, controls, itemId]);

  const routedIds = Object.keys(mod);
  const activeCount = controls.reduce((count, control) =>
    count + (mod[control.id] || controllerById.get(control.id)?.active ? 1 : 0), 0);

  const resetAll = () => {
    for (const id of routedIds) setModulation(id, null);
  };

  const signalRows = (
    <div className={embedded ? s.modPanelListEmbedded : s.modPanelList}>
      {controls.length === 0 && <p className={s.notice}>Nothing on this asset can be modulated.</p>}
      {controls.map((control) => (
        <ModRow
          key={control.id}
          control={control}
          active={mod[control.id]}
          controllerState={controllerById.get(control.id)}
          trackLoaded={trackLoaded}
          micEnabled={micEnabled}
          expanded={expanded === control.id}
          onToggleExpand={() => setExpanded((current) => current === control.id ? null : control.id)}
          onChange={(next) => setModulation(control.id, next)}
        />
      ))}
    </div>
  );

  const tabs = (
    <div className={ui.modeTabs} role="tablist" aria-label="Modulation mode">
      <button type="button" data-active={view === 'signals' ? 'true' : undefined} onClick={() => setView('signals')}>
        SIGNALS
      </button>
      <button type="button" data-active={view === 'controllers' ? 'true' : undefined} onClick={() => setView('controllers')}>
        CONTROLLERS
      </button>
    </div>
  );

  const content = view === 'signals' ? signalRows : <ControllerPanel itemId={itemId} />;

  if (embedded) {
    return <div className={ui.embeddedRoot}>{tabs}{content}</div>;
  }

  return (
    <aside className={s.modPanel} data-collapsed={collapsed ? 'true' : undefined} onClick={(e) => e.stopPropagation()} aria-label="Modulation">
      <header className={s.codeHeader} data-panel-handle="">
        <IconButton
          label={collapsed ? 'Expand modulation' : 'Collapse modulation'}
          icon={collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          onClick={(e) => toggleCollapsed({ additive: e.shiftKey })}
        />
        <span className={s.codeTitle}>Modulation</span>
        <span className={s.codeMeta}>
          {view === 'signals' ? `${activeCount} of ${controls.length} active` : 'controller setup'}
        </span>
        {view === 'signals' && (
          <IconButton
            label="Remove all signal modulation"
            icon={<ResetIcon />}
            onClick={resetAll}
            disabled={routedIds.length === 0}
          />
        )}
        <PanelModeButton id="mod" />
        <IconButton label="Close modulation" icon={<CloseIcon />} onClick={onClose} />
      </header>
      <div className={ui.desktopBody} data-collapsed={collapsed ? 'true' : undefined}>
        {tabs}
        {content}
      </div>
    </aside>
  );
}

export function ModRow({
  control,
  active,
  controllerState,
  trackLoaded,
  micEnabled,
  expanded,
  onToggleExpand,
  onChange,
  hideHeader = false,
}: {
  control: Control;
  active: Modulation | undefined;
  controllerState?: ControllerTargetState;
  trackLoaded: boolean;
  micEnabled: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (mod: Modulation | null) => void;
  hideHeader?: boolean;
}) {
  const current = active ?? { ...DEFAULT_MOD_BASE, amount: defaultAmountFor(control) };
  const meta = sourceMeta(current.source);
  const hardwareActive = Boolean(controllerState?.active);
  const rowActive = Boolean(active) || hardwareActive;
  const signalLabel = active ? sourceMeta(active.source)?.label : null;
  const routeLabel = signalLabel && controllerState?.shortLabel
    ? `${signalLabel} + ${controllerState.shortLabel}`
    : signalLabel ?? controllerState?.shortLabel ?? null;

  const update = (patch: Partial<Modulation>) => onChange({ ...current, ...patch });

  return (
    <div className={s.modPanelRow} data-active={rowActive ? 'true' : undefined}>
      {!hideHeader && (
        <button type="button" className={s.modPanelRowHead} onClick={onToggleExpand}>
          <span className={s.modPanelDot} data-on={rowActive ? 'true' : undefined} />
          <span className={s.modPanelLabel}>{control.label}</span>
          {routeLabel && <span className={s.modPanelSourceTag}>{routeLabel}</span>}
        </button>
      )}

      {expanded && (
        <div className={s.modPanelBody}>
          {hardwareActive && (
            <p className={s.notice}>
              Hardware route active: <strong>{controllerState?.shortLabel}</strong>. Manage hardware routing under Controllers; signal routing below can be layered on top.
            </p>
          )}

          <Field label="Source">
            <Select
              label={`${control.label} modulation source`}
              value={current.source === 'midi.cc' ? 'lfo.sine' : current.source}
              options={SIGNAL_SOURCES.map((option) => ({
                value: option.value,
                label: option.requiresTrack && !trackLoaded
                  ? `${option.label} — load track`
                  : option.requiresMic && !micEnabled
                    ? `${option.label} — enable mic`
                    : option.label,
              }))}
              onChange={(value) => {
                const nextSource = value as ModSource;
                const option = SIGNAL_SOURCES.find((source) => source.value === nextSource);
                if ((option?.requiresTrack && !trackLoaded) || (option?.requiresMic && !micEnabled)) return;
                const smoothing = current.smoothing === 0 || current.smoothing === undefined
                  ? defaultSmoothingFor(nextSource)
                  : current.smoothing;
                update({ source: nextSource, smoothing });
              }}
            />
          </Field>

          <Field label="Amount" value={formatValue(current.amount, 0.01)}>
            <Slider
              label={`${control.label} modulation amount`}
              value={current.amount}
              min={-1}
              max={1}
              step={0.01}
              onChange={(value) => update({ amount: value })}
            />
          </Field>

          {meta?.hasRate === true && (
            <Field label="Rate">
              <RateStrip label={`${control.label} modulation`} hz={current.rate ?? 0.4} onChange={(value) => update({ rate: value })} />
            </Field>
          )}

          <Field label="Smoothing" value={formatValue(current.smoothing ?? 0, 0.01)}>
            <Slider
              label={`${control.label} modulation smoothing`}
              value={current.smoothing ?? 0}
              min={0}
              max={0.95}
              step={0.01}
              onChange={(value) => update({ smoothing: value })}
            />
          </Field>

          <div className={s.modPanelRowFoot}>
            {active ? (
              <Button variant="danger" block onClick={() => onChange(null)}>Remove signal</Button>
            ) : (
              <Button variant="accent" block onClick={() => onChange(current)}>Assign signal</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
