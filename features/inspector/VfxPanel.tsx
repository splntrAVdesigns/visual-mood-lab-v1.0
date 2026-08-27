'use client';

import { useState } from 'react';
import { Button, ChevronDownIcon, ChevronRightIcon, CloseIcon, Field, IconButton, Slider, Toggle, Tooltip, formatValue } from '@/components/ui';
import { listEffectDefinitions, getEffectDefinition, getEffectSchema } from '@/lib/effects/registry';
import { MAX_EFFECTS_PER_CHAIN } from '@/lib/effects/types';
import type { EffectInstance } from '@/lib/effects/types';
import type { Modulation } from '@/renderers/control-schema';
import { useTrackLoaded, useMicEnabled } from '@/lib/hooks/useTrackState';
import { ModRow } from './ModulationPanel';
import { sourceMeta } from '@/lib/modulation/bus';
import { useInspectorStore } from '@/stores';
import s from '../features.module.css';

interface VfxPanelProps {
  itemId: string;
  onClose: () => void;
  /** Same purpose as SoundPanel/ModulationPanel's embedded prop — render
      inline in the mobile sheet's scroll region rather than as a fixed
      sidecar. */
  embedded?: boolean;
}

/**
 * The VFX rack. Structurally the third twin of ModulationPanel/SoundPanel
 * — same sidecar/embedded duality, same CSS classes, same "one panel per
 * tile concern" shape — but the chain concept (ordered, capped, add/
 * remove/reorder) is genuinely new, not a copy-paste of either.
 *
 * REVISED (post-Part-1 testing): row bodies used to be collapsed behind a
 * click on the row head, mirroring ModulationPanel's ModRow. That pattern
 * makes sense there — dozens of asset controls, most people never touch
 * most of them, collapsing is what keeps the panel usable. It made no
 * sense here: a chain tops out at MAX_EFFECTS_PER_CHAIN effects with a
 * handful of params each, added one at a time, deliberately. Collapsing
 * something you just explicitly asked to add, behind a click target that
 * (in the version that shipped) also had no visual affordance that it WAS
 * a click target, read as "toggling this effect does nothing" — which is
 * exactly what got reported. Every added effect's controls now render
 * immediately, no click required. Simpler code, too — no expand state to
 * track at the row level at all anymore.
 *
 * Deliberately does NOT reuse ControlRow for a param's base-value editor:
 * ControlRow reads `inspectorStore.mod[control.id]` internally to know if
 * a control is currently modulated, which is the ASSET's mod state keyed
 * by the asset's own control ids — an effect param id ("rate") could
 * collide with an unrelated asset param of the same name and read the
 * wrong modulation state entirely. Every param Dark Strobe declares is a
 * plain slider, so this renders those directly with Field+Slider instead
 * — worth generalizing to the full ControlRow dispatch (color/toggle/
 * select kinds) once an effect that actually needs one of those ships.
 */
export function VfxPanel({ itemId, onClose, embedded = false }: VfxPanelProps) {
  const effects = useInspectorStore((st) => st.effects);
  const addEffect = useInspectorStore((st) => st.addEffect);
  const removeEffect = useInspectorStore((st) => st.removeEffect);
  const reorderEffects = useInspectorStore((st) => st.reorderEffects);
  const setEffectEnabled = useInspectorStore((st) => st.setEffectEnabled);
  const setEffectMix = useInspectorStore((st) => st.setEffectMix);
  const setEffectParam = useInspectorStore((st) => st.setEffectParam);
  const setEffectModulation = useInspectorStore((st) => st.setEffectModulation);

  const trackLoaded = useTrackLoaded(itemId);
  const micEnabled = useMicEnabled(itemId);

  const [collapsed, setCollapsed] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [expandedMod, setExpandedMod] = useState<{ instanceId: string; paramId: string } | null>(null);

  const atCap = effects.length >= MAX_EFFECTS_PER_CHAIN;
  const definitions = listEffectDefinitions();

  const body = (
    <div className={embedded ? s.modPanelListEmbedded : s.modPanelList}>
      {effects.length === 0 && !browsing && (
        <p className={s.notice}>No effects on this tile yet. Add one below.</p>
      )}

      {effects.map((instance, index) => (
        <VfxRow
          key={instance.id}
          instance={instance}
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
            setExpandedMod((cur) =>
              cur && cur.instanceId === instance.id && cur.paramId === paramId ? null : { instanceId: instance.id, paramId },
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
            {definitions.map((def) => (
              <div key={def.id}>
                <Button
                  variant="outline"
                  block
                  onClick={() => {
                    addEffect(def.id);
                    setBrowsing(false);
                  }}
                >
                  {def.title}
                </Button>
                {def.hint && <p className={s.notice}>{def.hint}</p>}
              </div>
            ))}
            <Button variant="ghost" block onClick={() => setBrowsing(false)}>
              Cancel
            </Button>
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
    <aside className={s.modPanel} data-collapsed={collapsed ? 'true' : undefined} onClick={(e) => e.stopPropagation()} aria-label="VFX">
      <header className={s.codeHeader}>
        <IconButton
          label={collapsed ? 'Expand VFX' : 'Collapse VFX'}
          icon={collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          onClick={() => setCollapsed((c) => !c)}
        />
        <span className={s.codeTitle}>VFX</span>
        <span className={s.codeMeta}>
          {effects.length} of {MAX_EFFECTS_PER_CHAIN}
        </span>
        <IconButton label="Close VFX" icon={<CloseIcon />} onClick={onClose} />
      </header>
      {body}
    </aside>
  );
}

function VfxRow({
  instance,
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
  instance: EffectInstance;
  index: number;
  count: number;
  onEnabledChange: (enabled: boolean) => void;
  onMixChange: (mix: number) => void;
  onParamChange: (paramId: string, value: number) => void;
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
  const title = getEffectDefinition(instance.effectType)?.title ?? instance.effectType;

  return (
    <div className={s.modPanelRow} data-active={instance.enabled ? 'true' : undefined}>
      <div className={s.modPanelRowHead}>
        <Toggle checked={instance.enabled} label={`${title} enabled`} onChange={onEnabledChange} />
        <span className={s.modPanelLabel}>{title}</span>
        <div className={s.vfxRowActions}>
          <span className={s.modPanelSourceTag}>{Math.round(instance.mix * 100)}%</span>
          <IconButton
            label="Move up"
            icon={<ChevronDownIcon style={{ transform: 'rotate(180deg)' }} />}
            onClick={onMoveUp}
            disabled={!onMoveUp}
          />
          <IconButton label="Move down" icon={<ChevronDownIcon />} onClick={onMoveDown} disabled={!onMoveDown} />
          <IconButton label="Remove effect" icon={<CloseIcon />} onClick={onRemove} />
        </div>
      </div>

      {schema && (
        <div className={s.modPanelBody}>
          {schema.controls
            .filter((c) => c.kind === 'slider')
            .map((control) => {
              const isMix = control.id === 'mix';
              const value = isMix ? instance.mix : (typeof instance.params[control.id] === 'number' ? (instance.params[control.id] as number) : control.default);
              const activeMod = instance.mod[control.id];
              const modExpanded = expandedModParamId === control.id;

              return (
                <div key={control.id}>
                  <Field label={control.label} value={formatValue(value, control.step ?? 0.01)}>
                    <Slider
                      label={control.label}
                      value={value}
                      min={control.min}
                      max={control.max}
                      step={control.step ?? 0.01}
                      onChange={(v) => (isMix ? onMixChange(v) : onParamChange(control.id, v))}
                    />
                  </Field>
                  {control.modulatable && (
                    <div className={s.vfxModSection} data-routed={activeMod ? 'true' : undefined}>
                      <Tooltip content={activeMod ? `Modulated — ${sourceMeta(activeMod.source)?.label}` : `Modulate ${control.label}`}>
                        <button
                          type="button"
                          className={s.vfxModSectionHead}
                          aria-label={`${modExpanded ? 'Collapse' : 'Expand'} modulation for ${control.label}`}
                          aria-expanded={modExpanded}
                          onClick={() => onToggleMod(control.id)}
                        >
                          {modExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                          <span className={s.modPanelDot} data-on={activeMod ? 'true' : undefined} />
                          <span>{activeMod ? sourceMeta(activeMod.source)?.label : 'Modulate'}</span>
                        </button>
                      </Tooltip>
                      {modExpanded && (
                        <ModRow
                          control={control}
                          active={activeMod}
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

          {count > 1 && (
            <p className={s.notice}>
              Position {index + 1} of {count} — order affects the result.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
