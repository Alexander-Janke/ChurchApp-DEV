import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";
import { AUTH_SECURITY_EVENTS } from "../../auth/auth-security-event-policy.js";

// Application-owned GLOBAL authentication history. Historical identifiers have
// no foreign keys: deleting identity/session/tenant data must not erase evidence.
// Runtime grants INSERT only; no tenant RLS or public reader/writer endpoint.
export const authSecurityEvent = pgTable(
  "auth_security_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    eventType: text("event_type", { enum: AUTH_SECURITY_EVENTS }).notNull(),
    actorUserId: text("actor_user_id"),
    subjectUserId: text("subject_user_id"),
    sessionId: text("session_id"),
    outcome: text("outcome", { enum: ["success", "failure"] }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("auth_security_event_subject_time_idx").on(
      t.subjectUserId,
      t.createdAt,
      t.id,
    ),
    check(
      "auth_security_event_type_check",
      sql`${t.eventType} IN ('password_changed','password_reset','email_changed','two_factor_enabled','two_factor_disabled','recovery_codes_regenerated','recovery_code_used','session_revoked','authentication_failure')`,
    ),
    check(
      "auth_security_event_identity_check",
      sql`(${t.actorUserId} IS NULL OR ${t.actorUserId} ~ '^[A-Za-z0-9_-]{1,128}$') AND (${t.subjectUserId} IS NULL OR ${t.subjectUserId} ~ '^[A-Za-z0-9_-]{1,128}$') AND (${t.sessionId} IS NULL OR ${t.sessionId} ~ '^[A-Za-z0-9_-]{1,128}$') AND (${t.eventType} = 'authentication_failure' OR (${t.actorUserId} IS NOT NULL AND ${t.subjectUserId} IS NOT NULL AND ${t.actorUserId} = ${t.subjectUserId})) AND (${t.eventType} <> 'session_revoked' OR ${t.sessionId} IS NOT NULL)`,
    ),
    check(
      "auth_security_event_metadata_check",
      sql`CASE WHEN ${t.eventType} = 'authentication_failure' THEN ${t.outcome} = 'failure' AND ${t.metadata} IN ('{"method":"password","category":"repeated"}'::jsonb,'{"method":"password","category":"suspicious"}'::jsonb,'{"method":"totp","category":"repeated"}'::jsonb,'{"method":"totp","category":"suspicious"}'::jsonb,'{"method":"recovery","category":"repeated"}'::jsonb,'{"method":"recovery","category":"suspicious"}'::jsonb) WHEN ${t.eventType} = 'recovery_code_used' THEN ${t.outcome} = 'success' AND ${t.metadata} IN ('{"purpose":"authentication"}'::jsonb,'{"purpose":"elevation"}'::jsonb,'{"purpose":"step_up"}'::jsonb) ELSE ${t.outcome} = 'success' AND ${t.metadata} = '{}'::jsonb END`,
    ),
  ],
);
