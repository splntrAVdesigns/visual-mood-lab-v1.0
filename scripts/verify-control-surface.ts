/**
 * Phase 4.97A deterministic foundation verifier.
 *
 * Run with: npm run verify:control-surface
 * This intentionally uses an in-memory runtime adapter so the signal/binding
 * contracts can be tested without requiring physical MIDI/gamepad hardware.
 */

import { ControlSurfaceBindingEngine } from '../lib/control-surface/binding-engine';
import { MockControlSurface, createMockDeviceProfile, createMockGamepadProfile } from '../lib/control-surface/mock';
import { parseControlSurfaceDocument, serializeControlSurfaceDocument } from '../lib/control-surface/persistence';
import { ControllerSourceRegistry } from '../lib/control-surface/source-registry';
import { resolveTargetCardId } from '../lib/control-surface/targets';
import type {
  ControllerBinding,
  ControllerDispatchOutcome,
  ControlSignal,
  ControlSurfaceDocument,
  ControlSurfaceRuntimeAdapter,
} from '../lib/control-surface/types';

class VerifyRuntime implements ControlSurfaceRuntimeAdapter {
  direct: string[] = [];
  modulation: string[] = [];
  actions: string[] = [];
  panics = 0;

  applyDirect(binding: ControllerBinding, value01: number): ControllerDispatchOutcome {
    this.direct.push(`${binding.id}:${value01.toFixed(4)}`);
    return { status: 'applied' };
  }

  applyModulation(binding: ControllerBinding, value01: number): ControllerDispatchOutcome {
    this.modulation.push(`${binding.id}:${value01.toFixed(4)}`);
    return { status: 'applied' };
  }

  dispatchAction(binding: ControllerBinding, signal: ControlSignal): ControllerDispatchOutcome {
    this.actions.push(`${binding.id}:${signal.kind}`);
    return { status: 'applied' };
  }

  clearBinding(): void {}

  panic(): void {
    this.panics += 1;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`4.97A verification failed: ${message}`);
}

const runtime = new VerifyRuntime();
const sources = new ControllerSourceRegistry();
const engine = new ControlSurfaceBindingEngine(runtime, sources);
const mock = new MockControlSurface(engine);

const bindings: ControllerBinding[] = [
  {
    id: 'direct-focused',
    virtualControlId: 'mock.knob.1',
    path: 'direct',
    target: { scope: 'focused', domain: 'parameter', controlId: 'scale' },
    writeMode: 'live',
  },
  {
    id: 'mod-pinned',
    virtualControlId: 'mock.knob.2',
    path: 'modulation',
    target: { scope: 'pinned', cardId: 'tile-b', domain: 'parameter', controlId: 'distortion' },
    amount: 0.25,
  },
  {
    id: 'action-trigger',
    virtualControlId: 'mock.pad.1',
    path: 'action',
    target: { scope: 'focused', domain: 'action', actionId: 'tile.trigger', controlId: 'reseed' },
    actionMode: 'trigger',
  },
];
engine.setBindings(bindings);

// Every normalized signal shape reaches the transport-independent engine.
mock.absolute('mock.knob.1', 0.75);
mock.bipolar('mock.knob.1', -0.5);
mock.relative('mock.knob.1', 0.1);
mock.absolute('mock.knob.2', 0.2);
mock.gate('mock.pad.1', true, 0.8);
mock.gate('mock.pad.1', false, 0);
mock.trigger('mock.pad.1', 1);

assert(runtime.direct.length === 3, 'absolute, bipolar and relative Direct signals should route.');
assert(runtime.modulation.length === 1, 'Modulation path should be represented independently.');
assert(runtime.actions.length === 2, 'gate press and trigger should dispatch while gate release should not retrigger.');
assert(sources.sample('mock.knob.1') >= 0 && sources.sample('mock.knob.1') <= 1, 'source registry must stay normalized.');

assert(resolveTargetCardId({ scope: 'focused', domain: 'parameter', controlId: 'scale' }, 'tile-a') === 'tile-a', 'Focused target should follow selected tile.');
assert(resolveTargetCardId({ scope: 'pinned', cardId: 'tile-b', domain: 'parameter', controlId: 'scale' }, 'tile-a') === 'tile-b', 'Pinned target should ignore focus changes.');

const profile = createMockDeviceProfile();
const gamepadProfile = createMockGamepadProfile();
assert(profile.banks.every((bank) => bank.controls.length === 8), 'mock MIDI profile must enforce eight controls per bank.');
assert(gamepadProfile.banks.every((bank) => bank.controls.length === 8), 'mock Gamepad profile must enforce eight controls per bank.');

const document: ControlSurfaceDocument = {
  schemaVersion: 1,
  profiles: [profile, gamepadProfile],
  mappings: [{ id: 'verify-map', profileId: profile.id, activeBankId: profile.banks[0]!.id, writeMode: 'live', bindings }],
};
const roundTrip = parseControlSurfaceDocument(serializeControlSurfaceDocument(document));
assert(roundTrip.warnings.length === 0, `clean persistence round-trip should have no warnings: ${roundTrip.warnings.join('; ')}`);
assert(roundTrip.document.profiles.length === 2, 'MIDI and Gamepad profiles should survive persistence round-trip.');
assert(roundTrip.document.mappings[0]?.bindings.length === bindings.length, 'bindings should survive persistence round-trip.');

engine.panic();
assert(runtime.panics === 1, 'Panic must reach the runtime exactly once.');
assert(sources.sample('mock.knob.1') === 0.5, 'Panic must reset controller source state to neutral.');

console.log('✓ Phase 4.97A control-surface contracts verified');
console.log(`  Direct dispatches: ${runtime.direct.length}`);
console.log(`  Modulation dispatches: ${runtime.modulation.length}`);
console.log(`  Action dispatches: ${runtime.actions.length}`);
console.log('  Focused/Pinned resolution: PASS');
console.log('  8-controls-per-bank model: PASS');
console.log('  Versioned persistence round-trip: PASS');
console.log('  Panic neutral reset: PASS');
