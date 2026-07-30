CREATE TYPE "public"."asset_type" AS ENUM('image', 'svg', 'video', 'p5', 'shader');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"type" "asset_type" NOT NULL,
	"title" text NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"src_url" text,
	"source" text,
	"poster_url" text NOT NULL,
	"schema" jsonb,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mod" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dominant_colors" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"seed_slug" text,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_items" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"x" real,
	"y" real,
	"w" real,
	"h" real,
	"params_override" jsonb
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_owner_idx" ON "assets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "assets_type_idx" ON "assets" USING btree ("type");--> statement-breakpoint
CREATE INDEX "assets_updated_idx" ON "assets" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_seed_slug_idx" ON "assets" USING btree ("owner_id","seed_slug");--> statement-breakpoint
CREATE INDEX "board_items_board_idx" ON "board_items" USING btree ("board_id","order");--> statement-breakpoint
CREATE INDEX "board_items_asset_idx" ON "board_items" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "boards_owner_idx" ON "boards" USING btree ("owner_id");