import type { ParamValue } from '@/renderers/control-schema';
import { getPool } from '@/lib/render/pool';

function parameterKey(cardId: string, controlId: string): string {
  return `${cardId}:parameter:${controlId}`;
}

function effectKey(cardId: string, effectInstanceId: string, controlId: string): string {
  return `${cardId}:effect:${effectInstanceId}:${controlId}`;
}

/**
 * Phase 4.97F.2 presentation cache.
 *
 * Controller Live mode intentionally bypasses React/Inspector persistence for
 * performance. This tiny cache mirrors only the values that were actually
 * accepted by the runtime so UI readouts can follow hardware without turning
 * every MIDI CC into a Zustand/database update.
 */
class ControllerPresentationRegistry {
  private parameterValues = new Map<string, ParamValue>();
  private effectValues = new Map<string, ParamValue>();

  setParameter(cardId: string, controlId: string, value: ParamValue): void {
    this.parameterValues.set(parameterKey(cardId, controlId), value);
  }

  setEffect(cardId: string, effectInstanceId: string, controlId: string, value: ParamValue): void {
    this.effectValues.set(effectKey(cardId, effectInstanceId, controlId), value);
  }

  clearParameter(cardId: string, controlId: string): void {
    this.parameterValues.delete(parameterKey(cardId, controlId));
  }

  clearEffect(cardId: string, effectInstanceId: string, controlId: string): void {
    this.effectValues.delete(effectKey(cardId, effectInstanceId, controlId));
  }

  sampleParameter(cardId: string, controlId: string): ParamValue | null {
    return this.parameterValues.get(parameterKey(cardId, controlId)) ?? null;
  }

  sampleEffect(cardId: string, effectInstanceId: string, controlId: string): ParamValue | null {
    return this.effectValues.get(effectKey(cardId, effectInstanceId, controlId)) ?? null;
  }

  clear(): void {
    this.parameterValues.clear();
    this.effectValues.clear();
  }
}

let registry: ControllerPresentationRegistry | null = null;

export function getControllerPresentationRegistry(): ControllerPresentationRegistry {
  if (!registry) registry = new ControllerPresentationRegistry();
  return registry;
}


export function sampleControllerParameterValue(cardId: string | null, controlId: string): number | null {
  if (!cardId) return null;
  const value = getControllerPresentationRegistry().sampleParameter(cardId, controlId);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Effective numeric value shown by the asset Inspector. Traditional signal
 * modulation wins because RendererPool already layers it over the controller-
 * adjusted runtime base. If no LFO/audio/mic route exists, fall back to the
 * controller presentation cache.
 */
export function sampleLiveParameterValue(cardId: string | null, controlId: string): number | null {
  if (!cardId) return null;
  const signalValue = getPool().sampleModulated(cardId, controlId);
  if (signalValue !== null) return signalValue;
  const controllerValue = getControllerPresentationRegistry().sampleParameter(cardId, controlId);
  return typeof controllerValue === 'number' && Number.isFinite(controllerValue)
    ? controllerValue
    : null;
}

/**
 * VFX controller value. The existing VFX signal path is resolved inside the
 * compositor and is intentionally not re-sampled here (double-sampling noise
 * or smoothing would alter the render). F.2 therefore mirrors the accepted
 * controller base exactly; signal+controller final-value certification is
 * part of the 4.97G hardening matrix.
 */
export function sampleLiveEffectValue(
  cardId: string | null,
  effectInstanceId: string,
  controlId: string,
): number | null {
  if (!cardId) return null;
  const value = getControllerPresentationRegistry().sampleEffect(cardId, effectInstanceId, controlId);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
