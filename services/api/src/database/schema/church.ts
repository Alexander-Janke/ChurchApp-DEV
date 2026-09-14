import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  check,
  uniqueIndex,
  pgPolicy,
} from "drizzle-orm/pg-core";

// Application-owned tenant root: id IS the tenant key; future children use church_id.
export const church = pgTable(
  "church",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 63 }).notNull(),
    addressLine1: varchar("address_line1", { length: 200 }),
    addressLine2: varchar("address_line2", { length: 200 }),
    postalCode: varchar("postal_code", { length: 32 }),
    locality: varchar("locality", { length: 120 }),
    region: varchar("region", { length: 120 }),
    countryCode: varchar("country_code", { length: 2 }),
    denomination: varchar("denomination", { length: 120 }),
    logo: varchar("logo", { length: 2048 }),
    status: text("status", { enum: ["active", "inactive"] })
      .default("active")
      .notNull(),
    verificationState: text("verification_state", {
      enum: ["unverified", "pending", "verified", "rejected", "revoked"],
    })
      .default("unverified")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("church_slug_idx").on(t.slug),
    check(
      "church_slug_check",
      sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'`,
    ),
    check("church_name_check", sql`length(btrim(${t.name})) > 0`),
    check("church_country_check", sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    check("church_status_check", sql`${t.status} in ('active', 'inactive')`),
    check(
      "church_verification_check",
      sql`${t.verificationState} in ('unverified','pending','verified','rejected','revoked')`,
    ),
    pgPolicy("church_tenant_scope", {
      for: "all",
      to: "public",
      using: sql`${t.id} = nullif(current_setting('app.current_church_id', true), '')`,
      withCheck: sql`${t.id} = nullif(current_setting('app.current_church_id', true), '')`,
    }),
  ],
).enableRLS();
