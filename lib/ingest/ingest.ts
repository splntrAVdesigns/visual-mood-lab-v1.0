import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/client';
import { ensureCanonicalBoardItem, getOrCreateDefaultBoard } from '@/lib/data/assets';
import { getStorage } from '@/lib/storage';
import { parseUniforms } from '@/lib/gl/parse-uniforms';
import { paramsToSchema } from '@/lib/sketch/params-to-schema';
import { defaultsOf, type ControlSchema } from '@/renderers/control-schema';
import type { AssetType } from '@/types/asset';
import { generatePosterSvg, hashContent, posterColors } from './poster';
import { sanitizeAssetTitle, sanitizeAssetTags } from '@/lib/validation/asset';
import { migrateSeedHeightParams } from './seed-height-migration';

/**
 * One ingest path for everything.
 *
 * The seed script and the upload route both call `ingestAsset`. That is
 * deliberate: if seeding works, upload works, because there is no second
 * code path to drift. Phase 1's exit criterion depends on it.
 *
 * It's also, for the same reason, the one place free-text metadata
 * (title, tags) MUST be sanitized regardless of which caller reached it —
 * seed manifests are trusted, but upload-derived titles come straight from
 * a filename the uploader chose, so this function treats all callers as
 * untrusted rather than relying on each call site to have done it first.
 */

export interface IngestInput {
  ownerId: string;
  type: AssetType;
  title: string;
  tags?: string[];
  /** Code assets: the source text. */
  source?: string;
  /** Binary assets: the already-uploaded blob URL. */
  srcUrl?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /** Set for seed assets so re-runs upsert instead of duplicating. */
  seedSlug?: string;
  /** Position on the board. Seed script passes the manifest index. */
  boardOrder?: number;
  /**
   * Pre-computed schema for a p5 sketch, from a caller that already has the
   * REAL params object in hand (the seed script imports the sketch module
   * directly). When present, this is used verbatim and `extractParamsLiteral`
   * is skipped entirely.
   *
   * Only the seed path can supply this: it's the only caller trusted to run
   * arbitrary sketch source in order to get the real object. The upload path
   * (app/api/assets/route.ts) never sets this — running an untrusted upload's
   * code server-side is the thing extractParamsLiteral's regex scrape exists
   * specifically to avoid, so uploads keep going through it same as before.
   *
   * Closes a real gap: extractParamsLiteral does a blind `.replace(/'/g,
   * '"')` to turn the object literal into JSON, which corrupts any string
   * value containing an apostrophe (a hint like "a lit node's other edges"
   * silently produces a zero-control schema, no error, and — because
   * ingestAsset's `unchanged` fast path never re-derives — that corruption
   * then survives every future reseed silently once cached). This trusted
   * path removes the regex from that entire flow rather than trying to make
   * the regex itself apostrophe-safe.
   */
  precomputedSchema?: ControlSchema | null;
}

export interface IngestResult {
  id: string;
  /** Position this asset's canonical card should occupy on the board. */
  boardOrder?: number;
  created: boolean;
  /** True when content was unchanged and the existing row was reused. */
  unchanged: boolean;
  schema: ControlSchema | null;
  warnings: string[];
}

/** Non-negative finite number, or undefined if the input wasn't usable. */
function clampNonNegative(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}

export async function ingestAsset(input: IngestInput): Promise<IngestResult> {
  if (!input.ownerId) {
    // Cheap defense-in-depth, not the real authorization boundary — the
    // caller (app/api/assets/route.ts) is where ownerId must come from
    // the authenticated session, never from the request body. This just
    // makes sure a future caller can't accidentally ingest ownerless data
    // by forgetting that check.
    throw new Error('ingestAsset: ownerId is required');
  }

  const db = await getDb();
  const storage = getStorage();
  const warnings: string[] = [];

  // Sanitized once, here, regardless of caller — see the module comment.
  const title = sanitizeAssetTitle(input.title);
  const tags = sanitizeAssetTags(input.tags ?? []);

  const id = input.seedSlug ?? crypto.randomUUID();
  const hashSource = input.source ?? input.srcUrl ?? id;
  const contentHash = hashContent(hashSource);

  /* ---- existing row? -------------------------------------------- */
  const existing = input.seedSlug
    ? await db
        .select()
        .from(schema.assets)
        .where(
          and(
            eq(schema.assets.ownerId, input.ownerId),
            eq(schema.assets.seedSlug, input.seedSlug),
          ),
        )
        .limit(1)
    : [];

  const prior = existing[0];

  if (prior && prior.contentHash === contentHash) {
    // @shape adds host controls that are generated from application code. The
    // built-in library can change without changing the shader source hash, so
    // refresh its persisted schema when those controls change. Retain all
    // saved values, including selections of retired but still renderable IDs.
    if (input.seedSlug && input.type === 'shader' && input.source?.includes('@shape')) {
      const parsed = parseUniforms(input.source, { schemaId: `shader:${prior.id}` });
      const current = parsed.schema;
      if (JSON.stringify(prior.schema) !== JSON.stringify(current)) {
        const boardId = await getOrCreateDefaultBoard(input.ownerId);
        await db.update(schema.assets).set({
          schema: current,
          params: { ...defaultsOf(current), ...prior.params },
          updatedAt: new Date(),
        }).where(eq(schema.assets.id, prior.id));
        await ensureCanonicalBoardItem(boardId, prior.id, input.boardOrder ?? 0);
        for (const warning of parsed.warnings) {
          if (warning.level === 'warn') warnings.push(`${prior.id}: ${warning.message}`);
        }
        return { id: prior.id, created: false, unchanged: false, schema: current, warnings };
      }
    }
    /*
     * The asset row is untouched, but the BOARD ITEM may still be missing —
     * and that is a different thing entirely. This early return used to skip
     * ensureCanonicalBoardItem (called further down on both other paths),
     * which meant re-seeding an asset whose content hadn't changed left it
     * in the database with no card on the board. Symptom: /api/seed happily
     * reports "total: 31" while the board renders 18, because the board
     * renders board items, not assets. Every seed run after the first would
     * silently fail to surface anything it had already ingested.
     */
    const boardId = await getOrCreateDefaultBoard(input.ownerId);
    await ensureCanonicalBoardItem(boardId, prior.id, input.boardOrder ?? 0);
    return { id: prior.id, created: false, unchanged: true, schema: prior.schema, warnings };
  }

  /* ---- schema extraction ---------------------------------------- */
  let controlSchema: ControlSchema | null = null;

  if (input.type === 'p5' && input.precomputedSchema !== undefined) {
    // Trusted caller already ran the real sketch module and computed this
    // properly — see the IngestInput.precomputedSchema doc comment for why
    // this exists and what it avoids. No extraction to do here.
    controlSchema = input.precomputedSchema;
  } else if (input.type === 'shader' && input.source) {
    const parsed = parseUniforms(input.source, { schemaId: `shader:${id}` });
    controlSchema = parsed.schema;
    for (const w of parsed.warnings) {
      if (w.level === 'warn') warnings.push(`${id}: ${w.message}`);
    }
  } else if (input.type === 'p5' && input.source) {
    // Fallback for callers that DON'T have the real params object — only
    // the upload route should ever land here now. Running arbitrary
    // uploaded code server-side isn't an option, so this has to make do
    // with a source-text scrape rather than a real import.
    const parsed = paramsToSchema(extractParamsLiteral(input.source), {
      schemaId: `sketch:${id}`,
    });
    controlSchema = parsed.schema;
    for (const w of parsed.warnings) {
      if (w.level === 'warn') warnings.push(`${id}: ${w.message}`);
    }
  }

  /* ---- poster ---------------------------------------------------- */
  let posterUrl = prior?.posterUrl ?? '';
  let dominantColors = prior?.dominantColors ?? [];

  const isCode = input.type === 'shader' || input.type === 'p5';

  if (isCode) {
    const svg = generatePosterSvg(input.type, id, contentHash);
    const put = await storage.put(`posters/${id}.svg`, Buffer.from(svg, 'utf8'), 'image/svg+xml');
    posterUrl = put.url;
    dominantColors = posterColors(contentHash, input.type);
  } else if (input.type === 'video') {
    // A real frame-grab poster needs ffmpeg running server-side — not yet
    // wired (see this file's own earlier comment on the raster/video
    // branch, and the Video Export Foundation sprint notes on why that's
    // real, separate infra work, not a quick patch). Reusing `srcUrl`
    // directly — the previous behavior — isn't a degraded fallback for
    // video the way it is for an image: a browser cannot render `.mp4`
    // bytes through an `<img>` tag at all, so every video asset showed a
    // permanently broken dummy-image icon, not a low-quality poster.
    // The same deterministic lattice placeholder already generated for
    // shader/p5 assets above is a genuine, correct fix in the meantime —
    // it reads as "video asset, no real poster yet" instead of "broken,"
    // and costs nothing new: same function, same storage call, same
    // pattern, just called for one more type.
    const svg = generatePosterSvg('video', id, contentHash);
    const put = await storage.put(`posters/${id}.svg`, Buffer.from(svg, 'utf8'), 'image/svg+xml');
    posterUrl = put.url;
    dominantColors = posterColors(contentHash, 'video');
  } else if (input.srcUrl) {
    // image/svg only from here — these DO render correctly through an
    // <img src>, so reusing the source is a real, working poster, unlike
    // the video case above.
    posterUrl = input.srcUrl;
  }

  /* ---- write ----------------------------------------------------- */
  const params = controlSchema ? defaultsOf(controlSchema) : {};
  const now = new Date();

  const row = {
    id: prior?.id ?? id,
    ownerId: input.ownerId,
    type: input.type,
    title,
    tags,
    srcUrl: input.srcUrl ?? null,
    source: input.source ?? null,
    posterUrl,
    schema: controlSchema,
    // Preserve user edits across a re-seed; only fill gaps from new defaults.
    params: prior ? { ...params, ...migrateSeedHeightParams(input.seedSlug, prior.params) } : params,
    mod: prior?.mod ?? {},
    dominantColors,
    width: clampNonNegative(input.width) ?? null,
    height: clampNonNegative(input.height) ?? null,
    durationMs: clampNonNegative(input.durationMs) ?? null,
    seedSlug: input.seedSlug ?? null,
    contentHash,
    updatedAt: now,
  };

  const boardId = await getOrCreateDefaultBoard(input.ownerId);

  if (prior) {
    await db.update(schema.assets).set(row).where(eq(schema.assets.id, prior.id));
    // Snapshots carry their own parameter maps. Update only legacy maps,
    // including the old zero-Height preset, without touching newer edits.
    if (input.seedSlug === 'landscape-grid' || input.seedSlug === 'terrain-wireframe') {
      const items = await db.select().from(schema.boardItems).where(eq(schema.boardItems.assetId, prior.id));
      for (const item of items) {
        if (!item.paramsOverride) continue;
        const migrated = migrateSeedHeightParams(input.seedSlug, item.paramsOverride);
        if (migrated !== item.paramsOverride) {
          await db.update(schema.boardItems).set({ paramsOverride: migrated })
            .where(eq(schema.boardItems.id, item.id));
        }
      }
    }
    await ensureCanonicalBoardItem(boardId, prior.id, input.boardOrder ?? 0);
    return { id: prior.id, created: false, unchanged: false, schema: controlSchema, warnings };
  }

  await db.insert(schema.assets).values({ ...row, createdAt: now });
  await ensureCanonicalBoardItem(boardId, row.id, input.boardOrder ?? 0);
  return { id: row.id, created: true, unchanged: false, schema: controlSchema, warnings };
}

/**
 * Pulls the `params` object out of sketch source without executing it.
 *
 * The seed script imports sketches properly and passes the real object, so
 * this only handles the upload path, where running untrusted code on the
 * server is not an option. Returns null when it cannot parse — the sketch
 * then gets base controls only until the sandbox reports its schema on
 * first render.
 */
function extractParamsLiteral(source: string): unknown {
  const match = /export\s+const\s+params\s*=\s*(\{[\s\S]*?\n\};)/.exec(source);
  if (!match) return null;
  try {
    // Not eval: the literal is JSON-ish, so we normalise keys and quotes.
    const literal = match[1]
      .replace(/;\s*$/, '')
      // Strip comments FIRST. Authors group long params objects with
      // /* ---- motion ---- */ section headers, and leaving those in place
      // made JSON.parse fail — which silently produced an asset with zero
      // controls rather than any visible error. Particle Cube shipped with
      // 25 controls and ingested with none because of exactly this.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(literal);
  } catch {
    return null;
  }
}
