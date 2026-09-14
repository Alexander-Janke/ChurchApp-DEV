import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  date,
  timestamp,
  check,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";

// Application-owned product data. Better Auth's generated identity is unchanged.
export const userProfile = pgTable(
  "user_profile",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    username: varchar("username", { length: 30 }),
    firstName: varchar("first_name", { length: 100 }),
    lastName: varchar("last_name", { length: 100 }),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    phoneNumber: varchar("phone_number", { length: 16 }),
    addressLine1: varchar("address_line1", { length: 200 }),
    addressLine2: varchar("address_line2", { length: 200 }),
    postalCode: varchar("postal_code", { length: 32 }),
    locality: varchar("locality", { length: 120 }),
    region: varchar("region", { length: 120 }),
    countryCode: varchar("country_code", { length: 2 }),
    biography: varchar("biography", { length: 2000 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("user_profile_username_idx").on(t.username),
    check(
      "user_profile_username_check",
      sql`${t.username} ~ '^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$'`,
    ),
  ],
);
