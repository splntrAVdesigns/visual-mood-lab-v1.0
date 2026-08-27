/**
 * Visual Mood Lab — Phase 4.96 effects compositor.
 *
 * There is no FBO/render-to-texture layer in context-pool.ts today — GLStage
 * draws directly into a region of its own shared canvas and callers blit
 * that region out with drawImage (see GLStage.draw's doc). Rather than add
 * a parallel render-to-texture abstraction, this reuses the ONE pattern the
 * codebase already has for exactly this problem: ShaderRenderer's feedback
 * backbuffer, which captures a live-mutating canvas into an offscreen
 * canvas and re-uploads it as a texture every frame with
 * `uploadTexture(key, canvas, { force: true })`.
 *
 * A chain of N effects becomes N draw-and-relay steps: draw into the
 * shared stage, copy that region into a small offscreen "relay" canvas,
 * upload the relay canvas as next pass's input texture, repeat, then blit
 * the final pass's output onto the destination canvas the same way
 * ShaderRenderer already blits its own shader output (flip transform,
 * because GL renders y-up and canvas images are y-down).
 *
 * Capture support today: shader-rendered `<canvas>` sources work directly
 * (proven — this is the ShaderRenderer case). `<img>`/`<video>` elements
 * are also valid `texImage2D` sources and will work through the same
 * `captureFrame()` entry point once a renderer exposes one — nothing here
 * is shader-canvas-specific. A cross-origin sandboxed p5 `<iframe>` is NOT
 * a valid texImage2D source at all (browser-level restriction, not a
 * missing accessor) — see IMPLEMENTATION_PLAN.md §7 Phase 4.96 note on
 * this; that needs the sandbox to stream frames out over postMessage, a
 * separate piece of design work, not wired here.
 *
 * Location: lib/gl/effects-compositor.ts
 */

import type { GLStage } from './context-pool';
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

const RESERVED_EFFECT_UNIFORMS = new Set(['u_time', 'u_resolution', 'u_fxMix', 'u_fxSource']);

const relayCanvases = new Map<string, HTMLCanvasElement>();
const relayCtx = new Map<string, CanvasRenderingContext2D>();

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
  relayCanvases.delete(`${cardId}:a`);
  relayCanvases.delete(`${cardId}:b`);
  relayCtx.delete(`${cardId}:a`);
  relayCtx.delete(`${cardId}:b`);
}

const PASSTHROUGH_VERTEX_WRAP = (body: string) => `#version 300 es
precision highp float;
uniform sampler2D u_fxSource;
uniform float u_fxMix;
uniform float u_time;
uniform vec2 u_resolution;
out vec4 fragColor;

vec4 fxSample(vec2 uv) { return texture(u_fxSource, uv); }

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
  const active = input.effects.filter((e) => e.enabled);
  if (active.length === 0) return;

  const w = Math.max(1, Math.round(input.width));
  const h = Math.max(1, Math.round(input.height));

  // Pass 0's input is the tile's own live frame — captured with force:true
  // for the same reason ShaderRenderer's backbuffer needs it: `source` is
  // the same element reference every tick, only its pixel content changes.
  let currentTex = stage.uploadTexture(`${input.cardId}:fx-src`, input.source, { force: true });
  if (!currentTex) return;

  let relayToggle: 'a' | 'b' = 'a';

  for (let i = 0; i < active.length; i++) {
    const instance = active[i];
    const def = getEffectDefinition(instance.effectType);
    if (!def) continue; // unknown effectType (retired registry entry) — fail closed, skip

    const compileKey = `fx:${instance.effectType}`;
    const source = compiledSourceCache.get(compileKey);
    if (!source) continue; // shader source not yet loaded for this effect — see loadEffectShaderIfNeeded

    const result = stage.compile(compileKey, source);
    if (!result.ok || !result.program) continue;

    const isLastPass = i === active.length - 1;
    const relayKey = `${input.cardId}:${relayToggle}`;
    const { canvas: relayCanvas, ctx: relayCtx2d } = getRelay(relayKey, w, h);

    const region = stage.draw(result.program, w, h, (set) => {
      set('u_fxSource', currentTex!);
      set('u_fxMix', instance.mix);
      set('u_time', input.time);
      set('u_resolution', [w, h]);
      applyEffectParams(set, def.params, instance.params);
    });

    if (isLastPass) {
      // Final pass: blit straight to the destination canvas, flip-corrected
      // the exact same way ShaderRenderer.render() does for its own output.
      const destCtx = dest.getContext('2d', { alpha: false });
      if (destCtx) {
        if (dest.width !== w || dest.height !== h) { dest.width = w; dest.height = h; }
        destCtx.save();
        destCtx.setTransform(1, 0, 0, -1, 0, dest.height);
        destCtx.drawImage(stage.canvas, region.sx, region.sy, region.sw, region.sh, 0, 0, dest.width, dest.height);
        destCtx.restore();
      }
    } else {
      // Intermediate pass: relay into the offscreen canvas (also
      // flip-corrected — every pass reads u_fxSource in the same
      // y-orientation the previous stage produced it in) and upload as
      // the next pass's texture input, force:true for the same
      // same-reference-every-frame reason as pass 0's capture above.
      relayCtx2d.save();
      relayCtx2d.setTransform(1, 0, 0, -1, 0, h);
      relayCtx2d.drawImage(stage.canvas, region.sx, region.sy, region.sw, region.sh, 0, 0, w, h);
      relayCtx2d.restore();
      currentTex = stage.uploadTexture(relayKey, relayCanvas, { force: true });
      relayToggle = relayToggle === 'a' ? 'b' : 'a';
    }
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

export async function loadEffectShaderIfNeeded(effectType: string): Promise<void> {
  const key = `fx:${effectType}`;
  if (compiledSourceCache.has(key)) return;

  const { getEffectShaderSource } = await import('@/lib/effects/registry');
  const raw = await getEffectShaderSource(effectType);
  if (!raw) return;
  compiledSourceCache.set(key, wrapEffectSource(raw));
}
