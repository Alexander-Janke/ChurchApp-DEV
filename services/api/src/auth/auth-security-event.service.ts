import { authSecurityEvent } from "../database/schema/auth-security-event.js";
import type { DatabaseTransaction } from "../database/database.types.js";
import type { DatabaseService } from "../database/database.service.js";
import {
  validateAuthSecurityEvent,
  type AuthSecurityEventInput,
} from "./auth-security-event-policy.js";

// Internal capability: requires the caller's transaction, never opens a second
// transaction for a successful mutation. Errors propagate and abort that mutation.
export class AuthSecurityEventService {
  async record(
    tx: DatabaseTransaction,
    input: AuthSecurityEventInput,
  ): Promise<void> {
    const event = validateAuthSecurityEvent(input);
    await tx.insert(authSecurityEvent).values({
      eventType: event.eventType,
      actorUserId: event.actorUserId,
      subjectUserId: event.subjectUserId,
      sessionId: event.sessionId,
      outcome:
        event.eventType === "authentication_failure" ? "failure" : "success",
      metadata: event.metadata,
    });
  }
  // Invoke ONLY after authentication failure has been conclusively determined
  // and its transaction has finished. Classification/automatic emission requires
  // a separately reviewed threshold; this method cannot authenticate or issue proof.
  async recordFailure(
    database: Pick<DatabaseService, "transaction">,
    input: Extract<
      AuthSecurityEventInput,
      { eventType: "authentication_failure" }
    >,
  ): Promise<void> {
    const event = validateAuthSecurityEvent(input);
    if (event.eventType !== "authentication_failure")
      throw new Error("Invalid authentication failure event");
    await database.transaction((tx) => this.record(tx, event));
  }
}
