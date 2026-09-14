import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

// Application-owned coordination, separate from generated Better Auth material.
// Row presence means pending; completion/disable removes it. Replacement changes
// the unique generation under a user-row lock, leaving no old confirmable row.
export const twoFactorEnrollment = pgTable("two_factor_enrollment", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  id: uuid("id").notNull().unique(),
  factorFingerprint: text("factor_fingerprint").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
