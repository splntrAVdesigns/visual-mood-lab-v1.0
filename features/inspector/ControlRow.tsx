'use client';

import { LockButton } from './RollLocks';
import type { Control, ParamValue } from '@/renderers/control-schema';
import { useInspectorStore } from '@/stores';
import { ControllerBindButton } from '@/features/controllers/ControllerBindButton';
import { useControllerTargetState } from '@/features/controllers/useControllerDocument';
import { FieldActionProvider } from '@/components/ui';
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
import { FileControlRow } from './controls/FileControl';

interface ControlRowProps {
  control: Control;
  value: ParamValue;
  dirty: boolean;
  onChange: (value: ParamValue) => void;
  onReset: () => void;
  forceDisabled?: boolean;
}

export function ControlRow({ control, value, dirty, onChange, onReset, forceDisabled }: ControlRowProps) {
  const modulated = useInspectorStore((st) => Boolean(st.mod[control.id]));
  const itemId = useInspectorStore((st) => st.itemId);
  const controller = useControllerTargetState(itemId, control.id);

  if (control.disabled || forceDisabled) {
    return (
      <div className={s.controlRow} data-disabled="true">
        <ControlBody control={control} value={value} dirty={false} onChange={() => {}} onReset={() => {}} />
      </div>
    );
  }

  const controllerAction = itemId ? <ControllerBindButton control={control} itemId={itemId} /> : null;
  // The padlock rides in the same label-row slot as the MIDI pill.
  const fieldActions = (
    <>
      <LockButton control={control} />
      {controllerAction}
    </>
  );

  return (
    <div
      className={s.controlRow}
      data-modulated={modulated || controller.active ? 'true' : undefined}
      data-lockable="true"
    >
      <FieldActionProvider value={fieldActions}>
        <ControlBody
          control={control}
          value={value}
          dirty={dirty}
          onChange={onChange}
          onReset={onReset}
          controllerActive={controller.active}
          cardId={itemId}
        />
      </FieldActionProvider>
    </div>
  );
}

function ControlBody({
  control,
  value,
  dirty,
  onChange,
  onReset,
  controllerActive = false,
  cardId = null,
}: ControlRowProps & { controllerActive?: boolean; cardId?: string | null }) {
  switch (control.kind) {
    case 'slider':
      return <SliderControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} controllerActive={controllerActive} />;
    case 'stepper':
      return <StepperControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} controllerActive={controllerActive} cardId={cardId} />;
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
    case 'file':
      return <FileControlRow control={control} value={value} dirty={dirty} onChange={onChange} onReset={onReset} />;
  }
}
