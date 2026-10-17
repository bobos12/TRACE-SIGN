ALTER TABLE "organizations" ALTER COLUMN "timezone" SET DEFAULT 'America/Los_Angeles';--> statement-breakpoint
UPDATE "organizations" SET "timezone" = 'America/Los_Angeles', "updated_at" = now() WHERE "timezone" = 'UTC';
