import type { GLStage } from './context-pool';

interface Target { framebuffer: WebGLFramebuffer; texture: WebGLTexture }
interface Targets { stage: GLStage; generation: number; w: number; h: number; pair: [Target,Target] }
const targets = new Map<string, Targets>();
const rejected = new Map<string, string>();

export function releaseEffectTargets(cardId: string): void {
  const old=targets.get(cardId);
  if(old) for(const target of old.pair) {
    old.stage.gl.deleteFramebuffer(target.framebuffer);old.stage.gl.deleteTexture(target.texture);
  }
  targets.delete(cardId);rejected.delete(cardId);
}

/** Intermediate passes stay on the GPU. Fall back to the A/B relay path if
 * allocation fails or would exceed 64 MiB per card; never force low resolution. */
export function getEffectTargets(stage: GLStage, cardId: string, w: number, h: number): [Target,Target] | null {
  if(!stage.gl || stage.isLost || w*h*8>64*1024*1024) return null;
  const old=targets.get(cardId);
  if(old && old.stage===stage && old.generation===stage.generation && old.w===w && old.h===h) return old.pair;
  const signature=`${stage.generation}:${w}:${h}`;
  if(rejected.get(cardId)===signature) return null;
  releaseEffectTargets(cardId);
  const gl=stage.gl;const allocated: Target[]=[];
  try {
    for(let i=0;i<2;i++) {
      const framebuffer=gl.createFramebuffer(),texture=gl.createTexture();
      if(!framebuffer || !texture) {
        if(framebuffer)gl.deleteFramebuffer(framebuffer);if(texture)gl.deleteTexture(texture);
        throw new Error('VFX allocation failed');
      }
      allocated.push({framebuffer,texture});
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete VFX framebuffer');
    }
    const pair=allocated as [Target,Target];targets.set(cardId,{stage,generation:stage.generation,w,h,pair});return pair;
  } catch {
    for(const target of allocated){gl.deleteFramebuffer(target.framebuffer);gl.deleteTexture(target.texture);}
    rejected.set(cardId,signature);return null;
  } finally { gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,null); }
}
