CREATE TABLE "two_factor_enrollment" (
	"user_id" text PRIMARY KEY NOT NULL,
	"id" uuid NOT NULL,
	"factor_fingerprint" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "two_factor_enrollment_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "two_factor_enrollment" ADD CONSTRAINT "two_factor_enrollment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;