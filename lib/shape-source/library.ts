/** Built-in Shapeshift shapes. Retired IDs remain renderable for saved tiles. */
import { APPROVED_SHAPES } from './approved-shapes';

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
  // Legacy silhouettes: saved cards must not silently change their artwork.
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
  vessel_v2: {
    label: 'Vessel',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 280" width="240" height="280"><path fill="#fff" fill-rule="evenodd" d="M75 18H165L155 64C190 75 216 105 211 151C208 184 186 204 163 227L170 260H70L77 227C54 204 32 184 29 151C24 105 50 75 85 64ZM120 91C87 91 65 116 69 148C73 176 97 190 120 215C143 190 167 176 171 148C175 116 153 91 120 91Z"/></svg>',
  },
  arch_v2: {
    label: 'Arch',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 280" width="260" height="280"><path fill="#fff" fill-rule="evenodd" d="M20 258V119C20 52 69 17 130 17C191 17 240 52 240 119V258H172V123C172 94 157 76 130 76C103 76 88 94 88 123V258ZM102 258V192H158V258Z"/></svg>',
  },
  burst_v2: {
    label: 'Burst',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 260" width="260" height="260"><path fill="#fff" d="M79 98 144 73 194 116 175 178 110 194 64 147ZM124 9 149 66 115 70ZM204 25 182 92 167 71ZM252 94 204 132 200 100ZM235 194 185 176 198 149ZM137 252 126 200 157 196ZM29 226 70 166 93 189ZM8 112 57 133 57 105ZM35 39 90 91 69 109Z"/></svg>',
  },
  fold: {
    label: 'Fold',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 260" width="260" height="260"><path fill="#fff" d="M28 38H190L232 92 137 222H28L123 92H28ZM196 112 232 158 198 222H154Z"/></svg>',
  },
  notch: {
    label: 'Notch',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 260" width="260" height="260"><path fill="#fff" d="M27 28H233V105H165L130 141 165 176H233V232H27V176H91L125 141 91 105H27Z"/></svg>',
  },
  ribbon: {
    label: 'Ribbon',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 260" width="280" height="260"><path fill="#fff" d="M20 188C48 177 55 121 93 68C116 35 157 24 192 44C228 64 242 104 221 137C209 156 192 170 182 189H260V242H138V215C138 169 164 137 186 110C199 95 184 74 167 79C140 85 130 124 108 165C88 205 68 230 20 239Z"/></svg>',
  },
  split_disc: {
    label: 'Split Disc',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 260" width="260" height="260"><path fill="#fff" d="M130 15A115 115 0 0 1 238 92H169A48 48 0 0 0 130 80V15ZM244 119A115 115 0 0 1 108 242V175A48 48 0 0 0 177 119H244ZM81 222A115 115 0 0 1 17 113H84A48 48 0 0 0 81 151V222ZM18 88A115 115 0 0 1 103 18V85A48 48 0 0 0 85 88H18Z"/></svg>',
  },
  rail: {
    label: 'Rail',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 260" width="260" height="260"><path fill="#fff" d="M24 24H178V66H24ZM82 89H236V131H82ZM24 154H178V196H24ZM82 219H236V255H82Z"/></svg>',
  },
  ...APPROVED_SHAPES,
};

export const VISIBLE_LIBRARY_IDS = [
  'vessel_v2', 'orbit', 'bolt',
  'approved_aperture',
  'approved_arrows',
  'approved_blockswirl',
  'approved_cells',
  'approved_clamp',
  'approved_eye_open',
  'approved_vortex',
] as const;
export const LIBRARY_IDS = [...VISIBLE_LIBRARY_IDS];
export const DEFAULT_LIBRARY_ID = 'vessel_v2';
