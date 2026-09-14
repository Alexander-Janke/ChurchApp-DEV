CREATE TABLE "church" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(63) NOT NULL,
	"address_line1" varchar(200),
	"address_line2" varchar(200),
	"postal_code" varchar(32),
	"locality" varchar(120),
	"region" varchar(120),
	"country_code" varchar(2),
	"denomination" varchar(120),
	"logo" varchar(2048),
	"status" text DEFAULT 'active' NOT NULL,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "church_slug_check" CHECK ("church"."slug" ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
	CONSTRAINT "church_name_check" CHECK (length(btrim("church"."name")) > 0),
	CONSTRAINT "church_country_check" CHECK ("church"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "church_status_check" CHECK ("church"."status" in ('active', 'inactive')),
	CONSTRAINT "church_verification_check" CHECK ("church"."verification_state" in ('unverified','pending','verified','rejected','revoked'))
);
--> statement-breakpoint
ALTER TABLE "church" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "church_slug_idx" ON "church" USING btree ("slug");--> statement-breakpoint
CREATE POLICY "church_tenant_scope" ON "church" AS PERMISSIVE FOR ALL TO public USING ("church"."id" = nullif(current_setting('app.current_church_id', true), '')) WITH CHECK ("church"."id" = nullif(current_setting('app.current_church_id', true), ''));
--> statement-breakpoint
-- Drizzle models ENABLE RLS and policy; FORCE is reviewed PostgreSQL-specific SQL.
ALTER TABLE "church" FORCE ROW LEVEL SECURITY;
