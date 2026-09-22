/**
 * Shape Source — built-in shape library.
 *
 * Original vector shapes (drawn for Shapeshift, not taken from any pack) so
 * the "Library" source works on day one. When the Phase 4.95 Media Library
 * ships, its pack plugs in beside these; the ids here stay stable because
 * they are saved in tile params.
 *
 * Every shape is filled white on a transparent background — only coverage
 * matters to the distance field, never colour.
 *
 * Location: lib/shape-source/library.ts
 */

function burst(points: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / points - Math.PI / 2;
    pts.push(`${(100 + Math.cos(a) * r).toFixed(2)},${(100 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="1000" height="1000"><polygon fill="#fff" points="${pts.join(' ')}"/></svg>`;
}

export const LIBRARY_SHAPES: Record<string, { label: string; svg: string }> = {
  vessel: {
    label: 'Vessel',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="667" height="1000"><path fill="#fff" d="M72 18H128V38C128 48 120 54 120 64C168 80 186 128 172 172C162 204 132 224 126 244H136V266H64V244H74C68 224 38 204 28 172C14 128 32 80 80 64C80 54 72 48 72 38Z"/></svg>',
  },
  orbit: {
    label: 'Orbit',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="1000" height="1000"><path fill="#fff" fill-rule="evenodd" d="M100 8a92 92 0 1 0 0.1 0ZM100 36a64 64 0 1 1-0.1 0Z"/><circle fill="#fff" cx="100" cy="100" r="30"/><circle fill="#fff" cx="168" cy="52" r="14"/></svg>',
  },
  bolt: {
    label: 'Bolt',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="667" height="1000"><path fill="#fff" d="M118 6 32 170H92L70 294 170 116H108Z"/></svg>',
  },
  arch: {
    label: 'Arch',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260" width="769" height="1000"><path fill="#fff" fill-rule="evenodd" d="M20 250V100A80 80 0 0 1 180 100V250ZM60 250V110A40 40 0 0 1 140 110V250Z"/></svg>',
  },
  burst: { label: 'Burst', svg: burst(12, 96, 58) },
};

export const LIBRARY_IDS = Object.keys(LIBRARY_SHAPES);
export const DEFAULT_LIBRARY_ID = 'vessel';
