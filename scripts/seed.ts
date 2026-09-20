/**
 * Loads the seed library into the database.
 *
 *   npm run seed          # migrate if needed, then ingest every manifest entry
 *   npm run seed -- --fresh   # drop and recreate first (LOCAL database only)
 *
 * `--fresh` DROPS the boards, board_items and assets tables. Pointed at a
 * remote database (a DATABASE_URL in .env.local — i.e. Neon) it is refused
 * unless you also pass `--force-remote`, so it can't be run against production
 * by muscle memory. The HTTP seed route already refuses `fresh` in production;
 * this closes the same gap on the command line.
 *
 * Runs through `ingestAsset`, exactly like an upload does. If this works,
 * upload works — there is no second code path to drift.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';

import { getDb, isLocalDb, schema } from '../lib/db/client';
import { runMigrations } from '../lib/db/migrate';
import { ingestAsset } from '../lib/ingest/ingest';
import { LIBRARY_OWNER_ID } from '../lib/data/assets';
import { paramsToSchema } from '../lib/sketch/params-to-schema';
import type { ControlSchema } from '../renderers/control-schema';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'seed');

interface ManifestEntry {
  slug: string;
  type: 'shader' | 'p5';
  file: string;
  title: string;
  tags: string[];
}

async function fresh(): Promise<void> {
  const db = await getDb();
  await db.execute(sql.raw('DROP TABLE IF EXISTS board_items CASCADE'));
  await db.execute(sql.raw('DROP TABLE IF EXISTS boards CASCADE'));
  await db.execute(sql.raw('DROP TABLE IF EXISTS assets CASCADE'));
  await db.execute(sql.raw('DROP TYPE IF EXISTS asset_type CASCADE'));
  await db.execute(sql.raw('DROP TABLE IF EXISTS _migrations CASCADE'));
}

async function main(): Promise<void> {
  const wantsFresh = process.argv.includes('--fresh');

  console.log(`\nDatabase: ${isLocalDb() ? 'PGlite (local)' : 'Postgres (DATABASE_URL)'}`);

  if (wantsFresh && !isLocalDb() && !process.argv.includes('--force-remote')) {
    console.error(
      '\nRefusing --fresh: DATABASE_URL points at a remote Postgres, and --fresh DROPS the\n' +
        'boards, board_items and assets tables.\n\n' +
        'If you really mean to wipe that database, add --force-remote:\n' +
        '  npm run seed:fresh -- --force-remote\n\n' +
        'To rebuild a LOCAL database instead, unset DATABASE_URL (or use a .env.local without it).\n',
    );
    process.exit(1);
  }

  if (wantsFresh) {
    console.log('Dropping existing tables...');
    await fresh();
  }

  const { ran } = await runMigrations();
  console.log(ran === 0 ? 'Migrations up to date.' : `Applied ${ran} migration(s).`);
  console.log('');

  const manifest = JSON.parse(readFileSync(join(SEED, 'manifest.json'), 'utf8')) as {
    version: number;
    assets: ManifestEntry[];
  };

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const allWarnings: string[] = [];

  for (const entry of manifest.assets) {
    const path = join(SEED, entry.file);
    const source = readFileSync(path, 'utf8');

    try {
      // Sketches are imported so the real params object is used rather than
      // the conservative source-scrape the upload path has to rely on. The
      // resulting schema is now actually passed into ingestAsset (below) —
      // it used to be computed here just for these warnings and then
      // discarded, with ingestAsset silently re-deriving its own copy via
      // the regex-based extractParamsLiteral. That extractor corrupts any
      // hint/label containing an apostrophe (a blind `'` → `"` replace), so
      // a sketch could ingest with a silently empty schema — no warning
      // here, since this warnings-only call still succeeded on the real
      // object; the corruption only happened in ingestAsset's separate,
      // now-unused-for-this-path derivation.
      let precomputedSchema: ControlSchema | undefined;
      if (entry.type === 'p5') {
        const mod = (await import(pathToFileURL(path).href)) as { params?: unknown };
        const { schema, warnings } = paramsToSchema(mod.params, { schemaId: `sketch:${entry.slug}` });
        precomputedSchema = schema;
        for (const w of warnings) {
          if (w.level === 'warn') allWarnings.push(`${entry.slug}: ${w.message}`);
        }
      }

      const res = await ingestAsset({
        ownerId: LIBRARY_OWNER_ID,
        type: entry.type,
        title: entry.title,
        tags: entry.tags,
        source,
        seedSlug: entry.slug,
        boardOrder: manifest.assets.indexOf(entry),
        ...(precomputedSchema !== undefined ? { precomputedSchema } : {}),
      });

      allWarnings.push(...res.warnings);

      const controls = res.schema?.controls.length ?? 0;
      if (res.unchanged) {
        unchanged++;
        console.log(`  =  ${entry.slug.padEnd(20)} unchanged`);
      } else if (res.created) {
        created++;
        console.log(`  +  ${entry.slug.padEnd(20)} ${controls} controls`);
      } else {
        updated++;
        console.log(`  ~  ${entry.slug.padEnd(20)} ${controls} controls`);
      }
    } catch (err) {
      failed++;
      console.error(`  !  ${entry.slug.padEnd(20)} ${String(err)}`);
    }
  }

  const db = await getDb();
  const rows = await db.select().from(schema.assets);

  console.log(
    `\n${created} created, ${updated} updated, ${unchanged} unchanged, ${failed} failed`,
  );
  console.log(`${rows.length} assets in the database.`);

  const missingPoster = rows.filter((r) => !r.posterUrl).length;
  const missingSchema = rows.filter((r) => !r.schema).length;
  const missingTags = rows.filter((r) => r.tags.length === 0).length;

  console.log(
    `Posters: ${rows.length - missingPoster}/${rows.length} · ` +
      `Schemas: ${rows.length - missingSchema}/${rows.length} · ` +
      `Tagged: ${rows.length - missingTags}/${rows.length}`,
  );

  if (allWarnings.length) {
    console.log(`\nWarnings (${allWarnings.length}):`);
    for (const w of allWarnings) console.log(`  - ${w}`);
  }

  if (failed > 0 || missingPoster > 0 || missingTags > 0) {
    console.error('\nSeed incomplete.\n');
    process.exit(1);
  }

  console.log('\nSeed complete.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
