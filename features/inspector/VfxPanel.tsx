'use client';

import { useState, type ReactNode } from 'react';
import { PanelModeButton } from '@/features/panels/PanelModeButton';
import { usePanelCollapsed } from '@/features/panels/usePanelCollapsed';
import {
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  Field,
  FieldActionProvider,
  IconButton,
  Select,
  SectionLabel,
  Slider,
  Toggle,
  Tooltip,
  formatValue,
} from '@/components/ui';
import { ControllerBindButton } from '@/features/controllers/ControllerBindButton';
import { controllerTargetState, useControllerDocument } from '@/features/controllers/useControllerDocument';
import { sampleLiveEffectValue } from '@/lib/control-surface';
import { listEffectDefinitions, getEffectDefinition, getEffectSchema } from '@/lib/effects/registry';
import { MAX_EFFECTS_PER_CHAIN } from '@/lib/effects/types';
import type { EffectDefinition, EffectFamily, EffectInstance } from '@/lib/effects/types';
import type { Modulation, ParamValue } from '@/renderers/control-schema';
import { useTrackLoaded, useMicEnabled } from '@/lib/hooks/useTrackState';
import { ModulatedValue } from './ModulatedValue';
import { ModRow } from './ModulationPanel';
import { sourceMeta } from '@/lib/modulation/bus';
import { useInspectorStore } from '@/stores';
import s from '../features.module.css';

const FAMILY_ORDER: { key: EffectFamily; label: string }[] = [
  { key: 'strobe', label: 'Strobe' },
  { key: 'mirror', label: 'Mirror' },
  { key: 'warp', label: 'Warp' },
  { key: 'slice', label: 'Slice' },
  { key: 'texture', label: 'Texture' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'color', label: 'Color' },
];

function groupByFamily(definitions: EffectDefinition[]): { key: EffectFamily; label: string; items: EffectDefinition[] }[] {
  return FAMILY_ORDER.map((family) => ({ ...family, items: definitions.filter((definition) => definition.family === family.key) }))
    .filter((group) => group.items.length > 0);
}

interface VfxPanelProps {
  itemId: string;
  onClose: () => void;
  embedded?: boolean;
}

export function VfxPanel({ itemId, onClose, embedded = false }: VfxPanelProps) {
  const effects = useInspectorStore((state) => state.effects);
  const addEffect = useInspectorStore((state) => state.addEffect);
  const removeEffect = useInspectorStore((state) => state.removeEffect);
  const reorderEffects = useInspectorStore((state) => state.reorderEffects);
  const setEffectEnabled = useInspectorStore((state) => state.setEffectEnabled);
  const setEffectMix = useInspectorStore((state) => state.setEffectMix);
  const setEffectParam = useInspectorStore((state) => state.setEffectParam);
  const setEffectModulation = useInspectorStore((state) => state.setEffectModulation);
  const controllerDocument = useControllerDocument();

  const trackLoaded = useTrackLoaded(itemId);
  const micEnabled = useMicEnabled(itemId);
  const [collapsed, toggleCollapsed] = usePanelCollapsed('vfx');
  const [browsing, setBrowsing] = useState(false);
  const [expandedMod, setExpandedMod] = useState<{ instanceId: string; paramId: string } | null>(null);

  const atCap = effects.length >= MAX_EFFECTS_PER_CHAIN;
  const definitions = listEffectDefinitions();

  const body = (
    <div className={embedded ? s.modPanelListEmbedded : s.modPanelList}>
      {effects.length === 0 && !browsing && <p className={s.notice}>No effects on this tile yet. Add one below.</p>}

      {effects.map((instance, index) => (
        <VfxRow
          key={instance.id}
          itemId={itemId}
          instance={instance}
          controllerDocument={controllerDocument}
          index={index}
          count={effects.length}
          onEnabledChange={(enabled) => setEffectEnabled(instance.id, enabled)}
          onMixChange={(mix) => setEffectMix(instance.id, mix)}
          onParamChange={(paramId, value) => setEffectParam(instance.id, paramId, value)}
          onMoveUp={index > 0 ? () => reorderEffects(index, index - 1) : undefined}
          onMoveDown={index < effects.length - 1 ? () => reorderEffects(index, index + 1) : undefined}
          onRemove={() => removeEffect(instance.id)}
          expandedModParamId={expandedMod && expandedMod.instanceId === instance.id ? expandedMod.paramId : null}
          onToggleMod={(paramId) =>
            setExpandedMod((current) =>
              current && current.instanceId === instance.id && current.paramId === paramId
                ? null
                : { instanceId: instance.id, paramId },
            )
          }
          onModChange={(paramId, mod) => setEffectModulation(instance.id, paramId, mod)}
          trackLoaded={trackLoaded}
          micEnabled={micEnabled}
        />
      ))}

      {browsing ? (
        <div className={s.modPanelRow}>
          <div className={s.modPanelBody}>
            {definitions.length === 0 && <p className={s.notice}>No effects available yet.</p>}
            {groupByFamily(definitions).map((group) => (
              <div key={group.key}>
                <SectionLabel>{group.label}</SectionLabel>
                {group.items.map((definition) => (
                  <div key={definition.id} className={s.vfxCatalogCard} style={{ borderLeftColor: definition.accentColor ?? 'var(--text-dim)' }}>
                    <Button
                      variant="outline"
                      block
                      onClick={() => {
                        addEffect(definition.id);
                        setBrowsing(false);
                      }}
                    >
                      {definition.title}
                    </Button>
                    {definition.hint && <p className={s.notice}>{definition.hint}</p>}
                  </div>
                ))}
              </div>
            ))}
            <Button variant="ghost" block onClick={() => setBrowsing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="accent" block onClick={() => setBrowsing(true)} disabled={atCap}>
          {atCap ? `Max ${MAX_EFFECTS_PER_CHAIN} effects` : '+ Add Effect'}
        </Button>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <aside className={s.modPanel} data-collapsed={collapsed ? 'true' : undefined} onClick={(event) => event.stopPropagation()} aria-label="VFX">
      <header className={s.codeHeader} data-panel-handle="">
        <IconButton
          label={collapsed ? 'Expand VFX' : 'Collapse VFX'}
          icon={collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          onClick={(e) => toggleCollapsed({ additive: e.shiftKey })}
        />
        <span className={s.codeTitle}>VFX</span>
        <span className={s.codeMeta}>{effects.length} of {MAX_EFFECTS_PER_CHAIN}</span>
        <PanelModeButton id="vfx" />
        <IconButton label="Close VFX" icon={<CloseIcon />} onClick={onClose} />
      </header>
      {body}
    </aside>
  );
}

function VfxRow({
  itemId,
  instance,
  controllerDocument,
  index,
  count,
  onEnabledChange,
  onMixChange,
  onParamChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  expandedModParamId,
  onToggleMod,
  onModChange,
  trackLoaded,
  micEnabled,
}: {
  itemId: string;
  instance: EffectInstance;
  controllerDocument: ReturnType<typeof useControllerDocument>;
  index: number;
  count: number;
  onEnabledChange: (enabled: boolean) => void;
  onMixChange: (mix: number) => void;
  onParamChange: (paramId: string, value: ParamValue) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove: () => void;
  expandedModParamId: string | null;
  onToggleMod: (paramId: string) => void;
  onModChange: (paramId: string, mod: Modulation | null) => void;
  trackLoaded: boolean;
  micEnabled: boolean;
}) {
  const schema = getEffectSchema(instance.effectType);
  const definition = getEffectDefinition(instance.effectType);
  const title = definition?.title ?? instance.effectType;
  const labelColor = definition?.accentColor ?? 'var(--text-dim)';

  return (
    <div className={s.modPanelRow} data-active={instance.enabled ? 'true' : undefined}>
      <div className={s.modPanelRowHead}>
        <Toggle checked={instance.enabled} label={`${title} enabled`} onChange={onEnabledChange} />
        <span className={s.modPanelLabel} style={{ color: labelColor }}>{title}</span>
        <div className={s.vfxRowActions}>
          <span className={s.modPanelSourceTag}>{Math.round(instance.mix * 100)}%</span>
          <IconButton label="Move up" icon={<ChevronDownIcon style={{ transform: 'rotate(180deg)' }} />} onClick={onMoveUp} disabled={!onMoveUp} />
          <IconButton label="Move down" icon={<ChevronDownIcon />} onClick={onMoveDown} disabled={!onMoveDown} />
          <IconButton label="Remove effect" icon={<CloseIcon />} onClick={onRemove} />
        </div>
      </div>

      {schema && (
        <div className={s.modPanelBody}>
          {schema.controls
            .filter((control) => control.kind === 'slider' || control.kind === 'select' || control.kind === 'toggle')
            .map((control) => {
              const isMix = control.id === 'mix';
              const raw = isMix ? instance.mix : instance.params[control.id];
              const activeMod = instance.mod[control.id];
              const modExpanded = expandedModParamId === control.id;
              const controller = controllerTargetState(controllerDocument, itemId, control.id, instance.id);
              const controllerAction = (
                <ControllerBindButton
                  control={control}
                  itemId={itemId}
                  effectInstanceId={instance.id}
                  targetLabel={`${title} · ${control.label}`}
                />
              );

              let field: ReactNode;
              if (control.kind === 'slider') {
                const value = typeof raw === 'number' ? raw : control.default;
                const live = controller.active || Boolean(activeMod);
                field = (
                  <Field
                    label={control.label}
                    value={formatValue(value, control.step ?? 0.01)}
                    valueNode={controller.active ? (
                      <ModulatedValue
                        cardId={itemId}
                        effectInstanceId={instance.id}
                        controlId={control.id}
                        step={control.step ?? 0.01}
                        fallback={value}
                      />
                    ) : undefined}
                  >
                    <Slider
                      label={control.label}
                      value={value}
                      min={control.min}
                      max={control.max}
                      step={control.step ?? 0.01}
                      scale={control.scale}
                      modulated={live}
                      liveValue={controller.active ? () => sampleLiveEffectValue(itemId, instance.id, control.id) : undefined}
                      onChange={(next) => (isMix ? onMixChange(next) : onParamChange(control.id, next))}
                    />
                  </Field>
                );
              } else if (control.kind === 'select') {
                const value = typeof raw === 'string' ? raw : control.default;
                field = (
                  <Field label={control.label}>
                    <Select label={control.label} value={value} options={control.options} onChange={(next) => onParamChange(control.id, next)} />
                  </Field>
                );
              } else {
                const value = typeof raw === 'boolean' ? raw : control.default;
                field = (
                  <Field label={control.label}>
                    <Toggle checked={value} label={control.label} onChange={(next) => onParamChange(control.id, next)} />
                  </Field>
                );
              }

              const hardwareMod = controller.hasModulation;
              const modRouted = Boolean(activeMod) || hardwareMod;
              const modLabel = activeMod && controller.shortLabel
                ? `${sourceMeta(activeMod.source)?.label} + ${controller.shortLabel}`
                : activeMod
                  ? sourceMeta(activeMod.source)?.label
                  : hardwareMod
                    ? controller.shortLabel
                    : null;

              return (
                <div key={control.id}>
                  <FieldActionProvider value={controllerAction}>{field}</FieldActionProvider>
                  {control.modulatable && (
                    <div className={s.vfxModSection} data-routed={modRouted ? 'true' : undefined}>
                      <Tooltip content={modLabel ? `Active — ${modLabel}` : `Modulate ${control.label}`}>
                        <button
                          type="button"
                          className={s.vfxModSectionHead}
                          aria-label={`${modExpanded ? 'Collapse' : 'Expand'} modulation for ${control.label}`}
                          aria-expanded={modExpanded}
                          onClick={() => onToggleMod(control.id)}
                        >
                          {modExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                          <span className={s.modPanelDot} data-on={modRouted ? 'true' : undefined} />
                          <span>{modLabel ?? 'Modulate'}</span>
                        </button>
                      </Tooltip>
                      {modExpanded && (
                        <ModRow
                          control={control}
                          active={activeMod}
                          controllerState={controller}
                          trackLoaded={trackLoaded}
                          micEnabled={micEnabled}
                          expanded
                          hideHeader
                          onToggleExpand={() => onToggleMod(control.id)}
                          onChange={(mod) => onModChange(control.id, mod)}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}

          {count > 1 && <p className={s.notice}>Position {index + 1} of {count} — order affects the result.</p>}
        </div>
      )}
    </div>
  );
}
