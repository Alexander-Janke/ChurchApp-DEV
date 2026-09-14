import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  index,
  check,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { church } from "./church.js";

// Application-owned append-only evidence. Actor identifiers are historical snapshots;
// deleting a user, membership or session must not delete administrative evidence.
export const churchAdminAudit = pgTable(
  "church_admin_audit",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    churchId: text("church_id")
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    eventType: text("event_type", {
      enum: ["church_settings_updated"],
    }).notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorSessionId: text("actor_session_id").notNull(),
    changedFields: text("changed_fields").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("church_admin_audit_church_time_idx").on(
      t.churchId,
      t.createdAt,
      t.id,
    ),
    check(
      "church_admin_audit_event_check",
      sql`${t.eventType} = 'church_settings_updated'`,
    ),
    check(
      "church_admin_audit_fields_check",
      sql`${t.changedFields} <@ ARRAY['name','slug','addressLine1','addressLine2','postalCode','locality','region','countryCode','denomination','logo']::text[] AND array_position(${t.changedFields}, NULL) IS NULL`,
    ),
    pgPolicy("church_admin_audit_tenant_scope", {
      for: "all",
      to: "public",
      using: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
      withCheck: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
    }),
    pgPolicy("church_admin_audit_no_update", {
      as: "restrictive",
      for: "update",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    pgPolicy("church_admin_audit_no_delete", {
      as: "restrictive",
      for: "delete",
      to: "public",
      using: sql`false`,
    }),
  ],
).enableRLS();
