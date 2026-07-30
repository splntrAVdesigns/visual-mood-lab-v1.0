'use client';

import { Field, Select, Slider, TextInput, Toggle, Button, formatValue } from '@/components/ui';
import type { Control, ParamValue, RGBA, Vec2, Vec3 } from '@/renderers/control-schema';
import s from '../features.module.css';

interface ControlRowProps {
  control: Control;
  value: ParamValue;
  dirty: boolean;
  onChange: (value: ParamValue) => void;
  onReset: () => void;
}

/**
 * One row per control, dispatched on `kind`. This function is the entire
 * reason the inspector needs no per-asset-type code: a shader, a video, and a
 * p5 sketch all arrive here as the same shape.
 *
 * Phase 0 renders every kind with the primitives. Phase 3 upgrades three of
 * them to richer widgets (colour picker, XY pad, texture browser) — a
 * local change to this file, nothing else.
 */
export function ControlRow({ control, value, dirty, onChange, onReset }: ControlRowProps) {
  const common = { label: control.label, hint: control.hint, dirty, onReset };

  switch (control.kind) {
    case 'slider': {
      const v = num(value, control.default);
      return (
        <Field
          {...common}
          value={`${formatValue(v, control.step ?? 0.01)}${control.unit ? ` ${control.unit}` : ''}`}
        >
          <Slider
            label={control.label}
            value={v}
            min={control.min}
            max={control.max}
            step={control.step}
            scale={control.scale}
            modulated={false}
            onChange={onChange}
          />
        </Field>
      );
    }

    case 'stepper': {
      const v = num(value, control.default);
      return (
        <Field {...common} value={String(v)}>
          <Slider
            label={control.label}
            value={v}
            min={control.min}
            max={control.max}
            step={control.step ?? 1}
            onChange={onChange}
          />
        </Field>
      );
    }

    case 'toggle':
      return (
        <Field {...common} value={value ? 'on' : 'off'}>
          <Toggle
            label={control.label}
            checked={Boolean(value)}
            onChange={onChange}
          />
        </Field>
      );

    case 'select': {
      const v = typeof value === 'string' ? value : control.default;
      return (
        <Field {...common}>
          <Select
            label={control.label}
            value={v}
            options={control.options}
            onChange={onChange}
          />
        </Field>
      );
    }

    case 'color': {
      const c = isRGBA(value) ? value : control.default;
      return (
        <Field {...common} value={control.alpha ? `${Math.round(c.a * 100)}%` : undefined}>
          <span className={s.swatch}>
            <span
              className={s.swatchChip}
              style={{ background: `rgba(${to255(c.r)}, ${to255(c.g)}, ${to255(c.b)}, ${c.a})` }}
            />
            <span className={s.swatchHex}>{toHex(c)}</span>
          </span>
        </Field>
      );
    }

    case 'xy': {
      const v = isVec(value, 2) ? (value as Vec2) : control.default;
      return (
        <Field {...common} value={`${fmt(v[0])}, ${fmt(v[1])}`}>
          <span className={s.vecRow}>
            {(['X', 'Y'] as const).map((axis, i) => (
              <span key={axis} className={s.vecAxis}>
                <span className={s.vecAxisLabel}>{axis}</span>
                <Slider
                  label={`${control.label} ${axis}`}
                  value={v[i] as number}
                  min={control.min[i] as number}
                  max={control.max[i] as number}
                  step={control.step}
                  onChange={(n) => {
                    const next: Vec2 = [v[0], v[1]];
                    next[i] = n;
                    onChange(next);
                  }}
                />
              </span>
            ))}
          </span>
        </Field>
      );
    }

    case 'vec3': {
      const v = isVec(value, 3) ? (value as Vec3) : control.default;
      const labels = control.axisLabels ?? ['X', 'Y', 'Z'];
      return (
        <Field {...common} value={`${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}`}>
          <span className={s.vecRow}>
            {labels.map((axis, i) => (
              <span key={axis} className={s.vecAxis}>
                <span className={s.vecAxisLabel}>{axis}</span>
                <Slider
                  label={`${control.label} ${axis}`}
                  value={v[i] as number}
                  min={control.min[i] as number}
                  max={control.max[i] as number}
                  step={control.step}
                  onChange={(n) => {
                    const next: Vec3 = [v[0], v[1], v[2]];
                    next[i] = n;
                    onChange(next);
                  }}
                />
              </span>
            ))}
          </span>
        </Field>
      );
    }

    case 'text':
      return (
        <Field {...common}>
          <TextInput
            label={control.label}
            mono={control.monospace}
            value={typeof value === 'string' ? value : control.default}
            maxLength={control.maxLength}
            onChange={onChange}
          />
        </Field>
      );

    case 'trigger':
      return (
        <Field label={control.label} hint={control.hint}>
          <Button
            variant={control.danger ? 'danger' : 'outline'}
            block
            onClick={() => onChange(null)}
          >
            {control.label}
          </Button>
        </Field>
      );

    case 'texture':
      return (
        <Field {...common} value={typeof value === 'string' ? 'linked' : 'none'}>
          <Button variant="outline" block disabled>
            Choose asset — Phase 3
          </Button>
        </Field>
      );
  }
}

/* ------------------------------------------------------------------ *
 * Value coercion helpers — the store already validates, these guard the
 * render path against a schema/state mismatch during hot reload.
 * ------------------------------------------------------------------ */

function num(v: ParamValue, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

function isRGBA(v: ParamValue): v is RGBA {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'r' in v;
}

function isVec(v: ParamValue, n: number): boolean {
  return Array.isArray(v) && v.length === n;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function to255(n: number): number {
  return Math.round(n * 255);
}

function toHex(c: RGBA): string {
  const hex = (n: number) => to255(n).toString(16).padStart(2, '0');
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}
