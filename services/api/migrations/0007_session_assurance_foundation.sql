CREATE TABLE "session_assurance" (
	"session_id" text PRIMARY KEY NOT NULL,
	"elevated_at" timestamp with time zone,
	"last_elevated_activity_at" timestamp with time zone,
	"step_up_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_assurance" ADD CONSTRAINT "session_assurance_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;