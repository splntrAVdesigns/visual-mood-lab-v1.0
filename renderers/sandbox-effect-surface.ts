import { copySurface, effectSize } from '@/lib/effects/surface';
import type { HostToSandbox, SandboxToHost } from '@/lib/sandbox/protocol';
import type { RenderContext } from './types';

/** One outstanding request and one clean frame per iframe. The overlay ignores
 * pointers; the original isolated iframe still owns all sketch interactions. */
export class SandboxEffectSurface {
  private output = document.createElement('canvas');
  private clean = document.createElement('canvas');
  private active = false;
  private ready = false;
  private pending = 0;
  private sequence = 0;
  private requestedAt = 0;
  private lastRequest = -Infinity;
  private expected: [number, number] = [0,0];
  private notice: string | null = null;

  constructor(private frame: HTMLIFrameElement, host: HTMLElement, private send: (msg: HostToSandbox) => void) {
    this.output.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none';
    host.appendChild(this.output);
  }
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active=active; this.reset();
  }
  reset(): void {
    this.pending=0;this.ready=false;this.lastRequest=-Infinity;
    this.output.style.display='none';this.frame.style.opacity='';
    this.notice=this.active ? 'VFX waiting for sketch frame…' : null;
  }
  getCanvas(): HTMLCanvasElement | null { return this.active && this.ready ? this.output : null; }
  getNotice(): string | null { return this.notice; }
  render(ctx: RenderContext): void {
    if (!this.active) return;
    const size=effectSize(ctx.width,ctx.height,ctx.pixelRatio);
    if(size[0]!==this.expected[0] || size[1]!==this.expected[1]) { this.reset();this.expected=size; }
    const now=performance.now();
    if(this.pending && now-this.requestedAt>1000) {
      this.reset();this.notice='VFX frame unavailable; retrying…';this.lastRequest=now;
    }
    if(this.ready) {
      copySurface(this.clean,this.output,...this.expected);
      this.output.style.display='block';this.frame.style.opacity='0';
    }
    if(!this.pending && now-this.lastRequest >= (this.notice?.includes('unavailable') ? 1000 : 1000/30)) {
      this.pending=++this.sequence;this.requestedAt=now;this.lastRequest=now;
      this.send({type:'vfx-frame',requestId:this.pending,width:size[0],height:size[1]});
    }
  }
  accept(msg: SandboxToHost): void {
    const bitmap=msg.bitmap;
    try {
      if (!this.active || !this.pending || msg.requestId!==this.pending) return;
      this.pending=0;
      if(!bitmap || bitmap.width!==this.expected[0] || bitmap.height!==this.expected[1]) {
        this.ready=false;this.output.style.display='none';this.frame.style.opacity='';
        this.notice='VFX frame unavailable; retrying…';return;
      }
      copySurface(bitmap,this.clean,...this.expected);
      this.ready=true;this.notice=null;
    } finally { bitmap?.close(); }
  }
  dispose(): void { this.active=false;this.reset();this.output.remove();this.clean.width=this.clean.height=1; }
}
