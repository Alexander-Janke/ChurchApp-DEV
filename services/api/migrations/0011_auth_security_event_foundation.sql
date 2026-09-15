CREATE TABLE "auth_security_event" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"subject_user_id" text,
	"session_id" text,
	"outcome" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_security_event_type_check" CHECK ("auth_security_event"."event_type" IN ('password_changed','password_reset','email_changed','two_factor_enabled','two_factor_disabled','recovery_codes_regenerated','recovery_code_used','session_revoked','authentication_failure')),
	CONSTRAINT "auth_security_event_identity_check" CHECK (("auth_security_event"."actor_user_id" IS NULL OR "auth_security_event"."actor_user_id" ~ '^[A-Za-z0-9_-]{1,128}$') AND ("auth_security_event"."subject_user_id" IS NULL OR "auth_security_event"."subject_user_id" ~ '^[A-Za-z0-9_-]{1,128}$') AND ("auth_security_event"."session_id" IS NULL OR "auth_security_event"."session_id" ~ '^[A-Za-z0-9_-]{1,128}$') AND ("auth_security_event"."event_type" = 'authentication_failure' OR ("auth_security_event"."actor_user_id" IS NOT NULL AND "auth_security_event"."subject_user_id" IS NOT NULL AND "auth_security_event"."actor_user_id" = "auth_security_event"."subject_user_id")) AND ("auth_security_event"."event_type" <> 'session_revoked' OR "auth_security_event"."session_id" IS NOT NULL)),
	CONSTRAINT "auth_security_event_metadata_check" CHECK (CASE WHEN "auth_security_event"."event_type" = 'authentication_failure' THEN "auth_security_event"."outcome" = 'failure' AND "auth_security_event"."metadata" IN ('{"method":"password","category":"repeated"}'::jsonb,'{"method":"password","category":"suspicious"}'::jsonb,'{"method":"totp","category":"repeated"}'::jsonb,'{"method":"totp","category":"suspicious"}'::jsonb,'{"method":"recovery","category":"repeated"}'::jsonb,'{"method":"recovery","category":"suspicious"}'::jsonb) WHEN "auth_security_event"."event_type" = 'recovery_code_used' THEN "auth_security_event"."outcome" = 'success' AND "auth_security_event"."metadata" IN ('{"purpose":"authentication"}'::jsonb,'{"purpose":"elevation"}'::jsonb,'{"purpose":"step_up"}'::jsonb) ELSE "auth_security_event"."outcome" = 'success' AND "auth_security_event"."metadata" = '{}'::jsonb END)
);
--> statement-breakpoint
CREATE INDEX "auth_security_event_subject_time_idx" ON "auth_security_event" USING btree ("subject_user_id","created_at","id");