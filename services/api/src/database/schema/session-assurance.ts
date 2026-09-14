import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { session } from "./auth.js";

// Application-owned, global session state. Ownership comes from the referenced
// session; omitting redundant userId prevents inconsistent user/session pairs.
export const sessionAssurance = pgTable("session_assurance", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => session.id, { onDelete: "cascade" }),
  elevatedAt: timestamp("elevated_at", { withTimezone: true }),
  lastElevatedActivityAt: timestamp("last_elevated_activity_at", {
    withTimezone: true,
  }),
  stepUpAt: timestamp("step_up_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
