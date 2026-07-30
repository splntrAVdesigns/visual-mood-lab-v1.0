import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/client';
import { ensureCanonicalBoardItem, getOrCreateDefaultBoard } from '@/lib/data/assets';
import { getStorage } from '@/lib/storage';
import { parseUniforms } from '@/lib/gl/parse-uniforms';
import { paramsToSchema } from '@/lib/sketch/params-to-schema';
import { defaultsOf, type ControlSchema } from '@/renderers/control-schema';
import type { AssetType } from '@/types/asset';
import { generatePosterSvg, hashContent, posterColors } from './poster';

/**
 * One ingest path for everything.
 *
 * The seed script and the upload route both call `ingestAsset`. That is
 * deliberate: if seeding works, upload works, because there is no second
 * code path to drift. Phase 1's exit criterion depends on it.
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

export async function ingestAsset(input: IngestInput): Promise<IngestResult> {
  const db = await getDb();
  const storage = getStorage();
  const warnings: string[] = [];

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

  if (input.type === 'shader' && input.source) {
    const parsed = parseUniforms(input.source, { schemaId: `shader:${id}` });
    controlSchema = parsed.schema;
    for (const w of parsed.warnings) {
      if (w.level === 'warn') warnings.push(`${id}: ${w.message}`);
    }
  } else if (input.type === 'p5' && input.source) {
    // The sketch's params object is evaluated in the sandbox at runtime; at
    // ingest we only need its shape, which the seed script supplies already
    // parsed. Uploaded sketches go through the sandbox before landing here.
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
  } else if (input.srcUrl) {
    // Raster and video posters are produced by sharp / ffmpeg at upload time
    // and passed in via srcUrl's sibling. Until that lands, reuse the source.
    posterUrl = input.srcUrl;
  }

  /* ---- write ----------------------------------------------------- */
  const params = controlSchema ? defaultsOf(controlSchema) : {};
  const now = new Date();

  const row = {
    id: prior?.id ?? id,
    ownerId: input.ownerId,
    type: input.type,
    title: input.title,
    tags: input.tags ?? [],
    srcUrl: input.srcUrl ?? null,
    source: input.source ?? null,
    posterUrl,
    schema: controlSchema,
    // Preserve user edits across a re-seed; only fill gaps from new defaults.
    params: prior ? { ...params, ...prior.params } : params,
    mod: prior?.mod ?? {},
    dominantColors,
    width: input.width ?? null,
    height: input.height ?? null,
    durationMs: input.durationMs ?? null,
    seedSlug: input.seedSlug ?? null,
    contentHash,
    updatedAt: now,
  };

  const boardId = await getOrCreateDefaultBoard(input.ownerId);

  if (prior) {
    await db.update(schema.assets).set(row).where(eq(schema.assets.id, prior.id));
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
