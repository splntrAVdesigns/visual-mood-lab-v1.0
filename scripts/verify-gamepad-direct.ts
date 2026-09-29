/** Real adapter + Inspector integration, with a deterministic animation clock. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import type { ControllerBinding } from '../lib/control-surface/types';
const g = globalThis as any;
let now = 0, serial = 0;
const frames = new Map<number, (time: number) => void>();
g.requestAnimationFrame = (cb: (time: number) => void) => { frames.set(++serial, cb); return serial; };
g.cancelAnimationFrame = (id: number) => frames.delete(id);
Object.defineProperty(g, 'performance', { value: { now: () => now }, configurable: true });
g.window = { location: { search: '' }, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
g.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
g.fetch = async () => ({ ok: true, status: 200 });
function frame(ms = 60) { now += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(now)); }
async function main() {
  const { DirectControlRuntime } = await import('../lib/control-surface/direct-control');
  const { LiveControlSurfaceRuntime } = await import('../lib/control-surface/runtime');
  const { getControllerPresentationRegistry } = await import('../lib/control-surface/presentation');
  const { useInspectorStore: inspector } = await import('../stores/inspectorStore');
  const { useBoardStore: board } = await import('../stores/boardStore');
  const { getPool } = await import('../lib/render/pool');
  const { createSchema } = await import('../renderers/control-schema');
  const schema = createSchema('test', [
    { id:'value', label:'Value', group:'test', kind:'slider', min:-1, max:1, step:0.01, default:0.4 },
    { id:'count', label:'Count', group:'test', kind:'stepper', min:0, max:10, step:1, default:2 },
    { id:'log', label:'Log', group:'test', kind:'slider', min:1, max:100, scale:'log', default:10 },
  ]);
  const rendered: Record<string, unknown> = {};
  const pool = getPool() as any;
  pool.get = () => ({ getControlSchema: () => schema, setParam: (id: string, v: unknown) => { rendered[id] = v; }, setParams: (values: Record<string,unknown>) => Object.assign(rendered, values) });
  pool.setBaseParam = () => {}; pool.setBaseParams = () => {}; pool.setEffects = () => {};
  board.setState({ selectedId:'card', assets:[] });
  inspector.setState({ itemId:'card', assetId:null, open:true, schema, params:{ value:0.4, count:2, log:10 }, effects:[], dirty:new Set(), history:{past:[],future:[]} });
  const runtime = new DirectControlRuntime(new LiveControlSurfaceRuntime());
  const binding: ControllerBinding = { id:'A', virtualControlId:'A', path:'direct', target:{scope:'focused',domain:'parameter',controlId:'value'}, gesture:{mode:'decrease'}, writeMode:'live' };
  runtime.applyGesture(binding, {kind:'begin'}); runtime.applyGesture(binding, {kind:'step',direction:-1}); frame();
  assert(Math.abs(Number(rendered.value) - 0.39) < 0.001, 'first step begins at actual 0.4, not midpoint');
  runtime.applyGesture(binding, {kind:'end',held:false});
  const b = {...binding, id:'B', virtualControlId:'B', gesture:{mode:'increase' as const}};
  runtime.applyGesture(b, {kind:'begin'}); runtime.applyGesture(b, {kind:'step',direction:1}); frame();
  assert(Math.abs(Number(rendered.value) - 0.4) < 0.001, 'paired button continues shared live value');
  runtime.applyGesture(b, {kind:'boost'}); frame();
  assert(Math.abs(Number(rendered.value) - 0.8) < 0.001, '+20% of signed range travel');
  runtime.applyGesture(b, {kind:'reset'}); runtime.applyGesture(b, {kind:'end',held:false}); frame();
  assert.equal(rendered.value, 0, 'numeric zero is not normalized minimum');
  const log = {...binding,id:'log',target:{...binding.target,controlId:'log'}};
  runtime.applyGesture(log,{kind:'begin'}); runtime.applyGesture(log,{kind:'reset'}); frame();
  assert.equal(rendered.log, 1, 'zero reset clamps to positive log minimum');
  const count = {...binding,id:'count',target:{...binding.target,controlId:'count'}};
  runtime.applyGesture(count,{kind:'begin'});
  for(let i=0;i<100;i++) runtime.applyGesture(count,{kind:'delta',delta:0.002});
  assert.equal(rendered.count,4,'sub-step deltas accumulate for integer sliders');
  runtime.applyGesture(count,{kind:'end',held:true});
  runtime.applyGesture(b,{kind:'boost'}); frame(10); const stopped=rendered.value;
  runtime.stopGestures(); frame(200); assert.equal(rendered.value,stopped,'Stop freezes unfinished easing without restoring base');
  runtime.clearGamepadOverrides();
  inspector.setState({params:{value:0.7,count:2,log:10}});
  const write = {...binding,writeMode:'write' as const};
  runtime.applyGesture(write,{kind:'begin'}); runtime.applyGesture(write,{kind:'step',direction:-1}); frame();
  for(let i=0;i<20;i++) runtime.applyGesture(write,{kind:'delta',delta:-0.005});
  assert.equal(inspector.getState().history.past.length,0,'no per-frame history');
  runtime.applyGesture(write,{kind:'end',held:true}); runtime.stopGestures();
  assert.equal(inspector.getState().history.past.length,1,'one history entry for whole Write gesture');
  const final=inspector.getState().params.value;
  assert(Number(final)<0.69);
  inspector.getState().undoParams(); assert.equal(inspector.getState().params.value,0.7);
  inspector.getState().redoParams(); assert.equal(inspector.getState().params.value,final);
  runtime.clearGamepadOverrides();
  assert.equal(getControllerPresentationRegistry().sampleParameter('card','value'),null);
  runtime.panic();
  console.log('PASS: actual-value takeover, shared AB value, signed/log reset, stepped holds, Stop freeze, Write commit and undo/redo.');
}
main().catch(error=>{ console.error(error); process.exitCode=1; });
