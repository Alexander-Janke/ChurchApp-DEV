import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  check,
  uniqueIndex,
  index,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { church } from "./church.js";
import { user } from "./auth.js";

// Application-owned relationship: states are not administrative roles.
export const churchMembership = pgTable(
  "church_membership",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    churchId: text("church_id")
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["follower", "member", "inactive", "left"],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("church_membership_church_user_idx").on(t.churchId, t.userId),
    // Supports future composite tenant-safe foreign keys.
    uniqueIndex("church_membership_church_id_idx").on(t.churchId, t.id),
    // Supports global-user deletion/FK cascade; not a cross-tenant repository API.
    index("church_membership_user_idx").on(t.userId),
    check(
      "church_membership_status_check",
      sql`${t.status} in ('follower','member','inactive','left')`,
    ),
    pgPolicy("church_membership_tenant_scope", {
      for: "all",
      to: "public",
      using: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
      withCheck: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
    }),
  ],
).enableRLS();
