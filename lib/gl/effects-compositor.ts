/**
 * VFX consumes the already-presented tile canvas. uploadTexture flips DOM
 * rows on ingestion; framebuffer regions copied with drawImage are already
 * upright. Never repeat ShaderRenderer's authoring-space flip here.
 * Resolve runnable programs before drawing; publish the final runnable pass.
 * Missing/loading/invalid shaders are bypassed in chain order.
 */

import { peekGLStage, type GLStage } from './context-pool';
import type { EffectInstance } from '@/lib/effects/types';
import { getEffectDefinition } from '@/lib/effects/registry';
import type { Control, ParamState, RGBA } from '@/renderers/control-schema';

/** A source this compositor can capture into a texture this frame.
    Deliberately the exact TexImageSource-compatible subset context-pool's
    uploadTexture() already accepts — see that function's signature. */
export type CaptureSource = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement;

export interface CompositeInput {
  /** The tile's own already-rendered frame for this tick. */
  source: CaptureSource;
  /** Stable per-tile cache key, e.g. the pool's cardId. Effect programs
      and the relay canvas are cached per this key, same "compile once,
      reuse" spirit as GLStage.compile()'s own key. */
  cardId: string;
  effects: EffectInstance[];
  width: number;
  height: number;
  /** GLSL uniform values already resolved for this frame (u_time etc.),
      passed through to every effect pass exactly like ShaderRenderer's
      applyReserved — an effect shader can read u_time/u_resolution the
      same way any seed shader does. */
  time: number;
}

const RESERVED_EFFECT_UNIFORMS = new Set(['u_time', 'u_resolution', 'u_fxMix', 'u_fxSource', 'u_echoBuffer']);

const relayCanvases = new Map<string, HTMLCanvasElement>();
const relayCtx = new Map<string, CanvasRenderingContext2D>();

/**
 * Echo/feedback buffer — Phase 4.96 Part 2. A per-card persistent canvas
 * (never cleared between frames, unlike the ping-pong relay canvases
 * above, which ARE meant to reset each call) that accumulates a fading
 * trail of the chain's own recent output. Reuses the exact "fade toward
 * black, draw new content on top, re-upload as a texture" technique the
 * seed library's own feedback-trails shaders already use for the same
 * kind of accumulation, just done in 2D canvas space here since the echo
 * buffer lives alongside the relay canvases rather than as a GLSL-side
 * backbuffer.
 *
 * Deliberately NOT wired to every effect — "Strobe is the first and only
 * consumer" per the original Part 2 scope, checked explicitly in
 * compositeEffects() below via the effect instance's own `echo` param
 * rather than a generic `usesEcho` flag on EffectDefinition. The buffer
 * mechanism itself is generic by construction, though: any future effect
 * that declares a `uniform sampler2D u_echoBuffer;` gets it automatically
 * once it's part of an active chain — see the RESERVED_EFFECT_UNIFORMS
 * entry and the wrapper template below.
 */
const echoCanvases = new Map<string, HTMLCanvasElement>();
const echoCtx = new Map<string, CanvasRenderingContext2D>();
const ECHO_DECAY = 0.85; // fraction of old trail content kept each frame

function getEcho(cardId: string, w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  let canvas = echoCanvases.get(cardId);
  let ctx = echoCtx.get(cardId);
  if (!canvas || !ctx) {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d')!; // alpha needed — the trail fades via alpha blending
    echoCanvases.set(cardId, canvas);
    echoCtx.set(cardId, ctx);
  }
  if (canvas.width !== w || canvas.height !== h) {
    // Resizing a canvas clears it — correct here, since stale trail
    // content at the wrong dimensions would just look broken, not useful.
    canvas.width = w;
    canvas.height = h;
  }
  return { canvas, ctx };
}

function getRelay(key: string, w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  let canvas = relayCanvases.get(key);
  let ctx = relayCtx.get(key);
  if (!canvas || !ctx) {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d', { alpha: false })!;
    relayCanvases.set(key, canvas);
    relayCtx.set(key, ctx);
  }
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { canvas, ctx };
}

/** Drop a card's relay canvases — call on dispose, mirrors how
    ShaderRenderer's own backbuffer is dropped in its dispose(). Without
    this a removed card's relay canvases (and their GL textures, via
    GLStage's own texture map keyed off the same cardId-derived string)
    would leak for the lifetime of the tab. */
export function disposeEffectsFor(cardId: string): void {
  // The GL half. This function's doc (above) has always claimed the textures
  // were freed "via GLStage's own texture map" — but nothing did that:
  // deleting the canvases from the Maps below left the WebGL textures AND the
  // stage's strong reference to each canvas (lastTextureSource) alive for the
  // life of the tab. Keys released here: `${cardId}:echo`, `:fx-src`, `:a`, `:b`.
  peekGLStage()?.releaseTexturesWithPrefix(`${cardId}:`);

  relayCanvases.delete(`${cardId}:a`);
  relayCanvases.delete(`${cardId}:b`);
  relayCtx.delete(`${cardId}:a`);
  relayCtx.delete(`${cardId}:b`);
  echoCanvases.delete(cardId);
  echoCtx.delete(cardId);
}

const PASSTHROUGH_VERTEX_WRAP = (body: string) => `#version 300 es
precision highp float;
uniform sampler2D u_fxSource;
uniform sampler2D u_echoBuffer;
uniform float u_fxMix;
uniform float u_time;
uniform vec2 u_resolution;
out vec4 fragColor;

vec4 fxSample(vec2 uv) { return texture(u_fxSource, uv); }
vec4 fxEcho(vec2 uv) { return texture(u_echoBuffer, uv); }

${body}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec4 base = fxSample(uv);
  vec4 processed = fxMain(uv);
  fragColor = mix(base, processed, clamp(u_fxMix, 0.0, 1.0));
}`;

/**
 * Effect shader authoring contract: a source file declares `fxMain(vec2 uv)
 * -> vec4` plus whatever of its own uniforms it needs (bound the same way
 * a seed shader's params bind — see registry.ts's Control.binding). This
 * wrapper supplies u_fxSource/u_fxMix/u_time/u_resolution and the mix
 * blend automatically, so an individual effect file (dark-strobe.frag,
 * etc.) never has to re-declare or hand-implement mix itself — same
 * "the contract does the work" principle as BASE_CONTROLS.
 */
export function wrapEffectSource(body: string): string {
  return PASSTHROUGH_VERTEX_WRAP(body);
}

/**
 * Runs `input.effects` (enabled ones, in order, capped by the caller —
 * see MAX_EFFECTS_PER_CHAIN) against `input.source`, writing the final
 * composited frame onto `dest`. If the chain is empty or every entry is
 * disabled, this is a no-op and the caller should leave `dest` (or its own
 * canvas) exactly as the renderer already drew it — see the pool.ts
 * integration note in the Part 1 deliverable notes for why the hook is
 * structured as "skip entirely when there's nothing to do" rather than
 * always routing through a passthrough pass.
 */
export function compositeEffects(
  stage: GLStage,
  dest: HTMLCanvasElement,
  input: CompositeInput,
): void {
  const active = input.effects.filter((e) => e.enabled && Number.isFinite(e.mix) && e.mix > 0);
  if (active.length === 0) return;

  // Every step below touches the GL context, a 2D canvas, or a compiled
  // program — any one of them can throw given an edge case a specific
  // effect's shader or params happen to hit (a bad uniform value, a
  // degenerate w/h, a canvas op on a context that's mid-loss). Before this
  // wrap, nothing here was contained: an uncaught throw partway through a
  // pass would propagate straight out of compositeEffects() into whatever
  // called it. Depending on how the caller's own render loop is
  // structured, that's either "this one tile silently stays blank forever"
  // or, if the call site has no per-card containment of its own either,
  // "the shared render loop itself dies and every live tile on the board
  // freezes" — the exact failure mode already identified and fixed for
  // getTrackFrequencyData() elsewhere in the render pipeline (see that
  // function's own doc comment). Same class of risk, same fix: fail
  // closed. On a throw, this leaves `dest` exactly as it already was —
  // the tile's own un-composited render, drawn by the caller before this
  // function runs — rather than a blank/frozen canvas, and logs once so
  // the failure is visible instead of silent.
  try {
    compositeEffectsUnsafe(stage, dest, input, active);
  } catch (err) {
    console.error(`[effects] composite failed for ${input.cardId}:`, err);
  }
}

function compositeEffectsUnsafe(
  stage: GLStage,
  dest: HTMLCanvasElement,
  input: CompositeInput,
  active: EffectInstance[],
): void {
  const w = Math.max(1, Math.round(input.width));
  const h = Math.max(1, Math.round(input.height));

  // Resolve the runnable chain first. The final *successful* program owns
  // output, even when a later configured entry is loading or fails compile.
  const passes = active.flatMap((instance) => {
    const def = getEffectDefinition(instance.effectType);
    const key = `fx:${instance.effectType}`;
    const source = compiledSourceCache.get(key);
    if (!def || !source) return [];
    const result = stage.compile(key, source);
    return result.ok && result.program ? [{ instance, def, program: result.program }] : [];
  });
  if (passes.length === 0) return;

  // Echo buffer: only maintained when something in the active chain
  // actually wants it (currently just Dark Strobe with its own `echo`
  // param above 0) — no point paying for an extra canvas + texture
  // upload + draw every frame on chains that never read it. Read BEFORE
  // this frame's passes run — it holds LAST frame's trail; updated with
  // THIS frame's result only after the loop below, so a pass never reads
  // its own not-yet-produced output.
  // Generalized (Tier 1+2 batch) beyond the original dark-strobe-only
  // check — see EffectDefinition.usesEcho's own doc for the reasoning.
  // Dark Strobe keeps its exact original opt-in behavior (echo must be
  // both declared AND above 0); any other effect declaring usesEcho is
  // active whenever the instance itself is, since the buffer is
  // load-bearing to those effects rather than an optional dial.
  const usesEcho = passes.some(({ instance: i }) => {
    const def = getEffectDefinition(i.effectType);
    if (!def?.usesEcho) return false;
    if (i.effectType === 'dark-strobe') {
      return typeof i.params.echo === 'number' && i.params.echo > 0;
    }
    return true;
  });
  let echoTex: WebGLTexture | null = null;
  if (usesEcho) {
    const { canvas: echoCanvas } = getEcho(input.cardId, w, h);
    echoTex = stage.uploadTexture(`${input.cardId}:echo`, echoCanvas, { force: true });
  }

  // Pass 0's input is the tile's own live frame — captured with force:true
  // for the same reason ShaderRenderer's backbuffer needs it: `source` is
  // the same element reference every tick, only its pixel content changes.
  let currentTex = stage.uploadTexture(`${input.cardId}:fx-src`, input.source, { force: true });
  if (!currentTex) return;

  let relayToggle: 'a' | 'b' = 'a';

  for (let i = 0; i < passes.length; i++) {
    const { instance, def, program } = passes[i];
    const region = stage.draw(program, w, h, (set) => {
      set('u_fxSource', currentTex!);
      // Bound unconditionally, same as u_time/u_resolution below — a
      // shader that never declares u_echoBuffer just has this location
      // resolve to null and the call is a no-op, no branching needed per
      // effect. Falls back to the source texture itself when no echo
      // exists yet (first frame, or nothing in the chain wants it) so
      // fxEcho() never samples an unbound/garbage texture.
      set('u_echoBuffer', echoTex ?? currentTex!);
      set('u_fxMix', instance.mix);
      set('u_time', input.time);
      set('u_resolution', [w, h]);
      applyEffectParams(set, def.params, instance.params);
    });

    // Texture ingestion handles Y orientation. Canvas region copies use
    // identity, for both intermediate and final passes. No extra final relay.
    const isLast = i === passes.length - 1;
    const relayKey = `${input.cardId}:${relayToggle}`;
    const target = isLast
      ? { canvas: dest, ctx: dest.getContext('2d', { alpha: false }) }
      : getRelay(relayKey, w, h);
    if (!target.ctx) return;
    if (target.canvas.width !== w || target.canvas.height !== h) {
      target.canvas.width = w; target.canvas.height = h;
    }
    target.ctx.save();
    target.ctx.setTransform(1, 0, 0, 1, 0, 0);
    target.ctx.drawImage(stage.canvas, region.sx, region.sy, region.sw, region.sh, 0, 0, w, h);
    target.ctx.restore();
    if (!isLast) {
      const nextTex = stage.uploadTexture(relayKey, target.canvas, { force: true });
      if (!nextTex) return; // leave the fresh base frame intact on upload failure
      currentTex = nextTex;
      relayToggle = relayToggle === 'a' ? 'b' : 'a';
    }
  }

  // Update the trail for NEXT frame, from THIS frame's final result —
  // `dest` already holds it, already correctly oriented (this is the
  // on-screen canvas, not a GL-space region), so no flip needed here.
  // Fade old content toward transparent-black, then draw the new frame
  // on top at reduced alpha so it accumulates as a ghosting trail rather
  // than replacing the buffer outright — the same technique the seed
  // library's own feedback-trails shaders use, done in 2D canvas space
  // since this buffer lives here rather than as a GLSL backbuffer.
  if (usesEcho) {
    const { ctx: echoCtx2d } = getEcho(input.cardId, w, h);
    echoCtx2d.save();
    echoCtx2d.globalCompositeOperation = 'source-over';
    echoCtx2d.globalAlpha = 1;
    echoCtx2d.fillStyle = `rgba(0, 0, 0, ${1 - ECHO_DECAY})`;
    echoCtx2d.fillRect(0, 0, w, h);
    echoCtx2d.globalAlpha = ECHO_DECAY;
    echoCtx2d.drawImage(dest, 0, 0, w, h);
    echoCtx2d.restore();
  }
}

function applyEffectParams(
  set: (name: string, value: number | boolean | number[] | WebGLTexture) => void,
  controls: Control[],
  params: ParamState,
): void {
  for (const control of controls) {
    const binding = control.binding;
    if (!binding || binding.target !== 'uniform') continue;
    if (RESERVED_EFFECT_UNIFORMS.has(binding.name)) continue; // wrapper owns these

    const value = params[control.id] ?? control.default;
    if (control.kind === 'color') {
      const c = value as RGBA;
      set(binding.name, binding.glslType === 'vec4' ? [c.r, c.g, c.b, c.a] : [c.r, c.g, c.b]);
    } else if (control.kind === 'select') {
      // BUGFIX (VFX diagnostic pass): a select-kind control's ParamState
      // value is always a string (coerce()'s 'select' case, matching
      // SelectControl.default: string / SelectOption.value: string) —
      // never a number, even when valueType is 'number'. The typeof
      // check below only ever matched number/boolean/array, so a
      // uniform-bound select (e.g. Math Warp's `mode`) silently never
      // received a value and sat at WebGL's uninitialized-uniform
      // default of 0 forever — "Swirl" was unreachable regardless of
      // what was selected. Same parse-at-binding-time contract
      // SelectControl.valueType's own doc comment already promises
      // ("the renderer parses option values with Number() before
      // writing them to the binding") and the exact pattern
      // ShaderRenderer.applyParams already uses for tile-level
      // @select-annotated uniforms (renderers/shader.renderer.ts) —
      // mirrored here so both binding paths agree.
      const raw = typeof value === 'string' ? value : control.default;
      set(binding.name, control.valueType === 'number' ? Number(raw) : 0);
    } else if (typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) {
      set(binding.name, value as number | boolean | number[]);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Shader source loading — async fetch resolved outside the render loop,
 * mirrors how ShaderRenderer's own `source` is resolved at mount() rather
 * than fetched inline during render().
 * ------------------------------------------------------------------ */

const compiledSourceCache = new Map<string, string>();

const pendingSources = new Map<string, Promise<void>>();

export function loadEffectShaderIfNeeded(effectType: string): Promise<void> {
  const key = `fx:${effectType}`;
  if (compiledSourceCache.has(key)) return Promise.resolve();
  const pending = pendingSources.get(key);
  if (pending) return pending;
  const task = (async () => {
    try {
      const { getEffectShaderSource } = await import('@/lib/effects/registry');
      const raw = await getEffectShaderSource(effectType);
      if (raw) compiledSourceCache.set(key, wrapEffectSource(raw));
    } catch (err) {
      // Callers intentionally fire-and-forget. A failed fetch must not create
      // an unhandled rejection; the next explicit load can retry.
      console.warn(`[effects] could not load ${effectType}:`, err);
    } finally {
      pendingSources.delete(key);
    }
  })();
  pendingSources.set(key, task);
  return task;
}
