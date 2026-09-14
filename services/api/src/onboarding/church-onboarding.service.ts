import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { TenantContext } from "../database/tenant-context.js";
import { ChurchRepository } from "../church/church.repository.js";
import { parseChurchDetails } from "../church/church-policy.js";
import { MembershipRepository } from "../membership/membership.repository.js";
import { OwnershipService } from "../ownership/ownership.service.js";
import { assertOwnershipSubject } from "../ownership/ownership-policy.js";
import type { SessionSubject } from "../auth/session-assurance.service.js";
import { StandardRoleService } from "../authorization/standard-role.service.js";

export class OnboardingDeniedError extends Error {
  constructor() {
    super("Eligible authenticated creator required");
  }
}
export class ChurchSlugConflictError extends Error {
  constructor() {
    super("Church slug is unavailable");
  }
}
function slugConflict(error: unknown): boolean {
  for (
    let depth = 0;
    depth < 4 && error && typeof error === "object";
    depth++
  ) {
    if (
      "code" in error &&
      error.code === "23505" &&
      "constraint" in error &&
      error.constraint === "church_slug_idx"
    )
      return true;
    error = "cause" in error ? error.cause : undefined;
  }
  return false;
}
// Internal-only capability. Subject MUST originate from AuthSessionReader, never
// a public identity DTO. PostgreSQL revalidates session + factor within the transaction.
// No caller-selected tenant, arbitrary target owner, controller or startup caller.
@Injectable()
export class ChurchOnboardingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenants: TenantDatabase,
    private readonly churches: ChurchRepository,
    private readonly memberships: MembershipRepository,
    private readonly ownership: OwnershipService,
    private readonly roles: StandardRoleService,
  ) {}
  async createChurch(subject: SessionSubject, input: unknown) {
    assertOwnershipSubject(subject);
    const details = parseChurchDetails(input);
    try {
      return await this.database.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '5s'`);
        if (
          !(await this.ownership.eligibleInitialCreatorInTransaction(
            tx,
            subject,
          ))
        )
          throw new OnboardingDeniedError();
        // ID allocation precedes insertion: existing church RLS requires its exact
        // scope even for INSERT. No existing-tenant selector or bypass is offered.
        const context = TenantContext.fromAuthorizedScope(randomUUID());
        return this.tenants.inTransaction(context, tx, async (bound) => {
          const church = await this.churches.createChurch(
            context,
            bound,
            details,
          );
          const membership = await this.memberships.createRelationship(
            context,
            bound,
            { userId: subject.userId, status: "member" },
          );
          if (membership.outcome !== "created")
            throw new Error("Creator membership failed");
          const result =
            await this.ownership.establishInitialOwnerInTransaction(
              context,
              subject,
              membership.relationship.id,
              bound,
            );
          if (result !== "changed") throw new Error("Initial ownership failed");
          await this.roles.ensureStandardRolesInTransaction(context, bound);
          // Explicit internal result; no raw auth, audit, or profile records.
          return {
            church: {
              id: church.id,
              name: church.name,
              slug: church.slug,
              status: church.status,
              verificationState: church.verificationState,
            },
            membership: {
              id: membership.relationship.id,
              status: membership.relationship.status,
            },
            ownership: { isPrimaryOwner: true as const },
          };
        });
      });
    } catch (error) {
      if (error instanceof OnboardingDeniedError) throw error;
      if (slugConflict(error)) throw new ChurchSlugConflictError();
      throw new Error("Church onboarding failed");
    }
  }
}
