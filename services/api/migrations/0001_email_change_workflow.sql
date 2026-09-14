CREATE TABLE "email_change_request" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"initiating_session_id" text NOT NULL,
	"current_email" text NOT NULL,
	"new_email" text NOT NULL,
	"status" text NOT NULL,
	"current_email_token_hash" text,
	"new_email_token_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"current_email_approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "email_change_state_check" CHECK (("email_change_request"."status" = 'pending_current_email' and "email_change_request"."current_email_token_hash" is not null and "email_change_request"."new_email_token_hash" is null) or ("email_change_request"."status" = 'pending_new_email' and "email_change_request"."current_email_token_hash" is null and "email_change_request"."new_email_token_hash" is not null) or ("email_change_request"."status" in ('completed', 'superseded') and "email_change_request"."current_email_token_hash" is null and "email_change_request"."new_email_token_hash" is null))
);
--> statement-breakpoint
ALTER TABLE "email_change_request" ADD CONSTRAINT "email_change_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_change_active_user_idx" ON "email_change_request" USING btree ("user_id") WHERE "email_change_request"."status" in ('pending_current_email', 'pending_new_email');--> statement-breakpoint
CREATE UNIQUE INDEX "email_change_current_hash_idx" ON "email_change_request" USING btree ("current_email_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "email_change_new_hash_idx" ON "email_change_request" USING btree ("new_email_token_hash");