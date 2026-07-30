import { Button, Field } from '@/components/ui';
import type { TextureControl as TextureControlType, ParamValue } from '@/renderers/control-schema';

interface Props {
  control: TextureControlType;
  value: ParamValue;
  dirty: boolean;
  onReset: () => void;
}

/** Asset-picker UI is deferred — noted honestly rather than hidden. */
export function TextureControlRow({ control, value, dirty, onReset }: Props) {
  return (
    <Field
      label={control.label}
      hint={control.hint}
      dirty={dirty}
      onReset={onReset}
      value={typeof value === 'string' ? 'linked' : 'none'}
    >
      <Button variant="outline" block disabled>
        Choose asset — coming soon
      </Button>
    </Field>
  );
}
