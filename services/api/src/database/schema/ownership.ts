import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  foreignKey,
  index,
  check,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { church } from "./church.js";
import { churchMembership } from "./church-membership.js";

// Application-owned protected relationship, never a role or permission bundle.
export const churchPrimaryOwner = pgTable(
  "church_primary_owner",
  {
    churchId: text("church_id")
      .primaryKey()
      .references(() => church.id, { onDelete: "cascade" }),
    membershipId: text("membership_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      name: "church_primary_owner_membership_fk",
      columns: [t.churchId, t.membershipId],
      foreignColumns: [churchMembership.churchId, churchMembership.id],
    }).onDelete("cascade"),
    pgPolicy("church_primary_owner_tenant_scope", {
      for: "all",
      to: "public",
      using: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
      withCheck: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
    }),
  ],
).enableRLS();

// Historical IDs are immutable snapshots, deliberately not cascading user/session/
// membership FKs. Only full church deletion cascades this tenant's evidence.
export const churchOwnershipAudit = pgTable(
  "church_ownership_audit",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    churchId: text("church_id")
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    eventType: text("event_type", {
      enum: ["initial_owner_established", "ownership_transferred"],
    }).notNull(),
    previousOwnerMembershipId: text("previous_owner_membership_id"),
    newOwnerMembershipId: text("new_owner_membership_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorSessionId: text("actor_session_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("church_ownership_audit_church_time_idx").on(
      t.churchId,
      t.createdAt,
      t.id,
    ),
    check(
      "church_ownership_audit_event_check",
      sql`(${t.eventType} = 'initial_owner_established' and ${t.previousOwnerMembershipId} is null) or (${t.eventType} = 'ownership_transferred' and ${t.previousOwnerMembershipId} is not null and ${t.previousOwnerMembershipId} <> ${t.newOwnerMembershipId})`,
    ),
    pgPolicy("church_ownership_audit_tenant_scope", {
      for: "all",
      to: "public",
      using: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
      withCheck: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
    }),
    pgPolicy("church_ownership_audit_no_update", {
      as: "restrictive",
      for: "update",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    pgPolicy("church_ownership_audit_no_delete", {
      as: "restrictive",
      for: "delete",
      to: "public",
      using: sql`false`,
    }),
  ],
).enableRLS();
