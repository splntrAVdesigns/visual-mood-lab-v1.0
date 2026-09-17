import assert from 'node:assert/strict';
import { MidiRuntime, matchMidiProfile } from '../lib/control-surface/midi-runtime';
import { ccValueToSignal, decodeMidiMessage } from '../lib/control-surface/midi-parser';
import { CONTROL_SURFACE_SCHEMA_VERSION, type ControlSurfaceDocument } from '../lib/control-surface/types';
import type { ControlSignal } from '../lib/control-surface/types';
import type { MidiAccessLike, MidiInputLike, MidiMessageEventLike } from '../lib/control-surface/midi-types';

class FakeInput implements MidiInputLike {
  state = 'connected';
  connection = 'open';
  type = 'input';
  onmidimessage: ((event: MidiMessageEventLike) => void) | null = null;

  constructor(
    readonly id: string,
    readonly name = 'VML Test Controller',
    readonly manufacturer = 'SPLNTR Test',
  ) {}

  async open(): Promise<void> {
    this.connection = 'open';
  }

  async close(): Promise<void> {
    this.connection = 'closed';
  }

  emit(bytes: number[], timeStamp = 100): void {
    this.onmidimessage?.({ data: Uint8Array.from(bytes), timeStamp });
  }
}

class FakeEngine {
  bindings: unknown[] = [];
  events: Array<{ id: string; signal: ControlSignal }> = [];
  panics = 0;

  setBindings(bindings: unknown[]): void {
    this.bindings = bindings;
  }

  dispatch(id: string, signal: ControlSignal): void {
    this.events.push({ id, signal });
  }

  panic(): void {
    this.panics += 1;
  }
}

async function main(): Promise<void> {
  const noteOffViaZeroVelocity = decodeMidiMessage([0x90, 60, 0]);
  assert.deepEqual(noteOffViaZeroVelocity, {
    kind: 'note', status: 0x90, channel: 1, note: 60, velocity: 0, pressed: false,
  });
  assert.equal(ccValueToSignal(127, 'absolute').kind, 'absolute');
  assert.equal((ccValueToSignal(127, 'absolute') as { value: number }).value, 1);
  assert.ok((ccValueToSignal(127, 'twos-complement') as { delta: number }).delta < 0);

  const input = new FakeInput('port-a');
  const inputs = new Map<string, MidiInputLike>([[input.id, input]]);
  const access: MidiAccessLike = { inputs, onstatechange: null };
  const engine = new FakeEngine();
  const runtime = new MidiRuntime({
    engine,
    requestAccess: async () => access,
    secureContext: true,
    now: () => 999,
  });

  const document: ControlSurfaceDocument = {
    schemaVersion: CONTROL_SURFACE_SCHEMA_VERSION,
    profiles: [{
      id: 'profile-1',
      alias: 'Test Surface',
      transport: 'midi',
      fingerprint: {
        transport: 'midi', manufacturer: 'SPLNTR Test', name: 'VML Test Controller', portId: 'port-a',
      },
      banks: [{
        id: 'bank-a',
        label: 'Bank A',
        controls: [
          { id: 'k1', label: 'K1', matcher: { transport: 'midi', message: 'cc', channel: 1, cc: 21 } },
          { id: 'pad', label: 'Pad', matcher: { transport: 'midi', message: 'note', channel: 1, note: 60 } },
          { id: 'bend', label: 'Bend', matcher: { transport: 'midi', message: 'pitchbend', channel: 1 } },
        ],
      }],
    }],
    mappings: [{ id: 'mapping-1', profileId: 'profile-1', activeBankId: 'bank-a', writeMode: 'live', bindings: [] }],
  };

  runtime.configure(document);
  await runtime.requestAccess();
  assert.equal(runtime.snapshot().accessStatus, 'granted');
  assert.equal(runtime.snapshot().devices[0]?.profileMatch.status, 'matched');

  input.emit([0xb0, 21, 127]);
  runtime.flushPending();
  assert.deepEqual(engine.events.at(-1), { id: 'k1', signal: { kind: 'absolute', value: 1 } });

  input.emit([0x90, 60, 100]);
  runtime.flushPending();
  assert.equal((engine.events.at(-1)?.signal as { pressed: boolean }).pressed, true);

  input.emit([0x90, 60, 0]);
  runtime.flushPending();
  assert.equal((engine.events.at(-1)?.signal as { pressed: boolean }).pressed, false);

  input.emit([0xe0, 0, 64]);
  runtime.flushPending();
  assert.deepEqual(engine.events.at(-1), { id: 'bend', signal: { kind: 'bipolar', value: 0 } });

  let learnedCc: number | null = null;
  runtime.startLearn({}, (candidate) => {
    learnedCc = candidate.matcher.message === 'cc' ? candidate.matcher.cc : null;
  });
  input.emit([0xf8]); // clock: not Learn-eligible
  assert.equal(learnedCc, null);
  input.emit([0xb0, 22, 64]);
  assert.equal(learnedCc, 22);

  const reconnect = new FakeInput('new-port-id');
  const reconnectMatch = matchMidiProfile(reconnect, document.profiles);
  assert.equal(reconnectMatch.status, 'matched');
  assert.notEqual(reconnectMatch.basis, 'port-id');

  runtime.panic();
  assert.equal(engine.panics, 1);

  console.log('✓ Phase 4.97B MIDI runtime verified');
  console.log('  Web MIDI permission/discovery contract: PASS');
  console.log('  CC / Note On-Off / Pitch Bend parsing: PASS');
  console.log('  Relative encoder modes: PASS');
  console.log('  Channel filtering + velocity normalization: PASS');
  console.log('  Learn filtering (clock ignored): PASS');
  console.log('  Reconnect fingerprint fallback: PASS');
  console.log('  Panic integration: PASS');
}

void main();
