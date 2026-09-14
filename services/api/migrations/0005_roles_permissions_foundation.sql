CREATE TABLE "church_membership_role" (
	"church_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "church_membership_role_church_id_membership_id_role_id_pk" PRIMARY KEY("church_id","membership_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "church_membership_role" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "church_role" (
	"id" text PRIMARY KEY NOT NULL,
	"church_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "church_role_name_check" CHECK (length(btrim("church_role"."name")) > 0 and "church_role"."name" = btrim("church_role"."name"))
);
--> statement-breakpoint
ALTER TABLE "church_role" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "church_role_permission" (
	"church_id" text NOT NULL,
	"role_id" text NOT NULL,
	"permission" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "church_role_permission_church_id_role_id_permission_pk" PRIMARY KEY("church_id","role_id","permission"),
	CONSTRAINT "church_role_permission_key_check" CHECK ("church_role_permission"."permission" ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$')
);
--> statement-breakpoint
ALTER TABLE "church_role_permission" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Referenced composite uniqueness must exist before foreign keys.
CREATE UNIQUE INDEX "church_role_church_id_idx" ON "church_role" USING btree ("church_id","id");--> statement-breakpoint
ALTER TABLE "church_membership_role" ADD CONSTRAINT "church_membership_role_membership_fk" FOREIGN KEY ("church_id","membership_id") REFERENCES "public"."church_membership"("church_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "church_membership_role" ADD CONSTRAINT "church_membership_role_role_fk" FOREIGN KEY ("church_id","role_id") REFERENCES "public"."church_role"("church_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "church_role" ADD CONSTRAINT "church_role_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "church_role_permission" ADD CONSTRAINT "church_role_permission_role_fk" FOREIGN KEY ("church_id","role_id") REFERENCES "public"."church_role"("church_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "church_membership_role_role_idx" ON "church_membership_role" USING btree ("church_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "church_role_church_name_idx" ON "church_role" USING btree ("church_id",lower("name"));--> statement-breakpoint
CREATE POLICY "church_membership_role_tenant_scope" ON "church_membership_role" AS PERMISSIVE FOR ALL TO public USING ("church_membership_role"."church_id" = nullif(current_setting('app.current_church_id', true), '')) WITH CHECK ("church_membership_role"."church_id" = nullif(current_setting('app.current_church_id', true), ''));--> statement-breakpoint
CREATE POLICY "church_role_tenant_scope" ON "church_role" AS PERMISSIVE FOR ALL TO public USING ("church_role"."church_id" = nullif(current_setting('app.current_church_id', true), '')) WITH CHECK ("church_role"."church_id" = nullif(current_setting('app.current_church_id', true), ''));--> statement-breakpoint
CREATE POLICY "church_role_permission_tenant_scope" ON "church_role_permission" AS PERMISSIVE FOR ALL TO public USING ("church_role_permission"."church_id" = nullif(current_setting('app.current_church_id', true), '')) WITH CHECK ("church_role_permission"."church_id" = nullif(current_setting('app.current_church_id', true), ''));
--> statement-breakpoint
ALTER TABLE "church_role" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "church_role_permission" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "church_membership_role" FORCE ROW LEVEL SECURITY;
