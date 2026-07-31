/**
 * Texture source loading.
 *
 * A texture control stores an asset id. Turning that into something a
 * shader can sample means fetching that asset's poster image and decoding
 * it — and doing so exactly once per source, not once per frame, which is
 * the whole reason this cache exists. The shader renderer asks for a
 * source every frame while binding uniforms; without a cache in front of
 * it that would issue a network request sixty times a second.
 *
 * Poster images specifically, not the asset's live output: a shader
 * sampling another live shader would need a second render pass and a
 * dependency graph to resolve ordering, which is genuinely Phase 6+
 * territory. A poster is a real, already-generated frame of that asset —
 * enough to make source-driven shaders like ASCII Mosaic and Chromatic
 * Glitch do the thing they were written to do.
 *
 * Location: lib/gl/texture-source.ts
 */

type Entry =
  | { state: 'loading'; promise: Promise<HTMLImageElement | null> }
  | { state: 'ready'; image: HTMLImageElement }
  | { state: 'failed' };

const cache = new Map<string, Entry>();

/**
 * Returns the decoded image for a source URL if it is already resolved,
 * otherwise kicks off the load and returns null for now.
 *
 * Deliberately synchronous-with-a-null rather than async: it is called
 * from inside the per-frame uniform binding path, which cannot await
 * anything. The first few frames after linking a source render with the
 * fallback, then the real texture appears once decoding finishes.
 */
export function getTextureImage(url: string): HTMLImageElement | null {
  const hit = cache.get(url);
  if (hit) return hit.state === 'ready' ? hit.image : null;

  const image = new Image();
  // Same-origin in practice (posters are served from this app or its blob
  // store), but crossOrigin is required for the canvas/WebGL upload path to
  // not taint anything if that ever changes.
  image.crossOrigin = 'anonymous';

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    image.onload = () => {
      cache.set(url, { state: 'ready', image });
      resolve(image);
    };
    image.onerror = () => {
      // Cached as failed rather than deleted: without this, every frame
      // would retry a broken URL forever.
      cache.set(url, { state: 'failed' });
      resolve(null);
    };
  });

  cache.set(url, { state: 'loading', promise });
  image.src = url;
  return null;
}

/** Drops a single entry, so a re-captured poster is picked up. */
export function invalidateTexture(url: string): void {
  cache.delete(url);
}

export function clearTextureCache(): void {
  cache.clear();
}
