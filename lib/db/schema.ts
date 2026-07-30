import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { ControlSchema, ModState, ParamState } from '@/renderers/control-schema';

export const assetTypeEnum = pgEnum('asset_type', ['image', 'svg', 'video', 'p5', 'shader']);

/**
 * Code assets (p5, shader) store `source` as text rather than a blob. That
 * makes them searchable, diffable, and versionable for free — and it means
 * the seed library is just rows, not files in a bucket.
 *
 * Binary assets store `srcUrl` pointing at blob storage. Nothing ever streams
 * through an API route.
 */
export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    type: assetTypeEnum('type').notNull(),
    title: text('title').notNull(),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),

    srcUrl: text('src_url'),
    source: text('source'),
    posterUrl: text('poster_url').notNull(),

    /** Cached parse result. Regenerated when `source` changes. */
    schema: jsonb('schema').$type<ControlSchema>(),
    params: jsonb('params').$type<ParamState>().notNull().default({}),
    mod: jsonb('mod').$type<ModState>().notNull().default({}),

    dominantColors: text('dominant_colors').array().notNull().default(sql`ARRAY[]::text[]`),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),

    /** Set for seed assets so re-running the seed script upserts rather than duplicates. */
    seedSlug: text('seed_slug'),
    /** sha256 of `source` or the uploaded bytes. Drives poster and schema cache invalidation. */
    contentHash: text('content_hash').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assets_owner_idx').on(t.ownerId),
    index('assets_type_idx').on(t.type),
    index('assets_updated_idx').on(t.updatedAt),
    uniqueIndex('assets_seed_slug_idx').on(t.ownerId, t.seedSlug),
  ],
);

export const boards = pgTable(
  'boards',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('boards_owner_idx').on(t.ownerId)],
);

/**
 * `paramsOverride` is the highest-leverage column in the schema: it turns one
 * shader into many distinct board items at near-zero storage cost.
 */
export const boardItems = pgTable(
  'board_items',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),

    x: real('x'),
    y: real('y'),
    w: real('w'),
    h: real('h'),

    paramsOverride: jsonb('params_override').$type<ParamState>(),
  },
  (t) => [
    index('board_items_board_idx').on(t.boardId, t.order),
    index('board_items_asset_idx').on(t.assetId),
  ],
);

export const boardsRelations = relations(boards, ({ many }) => ({
  items: many(boardItems),
}));

export const boardItemsRelations = relations(boardItems, ({ one }) => ({
  board: one(boards, { fields: [boardItems.boardId], references: [boards.id] }),
  asset: one(assets, { fields: [boardItems.assetId], references: [assets.id] }),
}));

export const assetsRelations = relations(assets, ({ many }) => ({
  boardItems: many(boardItems),
}));

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
export type BoardRow = typeof boards.$inferSelect;
export type BoardItemRow = typeof boardItems.$inferSelect;
