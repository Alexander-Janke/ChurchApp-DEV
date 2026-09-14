CREATE TABLE "church_membership" (
	"id" text PRIMARY KEY NOT NULL,
	"church_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "church_membership_status_check" CHECK ("church_membership"."status" in ('follower','member','inactive','left'))
);
--> statement-breakpoint
ALTER TABLE "church_membership" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "church_membership" ADD CONSTRAINT "church_membership_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "church_membership" ADD CONSTRAINT "church_membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "church_membership_church_user_idx" ON "church_membership" USING btree ("church_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "church_membership_church_id_idx" ON "church_membership" USING btree ("church_id","id");--> statement-breakpoint
CREATE INDEX "church_membership_user_idx" ON "church_membership" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "church_membership_tenant_scope" ON "church_membership" AS PERMISSIVE FOR ALL TO public USING ("church_membership"."church_id" = nullif(current_setting('app.current_church_id', true), '')) WITH CHECK ("church_membership"."church_id" = nullif(current_setting('app.current_church_id', true), ''));
--> statement-breakpoint
-- Drizzle models ENABLE RLS and policy; FORCE is reviewed PostgreSQL-specific SQL.
ALTER TABLE "church_membership" FORCE ROW LEVEL SECURITY;
