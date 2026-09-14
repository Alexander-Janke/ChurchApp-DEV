import { and, eq, inArray, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { APIError, isAPIError } from "better-auth/api";
import { Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import type { DatabaseTransaction } from "../database/database.types.js";
import { user, session } from "../database/schema/auth.js";
import { emailChangeRequest as requests } from "../database/schema/email-change.js";
import { AuthEmailSender } from "./auth-email.js";
import { AuthSessionPolicy } from "./auth-session-policy.js";
import {
  activeEmailChangeStates,
  EMAIL_CHANGE_LIFETIME_MS,
  emailChangeExpired,
  hashEmailChangeToken,
  invalidEmailChange,
  newEmailChangeToken,
  normalizeEmail,
} from "./email-change-policy.js";

// Module-owned data access and use cases: one user-first lock order for every
// transition, including creation. Never resolve ownership from an email address.
export class EmailChangeService {
  private readonly logger = new Logger("EmailChange");
  constructor(
    private readonly database: DatabaseService,
    private readonly mail: AuthEmailSender,
    private readonly baseURL: string,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isAPIError(error)) throw error;
      // Includes unique-constraint races and provider/connection errors. No SQL,
      // request bodies, tokens, addresses or provider diagnostics cross the boundary.
      this.logger.error("Email change operation failed");
      throw new APIError("SERVICE_UNAVAILABLE", {
        code: "EMAIL_CHANGE_UNAVAILABLE",
        message: "Email change could not be completed",
      });
    }
  }
  private link(phase: "approve-current" | "verify-new", token: string): string {
    const url = new URL(`/account/email-change/${phase}`, this.baseURL);
    // Future UI reads the fragment and POSTs it; GET/scanners never mutate state.
    url.hash = new URLSearchParams({ token }).toString();
    return url.toString();
  }
  private async lockUser(tx: DatabaseTransaction, id: string) {
    const [owner] = await tx
      .select()
      .from(user)
      .where(eq(user.id, id))
      .for("update");
    if (!owner) throw invalidEmailChange();
    return owner;
  }
  async request(
    actor: { userId: string; sessionId: string },
    proposed: string,
  ) {
    return this.safe(async () => {
      this.mail.assertAvailable();
      const email = normalizeEmail(proposed);
      await this.database.transaction(async (tx) => {
        const owner = await this.lockUser(tx, actor.userId);
        const [current] = await tx
          .select()
          .from(session)
          .where(
            and(eq(session.id, actor.sessionId), eq(session.userId, owner.id)),
          )
          .for("update");
        if (
          !current ||
          new AuthSessionPolicy(() => this.now().getTime()).isExpired(current)
        )
          throw new APIError("UNAUTHORIZED", { message: "Unauthorized" });
        if (email === owner.email.toLowerCase()) throw invalidEmailChange();
        if (
          (
            await tx
              .select({ id: user.id })
              .from(user)
              .where(eq(user.email, email))
          ).length
        )
          throw invalidEmailChange();
        const now = this.now();
        await tx
          .update(requests)
          .set({
            status: "superseded",
            currentEmailTokenHash: null,
            newEmailTokenHash: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(requests.userId, owner.id),
              inArray(requests.status, [...activeEmailChangeStates]),
            ),
          );
        const credential = newEmailChangeToken();
        await tx.insert(requests).values({
          id: randomUUID(),
          userId: owner.id,
          initiatingSessionId: current.id,
          currentEmail: owner.email,
          newEmail: email,
          status: "pending_current_email",
          currentEmailTokenHash: credential.hash,
          expiresAt: new Date(now.getTime() + EMAIL_CHANGE_LIFETIME_MS),
          createdAt: now,
          updatedAt: now,
        });
        // Bounded, tracked delivery. Failure rolls back creation/supersession.
        await this.mail.deliverEmailChangeApproval({
          recipient: owner.email,
          newEmail: email,
          token: credential.token,
          url: this.link("approve-current", credential.token),
        });
      });
    });
  }
  async approve(token: string) {
    return this.transition(token, false);
  }
  async verify(token: string) {
    return this.transition(token, true);
  }
  private async transition(token: string, final: boolean) {
    return this.safe(async () => {
      if (!final) this.mail.assertAvailable();
      const hash = hashEmailChangeToken(token);
      const column = final
        ? requests.newEmailTokenHash
        : requests.currentEmailTokenHash;
      const [candidate] = await this.database.db
        .select({ userId: requests.userId, id: requests.id })
        .from(requests)
        .where(eq(column, hash));
      if (!candidate) throw invalidEmailChange();
      const completed = await this.database.transaction(async (tx) => {
        const owner = await this.lockUser(tx, candidate.userId);
        const [row] = await tx
          .select()
          .from(requests)
          .where(
            and(
              eq(requests.id, candidate.id),
              eq(requests.userId, owner.id),
              eq(column, hash),
            ),
          )
          .for("update");
        const now = this.now();
        if (
          !row ||
          row.status !==
            (final ? "pending_new_email" : "pending_current_email") ||
          emailChangeExpired(row.expiresAt, now) ||
          owner.email !== row.currentEmail
        )
          throw invalidEmailChange();
        if (!final) {
          const next = newEmailChangeToken();
          await tx
            .update(requests)
            .set({
              status: "pending_new_email",
              currentEmailTokenHash: null,
              newEmailTokenHash: next.hash,
              currentEmailApprovedAt: now,
              updatedAt: now,
            })
            .where(eq(requests.id, row.id));
          // Failure/timeout rolls back consumption; the original approval can retry.
          await this.mail.deliverEmailChangeVerification({
            recipient: row.newEmail,
            token: next.token,
            url: this.link("verify-new", next.token),
          });
          return null;
        }
        if (
          (
            await tx
              .select({ id: user.id })
              .from(user)
              .where(eq(user.email, row.newEmail))
          ).length
        )
          throw invalidEmailChange();
        await tx
          .update(user)
          .set({ email: row.newEmail, emailVerified: true, updatedAt: now })
          .where(
            and(eq(user.id, row.userId), eq(user.email, row.currentEmail)),
          );
        const [initiator] = await tx
          .select()
          .from(session)
          .where(
            and(
              eq(session.id, row.initiatingSessionId),
              eq(session.userId, row.userId),
            ),
          );
        const retain =
          initiator &&
          !new AuthSessionPolicy(() => now.getTime()).isExpired(initiator);
        await tx
          .delete(session)
          .where(
            retain
              ? and(
                  eq(session.userId, row.userId),
                  ne(session.id, row.initiatingSessionId),
                )
              : eq(session.userId, row.userId),
          );
        await tx
          .update(requests)
          .set({
            status: "completed",
            newEmailTokenHash: null,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(requests.id, row.id));
        return {
          recipient: row.currentEmail,
          newEmail: row.newEmail,
          userId: row.userId,
          requestId: row.id,
        };
      });
      if (completed) {
        this.logger.log({
          event: "email_changed",
          userId: completed.userId,
          requestId: completed.requestId,
        });
        this.mail.dispatchEmailChangeCompleted({
          recipient: completed.recipient,
          newEmail: completed.newEmail,
        });
      }
    });
  }
}
