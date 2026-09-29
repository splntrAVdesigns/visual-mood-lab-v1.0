/** Deterministic hardware-free acceptance checks for Phase 4.97.1. */
import assert from 'node:assert/strict';
import { GamepadGestureState } from '../lib/control-surface/gamepad-gestures';
import { applyGamepadLearnBinding } from '../lib/control-surface/gamepad-learn';
import { parseControlSurfaceDocument, createEmptyControlSurfaceDocument, serializeControlSurfaceDocument } from '../lib/control-surface/persistence';
import { removeControllerBinding, updateControllerBinding, unlinkControllerPair } from '../lib/control-surface/learn';
import { GamepadRuntime } from '../lib/control-surface/gamepad-runtime';
import { ControlSurfaceBindingEngine } from '../lib/control-surface/binding-engine';
import type { ControllerBinding, ControlSurfaceRuntimeAdapter, GestureCommand, GamepadGesture } from '../lib/control-surface/types';
import type { GamepadLearnCandidate, GamepadLike } from '../lib/control-surface/gamepad-types';

const axis: GamepadGesture = { mode: 'relative', doubleTap: false };
const decrease: GamepadGesture = { mode: 'decrease', doubleTap: true };
const increase: GamepadGesture = { mode: 'increase', doubleTap: true };
for (const gesture of [axis, decrease, increase]) {
  const state = new GamepadGestureState();
  let steps = 0;
  for (let n = 0; n < 20; n++) {
    steps += state.sample(1, gesture, n * 400).filter(c => c.kind === 'step').length;
    state.sample(0, gesture, n * 400 + 70);
  }
  assert.equal(steps, 20, `${gesture.mode}: one step for each of 20 excursions`);
}
for (const gesture of [decrease, increase]) {
  const state = new GamepadGestureState();
  state.sample(1, gesture, 0); state.sample(0, gesture, 50);
  assert(state.sample(1, gesture, 150).some(c => c.kind === 'reset'));
  assert.deepEqual(state.sample(1, gesture, 800), [], 'double-tap press cannot become a hold');
  assert.equal(state.sample(0, gesture, 810).find(c => c.kind === 'end')?.held, false, 'release cannot abort bounded reset');
}
function travel(hz: number) {
  const state = new GamepadGestureState(); let total = 0;
  for (let i = 0; i <= hz * 2; i++) for (const c of state.sample(1, increase, i * 1000 / hz)) if (c.kind === 'delta') total += c.delta;
  const end = state.sample(0, increase, 2010);
  assert(end.some(c => c.kind === 'end' && c.held));
  assert.equal(state.sample(0, increase, 3000).length, 0, 'release has no residual glide');
  return total;
}
assert(Math.abs(travel(30) - travel(120)) < 0.008, 'frame-rate independent hold distance');
const stalled = new GamepadGestureState(); stalled.sample(1, axis, 0);
assert(stalled.sample(1, axis, 10000).every(c => c.kind !== 'delta' || Math.abs(c.delta) <= 0.011), 'long frame never catches up');
const boost = new GamepadGestureState();
assert(boost.sample(1, { mode: 'boost' }, 0).some(c => c.kind === 'boost'));
assert.equal(boost.sample(1, { mode: 'boost' }, 2000).length, 0);

function candidate(index: number, input: 'axis' | 'button' = 'button'): GamepadLearnCandidate {
  return { inputId: 'gamepad:0', gamepadIndex: 0, fingerprint: { transport: 'gamepad', name: 'Test pad', mapping: 'standard' },
    matcher: { transport: 'gamepad', input, index }, signal: { kind: 'gate', pressed: true }, label: `Input ${index}` };
}
const request = { target: { scope: 'focused' as const, domain: 'parameter' as const, controlId: 'scale' }, targetLabel: 'Scale', path: 'direct' as const,
  writeMode: 'live' as const, takeover: 'pickup' as const, sliderGesture: true };
for (const index of [0, 1, 2, 3, 12, 13, 14, 15]) {
  const learned = applyGamepadLearnBinding(createEmptyControlSurfaceDocument(), candidate(index), request);
  assert.equal(learned.mapping.bindings.length, 2);
  assert.equal(new Set(learned.mapping.bindings.map(b => b.pairId)).size, 1);
  assert.deepEqual(new Set(learned.mapping.bindings.map(b => b.gesture?.mode)), new Set(['decrease', 'increase']));
  const next = applyGamepadLearnBinding(learned.document, candidate(index), { ...request, target: { ...request.target, controlId: 'speed' } });
  assert.equal(next.mapping.bindings.length, 2, 'relearning moves both');
  assert(next.mapping.bindings.every(b => b.target.domain === 'parameter' && b.target.controlId === 'speed'));
  assert.equal(removeControllerBinding(next.document, next.binding.id).mappings[0]!.bindings.length, 0);
  const unlink = unlinkControllerPair(next.document, next.binding.id);
  assert(unlink.mappings[0]!.bindings.every(b => !b.pairId));
  const changed = updateControllerBinding(next.document, next.binding.id, { writeMode: 'write' });
  assert(changed.mappings[0]!.bindings.every(b => b.writeMode === 'write'));
}
let doc = applyGamepadLearnBinding(createEmptyControlSurfaceDocument(), candidate(0), request).document;
doc = applyGamepadLearnBinding(doc, candidate(2), { ...request, target: { ...request.target, controlId: 'other' } }).document;
assert.equal(doc.mappings[0]!.bindings.length, 4, 'AB and XY are independent');
const round = parseControlSurfaceDocument(serializeControlSurfaceDocument(doc));
assert.deepEqual(round.document.mappings[0]!.bindings.map(b => b.pairId), doc.mappings[0]!.bindings.map(b => b.pairId));
assert.equal(parseControlSurfaceDocument({ ...doc, schemaVersion: 1 }).document.schemaVersion, 2);
assert.equal(parseControlSurfaceDocument({ ...doc, schemaVersion: 99 }).document.profiles.length, 0);
for (const i of [4,5,6,7,10,11,16]) doc = applyGamepadLearnBinding(doc, candidate(i), request).document;
assert(doc.profiles[0]!.banks.length > 1);

class Runtime implements ControlSurfaceRuntimeAdapter {
  commands: { id: string; command: GestureCommand }[] = [];
  stopCount = 0;
  applyGesture(b: ControllerBinding, command: GestureCommand) { this.commands.push({ id: b.virtualControlId, command }); return { status: 'applied' as const }; }
  stopGestures() { this.stopCount++; }
  applyDirect() { return { status: 'applied' as const }; }
  applyModulation() { return { status: 'applied' as const }; }
  dispatchAction() { return { status: 'applied' as const }; }
  clearBinding() {} panic() {}
}
const output = new Runtime(); const actions: string[] = [];
let now = 0;
let pads: GamepadLike[] = [{ id: 'Test pad', index: 0, connected: true, timestamp: 0, mapping: 'standard', axes: [0,0,0,0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }];
const host = new GamepadRuntime(new ControlSurfaceBindingEngine(output), { getGamepads: () => pads, now: () => now, onAction: a => actions.push(a) });
host.configure(doc); host.poll();
function button(index: number, value: number) { pads[0]!.buttons[index]!.value = value; pads[0]!.buttons[index]!.pressed = value > 0.5; now += 20; host.poll(); }
button(0,1); button(0,0); button(16,1); button(16,0);
assert.equal(output.commands.filter(c => c.command.kind === 'step').length, 2, 'first and ninth+ input both route');
assert.equal(actions.length, 0, 'bound default action does not fire');
output.commands = [];
Object.assign(pads[0]!.buttons[0]!, { pressed: true, value: 1 }); Object.assign(pads[0]!.buttons[1]!, { pressed: true, value: 1 }); now += 400; host.poll();
assert.equal(output.commands.filter(c => c.command.kind === 'step').length, 0, 'opposite pair cancels');
button(0,0); button(1,0);
output.commands = [];
host.startLearn({ allowAxes: false }, () => {}); button(6,1);
assert.equal(actions.length, 0); assert.equal(output.commands.length, 0, 'Learn consumes captured inputs');
button(6,0); button(0,1); host.stopGestures(); output.commands = []; now += 400; host.poll();
assert.equal(output.commands.length, 0, 'held input cannot resume after Stop');
button(0,0); button(0,1);
assert(output.commands.some(c => c.command.kind === 'step'), 'neutral rearms');
const stops = output.stopCount; pads = []; host.poll(); assert(output.stopCount > stops, 'disconnect cancels held state');
host.dispose();
console.log('PASS: flicks, holds, frame timing, double-tap, boost, AB/XY/DP pairing, relearn, unlink, migration, >8 inputs, Learn suppression, Stop, reconnect safety.');
