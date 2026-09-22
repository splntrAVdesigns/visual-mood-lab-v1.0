/**
 * Shape Source — SVG sanitising and size normalisation.
 *
 * Two jobs, both done before an uploaded SVG is stored or rasterised:
 *
 * 1. SANITISE. Rasterising through an <img> never executes script, but the
 *    file is also stored and served back from the blob store, so anything
 *    active is stripped: <script>, <foreignObject>, embedded documents, every
 *    on* handler, javascript: URLs, and any href that is not a local
 *    fragment or an inline data: image. External references would also make
 *    the image fail to decode (an <img>-loaded SVG cannot fetch), so removing
 *    them costs nothing that could have worked.
 *
 * 2. NORMALISE SIZE. An SVG with a viewBox but no width/height decodes to
 *    0x0 in Firefox and 300x150 in Chromium — either way the shape vanishes
 *    or distorts. Explicit dimensions are set from the viewBox (long edge
 *    1024) so every browser decodes the same thing.
 *
 * Browser-only (DOMParser). The uploaded file is sanitised on the client
 * BEFORE upload, so what reaches the blob store is already clean.
 *
 * Location: lib/shape-source/svg.ts
 */

const ACTIVE_ELEMENTS = 'script, foreignObject, iframe, object, embed, audio, video';

export class SvgError extends Error {}

export function sanitizeSvg(text: string): string {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) {
    throw new SvgError('This file is not a valid SVG');
  }

  svg.querySelectorAll(ACTIVE_ELEMENTS).forEach((n) => n.remove());

  const all: Element[] = [svg, ...Array.from(svg.querySelectorAll('*'))];
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (value.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === 'href' || name === 'xlink:href') && !(value.startsWith('#') || value.startsWith('data:image/'))) {
        el.removeAttribute(attr.name);
      }
    }
  }

  let vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) {
    const w = parseFloat(svg.getAttribute('width') ?? '') || 512;
    const h = parseFloat(svg.getAttribute('height') ?? '') || 512;
    vb = [0, 0, w, h];
    svg.setAttribute('viewBox', vb.join(' '));
  }
  const aspect = vb[2] / vb[3];
  svg.setAttribute('width', String(aspect >= 1 ? 1024 : Math.round(1024 * aspect)));
  svg.setAttribute('height', String(aspect >= 1 ? Math.round(1024 / aspect) : 1024));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  return new XMLSerializer().serializeToString(svg);
}
