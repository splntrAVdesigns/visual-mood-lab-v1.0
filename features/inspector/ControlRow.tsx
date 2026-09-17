'use client';

import type { Control, ParamValue } from '@/renderers/control-schema';
import { useInspectorStore } from '@/stores';
import { ControllerBindButton } from '@/features/controllers/ControllerBindButton';
import s from '../features.module.css';
import { SliderControlRow } from './controls/SliderControl';
import { StepperControlRow } from './controls/StepperControl';
import { ToggleControlRow } from './controls/ToggleControl';
import { SelectControlRow } from './controls/SelectControl';
import { ButtonStripControlRow } from './controls/ButtonStripControl';
import { ColorControlRow } from './controls/ColorControl';
import { XYControlRow } from './controls/XYControl';
import { Vec3ControlRow } from './controls/Vec3Control';
import { TextControlRow } from './controls/TextControl';
import { TriggerControlRow } from './controls/TriggerControl';
import { TextureControlRow } from './controls/TextureControl';
import { FontControlRow } from './controls/FontControl';

interface ControlRowProps {
  control: Control;
  value: ParamValue;
  dirty: boolean;
  onChange: (value: ParamValue) => void;
  onReset: () => void;
  /**
   * Computed by the caller via isDisabledByState(control, params), same
   * as isVisible(control, params) already is for filtering which rows
   * render at all — this component never receives the full ParamState
   * itself (only its own control's value), so a disabledIf predicate
   * that reads a SIBLING control can't be evaluated in here.
   */
  forceDisabled?: boolean;
}

/**
 * Dispatches to one component per ControlKind. Phase 4.97C adds one generic
 * controller affordance at THIS schema boundary rather than teaching every
 * individual slider/toggle/select implementation about MIDI. That preserves
 * the Inspector's renderer-agnostic contract: any eligible control on any
 * tile gets Learn automatically.
 */
export function ControlRow({ control, value, dirty, onChange, onReset, forceDisabled }: ControlRowProps) {
  const modulated = useInspectorStore((st) => Boolean(st.mod[control.id]));
  const itemId = useInspectorStore((st) => st.itemId);

  if (control.disabled || forceDisabled) {
    return (
      <div className={s.controlRow} data-disabled="true">
        <ControlBody control={control} value={value} dirty={false} onChange={() => {}} onReset={() => {}} />
      </div>
    );
  }

  return (
    <div
      className={s.controlRow}
      data-modulated={modulated ? 'true' : undefined}
      style={{ position: 'relative' }}
    >
      <ControlBody control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />
      {itemId && <ControllerBindButton control={control} itemId={itemId} />}
    </div>
  );
}

function ControlBody({ control, value, dirty, onChange, onReset }: ControlRowProps) {
  switch (control.kind) {
    case 'slider':
      return <SliderControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />;
    case 'stepper':
      return <StepperControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />;
    case 'toggle':
      return <ToggleControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />;
    case 'select':
      return control.displayStyle === 'strip'
        ? <ButtonStripControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />
        : <SelectControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />;
    case 'color':
      return <ColorControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />;
    case 'xy':
      return <XYControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />;
    case 'vec3':
      return <Vec3ControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />;
    case 'text':
      return <TextControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />;
    case 'trigger':
      return <TriggerControlRow control={control} onChange={onChange} />;
    case 'texture':
      return <TextureControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />;
    case 'font':
      return <FontControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />;
  }
}
