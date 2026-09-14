CREATE TABLE "church_ownership_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"church_id" text NOT NULL,
	"event_type" text NOT NULL,
	"previous_owner_membership_id" text,
	"new_owner_membership_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_session_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "church_ownership_audit_event_check" CHECK (("church_ownership_audit"."event_type" = 'initial_owner_established' and "church_ownership_audit"."previous_owner_membership_id" is null) or ("church_ownership_audit"."event_type" = 'ownership_transferred' and "church_ownership_audit"."previous_owner_membership_id" is not null and "church_ownership_audit"."previous_owner_membership_id" <> "church_ownership_audit"."new_owner_membership_id"))
);
--> statement-breakpoint
ALTER TABLE "church_ownership_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "church_primary_owner" (
	"church_id" text PRIMARY KEY NOT NULL,
	"membership_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "church_primary_owner" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "church_ownership_audit" ADD CONSTRAINT "church_ownership_audit_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "church_primary_owner" ADD CONSTRAINT "church_primary_owner_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "church_primary_owner" ADD CONSTRAINT "church_primary_owner_membership_fk" FOREIGN KEY ("church_id","membership_id") REFERENCES "public"."church_membership"("church_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "church_ownership_audit_church_time_idx" ON "church_ownership_audit" USING btree ("church_id","created_at","id");--> statement-breakpoint
CREATE POLICY "church_ownership_audit_tenant_scope" ON "church_ownership_audit" AS PERMISSIVE FOR ALL TO public USING ("church_ownership_audit"."church_id" = nullif(current_setting('app.current_church_id', true), '')) WITH CHECK ("church_ownership_audit"."church_id" = nullif(current_setting('app.current_church_id', true), ''));--> statement-breakpoint
CREATE POLICY "church_ownership_audit_no_update" ON "church_ownership_audit" AS RESTRICTIVE FOR UPDATE TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "church_ownership_audit_no_delete" ON "church_ownership_audit" AS RESTRICTIVE FOR DELETE TO public USING (false);--> statement-breakpoint
CREATE POLICY "church_primary_owner_tenant_scope" ON "church_primary_owner" AS PERMISSIVE FOR ALL TO public USING ("church_primary_owner"."church_id" = nullif(current_setting('app.current_church_id', true), '')) WITH CHECK ("church_primary_owner"."church_id" = nullif(current_setting('app.current_church_id', true), ''));
--> statement-breakpoint
-- Drizzle models ENABLE RLS; FORCE follows the established tenant migration convention.
ALTER TABLE "church_primary_owner" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "church_ownership_audit" FORCE ROW LEVEL SECURITY;
