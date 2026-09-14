CREATE TABLE "church_admin_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"church_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_session_id" text NOT NULL,
	"changed_fields" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "church_admin_audit_event_check" CHECK ("church_admin_audit"."event_type" = 'church_settings_updated'),
	CONSTRAINT "church_admin_audit_fields_check" CHECK ("church_admin_audit"."changed_fields" <@ ARRAY['name','slug','addressLine1','addressLine2','postalCode','locality','region','countryCode','denomination','logo']::text[] AND array_position("church_admin_audit"."changed_fields", NULL) IS NULL)
);
--> statement-breakpoint
ALTER TABLE "church_admin_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "church_admin_audit" ADD CONSTRAINT "church_admin_audit_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "church_admin_audit_church_time_idx" ON "church_admin_audit" USING btree ("church_id","created_at","id");--> statement-breakpoint
CREATE POLICY "church_admin_audit_tenant_scope" ON "church_admin_audit" AS PERMISSIVE FOR ALL TO public USING ("church_admin_audit"."church_id" = nullif(current_setting('app.current_church_id', true), '')) WITH CHECK ("church_admin_audit"."church_id" = nullif(current_setting('app.current_church_id', true), ''));--> statement-breakpoint
CREATE POLICY "church_admin_audit_no_update" ON "church_admin_audit" AS RESTRICTIVE FOR UPDATE TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "church_admin_audit_no_delete" ON "church_admin_audit" AS RESTRICTIVE FOR DELETE TO public USING (false);
--> statement-breakpoint
-- Drizzle models ENABLE RLS; FORCE follows the established tenant migration convention.
ALTER TABLE "church_admin_audit" FORCE ROW LEVEL SECURITY;
