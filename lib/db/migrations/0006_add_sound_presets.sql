ALTER TABLE "assets" ADD COLUMN "sound" jsonb DEFAULT '{"enabled":false,"presetId":null,"key":"C","scale":"major","octave":0,"volume":0.7}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "board_items" ADD COLUMN "sound_override" jsonb;
