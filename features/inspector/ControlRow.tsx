'use client';

import type { Control, ParamValue } from '@/renderers/control-schema';
import { useInspectorStore } from '@/stores';
import s from '../features.module.css';
import { SliderControlRow } from './controls/SliderControl';
import { StepperControlRow } from './controls/StepperControl';
import { ToggleControlRow } from './controls/ToggleControl';
import { SelectControlRow } from './controls/SelectControl';
import { ColorControlRow } from './controls/ColorControl';
import { XYControlRow } from './controls/XYControl';
import { Vec3ControlRow } from './controls/Vec3Control';
import { TextControlRow } from './controls/TextControl';
import { TriggerControlRow } from './controls/TriggerControl';
import { TextureControlRow } from './controls/TextureControl';

interface ControlRowProps {
  control: Control;
  value: ParamValue;
  dirty: boolean;
  onChange: (value: ParamValue) => void;
  onReset: () => void;
}

/**
 * Dispatches to one component per `ControlKind`, in `./controls/`.
 *
 * This is the entire reason the inspector needs no per-asset-type code: a
 * shader, a video, and a p5 sketch all arrive here as the same shape, and
 * adding an eleventh control kind is one new file plus one new case here —
 * nothing else in the app changes.
 *
 * Modulation used to be a right-click popover triggered from this row. It's
 * retired: routing now lives entirely in the Modulate sidecar panel, opened
 * from the focused view's header. This row still shows the accent indicator
 * when a control IS modulated — that stays a useful at-a-glance signal — it
 * just no longer owns any interaction of its own.
 */
export function ControlRow({ control, value, dirty, onChange, onReset }: ControlRowProps) {
  const modulated = useInspectorStore((st) => Boolean(st.mod[control.id]));

  return (
    <div className={s.controlRow} data-modulated={modulated ? 'true' : undefined}>
      <ControlBody control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />
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
      return <SelectControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />;
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
      return <TextureControlRow control={control} value={value} dirty={dirty} onReset={onReset} />;
  }
}
