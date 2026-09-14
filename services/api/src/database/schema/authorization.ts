import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
  foreignKey,
  check,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { church } from "./church.js";
import { churchMembership } from "./church-membership.js";

// Application-owned tenant authorization data. No seeded or privileged roles.
export const churchRole = pgTable(
  "church_role",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    churchId: text("church_id")
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: varchar("description", { length: 500 }),
    isSystem: boolean("is_system").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("church_role_church_id_idx").on(t.churchId, t.id),
    uniqueIndex("church_role_church_name_idx").on(
      t.churchId,
      sql`lower(${t.name})`,
    ),
    check(
      "church_role_name_check",
      sql`length(btrim(${t.name})) > 0 and ${t.name} = btrim(${t.name})`,
    ),
    pgPolicy("church_role_tenant_scope", {
      for: "all",
      to: "public",
      using: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
      withCheck: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
    }),
  ],
).enableRLS();

export const churchRolePermission = pgTable(
  "church_role_permission",
  {
    churchId: text("church_id").notNull(),
    roleId: text("role_id").notNull(),
    permission: varchar("permission", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.churchId, t.roleId, t.permission] }),
    foreignKey({
      name: "church_role_permission_role_fk",
      columns: [t.churchId, t.roleId],
      foreignColumns: [churchRole.churchId, churchRole.id],
    }).onDelete("cascade"),
    // Syntax guard only; the code registry is authoritative for supported keys.
    check(
      "church_role_permission_key_check",
      sql`${t.permission} ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'`,
    ),
    pgPolicy("church_role_permission_tenant_scope", {
      for: "all",
      to: "public",
      using: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
      withCheck: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
    }),
  ],
).enableRLS();

export const churchMembershipRole = pgTable(
  "church_membership_role",
  {
    churchId: text("church_id").notNull(),
    membershipId: text("membership_id").notNull(),
    roleId: text("role_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.churchId, t.membershipId, t.roleId] }),
    foreignKey({
      name: "church_membership_role_membership_fk",
      columns: [t.churchId, t.membershipId],
      foreignColumns: [churchMembership.churchId, churchMembership.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "church_membership_role_role_fk",
      columns: [t.churchId, t.roleId],
      foreignColumns: [churchRole.churchId, churchRole.id],
    }).onDelete("cascade"),
    index("church_membership_role_role_idx").on(t.churchId, t.roleId),
    pgPolicy("church_membership_role_tenant_scope", {
      for: "all",
      to: "public",
      using: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
      withCheck: sql`${t.churchId} = nullif(current_setting('app.current_church_id', true), '')`,
    }),
  ],
).enableRLS();
