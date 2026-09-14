CREATE TABLE "user_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"username" varchar(30),
	"first_name" varchar(100),
	"last_name" varchar(100),
	"date_of_birth" date,
	"phone_number" varchar(16),
	"address_line1" varchar(200),
	"address_line2" varchar(200),
	"postal_code" varchar(32),
	"locality" varchar(120),
	"region" varchar(120),
	"country_code" varchar(2),
	"biography" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_username_check" CHECK ("user_profile"."username" ~ '^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$')
);
--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_profile_username_idx" ON "user_profile" USING btree ("username");