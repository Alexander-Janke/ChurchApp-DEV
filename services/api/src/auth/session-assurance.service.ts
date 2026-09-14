import type { DatabaseService } from "../database/database.service.js";
import { and, eq, inArray } from "drizzle-orm";
import type {
  Database,
  DatabaseTransaction,
} from "../database/database.types.js";
import { session } from "../database/schema/auth.js";
import { sessionAssurance } from "../database/schema/session-assurance.js";
import { AssurancePolicy, NO_ASSURANCE } from "./assurance-policy.js";

// Internal server-resolved identity, NEVER a request DTO or client assertion.
export interface SessionSubject {
  readonly userId: string;
  readonly sessionId: string;
}

// Shared by supported Better Auth factor-disable hook and explicit invalidation.
// Deletion cannot create assurance; failure must stop the security transition.
export async function invalidateUserAssurance(
  db: Database | DatabaseTransaction,
  userId: string,
) {
  await db
    .delete(sessionAssurance)
    .where(
      inArray(
        sessionAssurance.sessionId,
        db
          .select({ id: session.id })
          .from(session)
          .where(eq(session.userId, userId)),
      ),
    );
}

export class SessionAssuranceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly policy = new AssurancePolicy(),
  ) {}
  private get db() {
    return this.database.db;
  }

  // Can participate in a caller's SAME protected-operation/tenant transaction.
  async evaluate(
    subject: SessionSubject,
    db: Database | DatabaseTransaction = this.db,
  ) {
    try {
      const [row] = await db
        .select({
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          elevatedAt: sessionAssurance.elevatedAt,
          lastElevatedActivityAt: sessionAssurance.lastElevatedActivityAt,
          stepUpAt: sessionAssurance.stepUpAt,
        })
        .from(session)
        .leftJoin(sessionAssurance, eq(sessionAssurance.sessionId, session.id))
        .where(
          and(
            eq(session.id, subject.sessionId),
            eq(session.userId, subject.userId),
          ),
        )
        .limit(1);
      return row ? this.policy.evaluate(row, row) : { ...NO_ASSURANCE };
    } catch {
      throw new Error("Assurance evaluation failed");
    }
  }

  // Explicit internal hook ONLY after successful privileged work. No polling,
  // session-read, profile or heartbeat wiring. Never inserts/upserts or slides proof.
  async recordSuccessfulPrivilegedActivity(subject: SessionSubject) {
    try {
      return await this.database.transaction(async (tx) => {
        const [current] = await tx
          .select({
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
          })
          .from(session)
          .where(
            and(
              eq(session.id, subject.sessionId),
              eq(session.userId, subject.userId),
            ),
          )
          .for("share");
        if (!current) return false;
        const [state] = await tx
          .select()
          .from(sessionAssurance)
          .where(eq(sessionAssurance.sessionId, subject.sessionId))
          .for("update");
        // Take time AFTER the lock: lock wait cannot renew an expired elevation.
        const now = this.policy.now();
        if (
          !state ||
          !new AssurancePolicy(() => now).evaluate(current, state).elevated
        )
          return false;
        await tx
          .update(sessionAssurance)
          .set({
            lastElevatedActivityAt: new Date(
              Math.max(now, state.lastElevatedActivityAt!.getTime()),
            ),
            updatedAt: new Date(Math.max(now, state.updatedAt.getTime())),
          })
          .where(eq(sessionAssurance.sessionId, subject.sessionId));
        return true;
      });
    } catch {
      throw new Error("Assurance activity update failed");
    }
  }

  async invalidateSession(subject: SessionSubject) {
    try {
      await this.db.delete(sessionAssurance).where(
        inArray(
          sessionAssurance.sessionId,
          this.db
            .select({ id: session.id })
            .from(session)
            .where(
              and(
                eq(session.id, subject.sessionId),
                eq(session.userId, subject.userId),
              ),
            ),
        ),
      );
    } catch {
      throw new Error("Assurance invalidation failed");
    }
  }
  async invalidateUser(userId: string) {
    try {
      await invalidateUserAssurance(this.db, userId);
    } catch {
      throw new Error("Assurance invalidation failed");
    }
  }
}
