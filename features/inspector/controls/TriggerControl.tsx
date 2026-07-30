import { Button, Field } from '@/components/ui';
import type { TriggerControl as TriggerControlType } from '@/renderers/control-schema';

interface Props {
  control: TriggerControlType;
  onChange: (v: null) => void;
}

/** No value, no dirty state, no reset — a trigger fires and forgets. */
export function TriggerControlRow({ control, onChange }: Props) {
  return (
    <Field label={control.label} hint={control.hint}>
      <Button variant={control.danger ? 'danger' : 'outline'} block onClick={() => onChange(null)}>
        {control.label}
      </Button>
    </Field>
  );
}
