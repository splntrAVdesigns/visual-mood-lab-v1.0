import type { ControlSignal, MidiRelativeMode, PhysicalControlMatcher } from './types';
import type { MidiDecodedMessage } from './midi-types';

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;
const PITCH_BEND = 0xe0;
const STATUS_MASK = 0xf0;
const CHANNEL_MASK = 0x0f;

const SYSTEM_LABELS: Record<number, string> = {
  0xf0: 'System Exclusive',
  0xf1: 'MTC Quarter Frame',
  0xf2: 'Song Position',
  0xf3: 'Song Select',
  0xf6: 'Tune Request',
  0xf7: 'SysEx End',
  0xf8: 'MIDI Clock',
  0xfa: 'Start',
  0xfb: 'Continue',
  0xfc: 'Stop',
  0xfe: 'Active Sensing',
  0xff: 'System Reset',
};

export function decodeMidiMessage(data: ArrayLike<number> | null | undefined): MidiDecodedMessage | null {
  if (!data || data.length < 1) return null;
  const status = byte(data[0]);
  if (status < 0x80) return null;

  if (status >= 0xf0) {
    return {
      kind: 'system',
      status,
      label: SYSTEM_LABELS[status] ?? `System 0x${status.toString(16).toUpperCase()}`,
      realtime: status >= 0xf8,
    };
  }

  const message = status & STATUS_MASK;
  const channel = (status & CHANNEL_MASK) + 1;
  const data1 = byte(data[1]);
  const data2 = byte(data[2]);

  if (message === CONTROL_CHANGE && data.length >= 3) {
    return { kind: 'cc', status, channel, controller: data1 & 0x7f, value: data2 & 0x7f };
  }

  if ((message === NOTE_ON || message === NOTE_OFF) && data.length >= 3) {
    const velocity = data2 & 0x7f;
    // MIDI's canonical velocity-zero Note On is Note Off. Treat both forms
    // identically so pads/keyboards never leave a gate stuck.
    const pressed = message === NOTE_ON && velocity > 0;
    return { kind: 'note', status, channel, note: data1 & 0x7f, velocity, pressed };
  }

  if (message === PITCH_BEND && data.length >= 3) {
    const value14 = ((data2 & 0x7f) << 7) | (data1 & 0x7f);
    const bipolar = value14 >= 8192
      ? (value14 - 8192) / 8191
      : (value14 - 8192) / 8192;
    return { kind: 'pitchbend', status, channel, value14, bipolar: clampBipolar(bipolar) };
  }

  return {
    kind: 'unsupported',
    status,
    channel,
    label: `Unsupported channel message 0x${message.toString(16).toUpperCase()}`,
  };
}

export function midiMatcherMatches(
  matcher: Extract<PhysicalControlMatcher, { transport: 'midi' }>,
  message: MidiDecodedMessage,
): boolean {
  if (message.kind === 'system' || message.kind === 'unsupported') return false;
  if (matcher.channel !== undefined && matcher.channel !== message.channel) return false;

  if (matcher.message === 'cc') {
    return message.kind === 'cc' && matcher.cc === message.controller;
  }
  if (matcher.message === 'note') {
    return message.kind === 'note' && matcher.note === message.note;
  }
  return message.kind === 'pitchbend';
}

export function midiMessageToSignal(
  message: MidiDecodedMessage,
  matcher: Extract<PhysicalControlMatcher, { transport: 'midi' }>,
  defaultRelativeMode: MidiRelativeMode = 'absolute',
): ControlSignal | null {
  if (!midiMatcherMatches(matcher, message)) return null;

  if (message.kind === 'cc' && matcher.message === 'cc') {
    const mode = matcher.relativeMode ?? defaultRelativeMode;
    return ccValueToSignal(message.value, mode);
  }
  if (message.kind === 'note' && matcher.message === 'note') {
    return {
      kind: 'gate',
      pressed: message.pressed,
      velocity: clamp01(message.velocity / 127),
    };
  }
  if (message.kind === 'pitchbend' && matcher.message === 'pitchbend') {
    return { kind: 'bipolar', value: message.bipolar };
  }

  return null;
}

export function ccValueToSignal(value: number, mode: MidiRelativeMode): ControlSignal {
  const raw = Math.max(0, Math.min(127, Math.round(value)));
  if (mode === 'absolute') return { kind: 'absolute', value: raw / 127 };

  let delta = 0;
  switch (mode) {
    case 'twos-complement':
      // Common Mackie-style convention: 1..63 positive, 65..127 negative;
      // 0 and 64 are neutral/no movement.
      if (raw !== 0 && raw !== 64) {
        delta = raw < 64 ? raw / 63 : -(128 - raw) / 63;
      }
      break;
    case 'binary-offset':
      // 64 is center, 65..127 positive, 0..63 negative.
      delta = raw === 64 ? 0 : (raw - 64) / 63;
      break;
    case 'signed-bit': {
      // Bit 6 carries direction, low six bits carry magnitude.
      const magnitude = raw & 0x3f;
      delta = magnitude === 0 ? 0 : (raw & 0x40 ? -magnitude / 63 : magnitude / 63);
      break;
    }
  }
  return { kind: 'relative', delta: clampBipolar(delta) };
}

/** Filtering for MIDI Learn. Clock/transport/active-sensing never become
 * bindings, Note Off is ignored, and Channel Mode CCs 120..127 are excluded
 * because they are protocol commands rather than physical continuous controls. */
export function isMidiLearnCandidate(message: MidiDecodedMessage): boolean {
  if (message.kind === 'cc') return message.controller < 120;
  if (message.kind === 'note') return message.pressed;
  return message.kind === 'pitchbend';
}

export function learnMatcherForMessage(
  message: MidiDecodedMessage,
  relativeMode: MidiRelativeMode = 'absolute',
): Extract<PhysicalControlMatcher, { transport: 'midi' }> | null {
  if (!isMidiLearnCandidate(message)) return null;
  switch (message.kind) {
    case 'cc':
      return {
        transport: 'midi',
        message: 'cc',
        channel: message.channel,
        cc: message.controller,
        relativeMode,
      };
    case 'note':
      return { transport: 'midi', message: 'note', channel: message.channel, note: message.note };
    case 'pitchbend':
      return { transport: 'midi', message: 'pitchbend', channel: message.channel };
    default:
      return null;
  }
}

export function midiMessageLabel(message: MidiDecodedMessage): string {
  switch (message.kind) {
    case 'cc':
      return `Ch ${message.channel} · CC ${message.controller} · ${message.value}`;
    case 'note':
      return `Ch ${message.channel} · Note ${message.note} · ${message.pressed ? 'On' : 'Off'} · Vel ${message.velocity}`;
    case 'pitchbend':
      return `Ch ${message.channel} · Pitch Bend · ${message.value14}`;
    case 'system':
    case 'unsupported':
      return message.label;
  }
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function clampBipolar(n: number): number {
  return n < -1 ? -1 : n > 1 ? 1 : n;
}

function byte(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value & 0xff : 0;
}
