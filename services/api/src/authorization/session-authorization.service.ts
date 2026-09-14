import { and, eq } from "drizzle-orm";
import { user, twoFactor } from "../database/schema/auth.js";
import { churchMembership } from "../database/schema/church-membership.js";
import {
  SessionAssuranceService,
  type SessionSubject,
} from "../auth/session-assurance.service.js";
import { SECURE_ELEVATION_COMPLETION_ENABLED } from "../auth/assurance-policy.js";
import { PERMISSIONS, isPermissionKey } from "./permission-policy.js";
import { permissionAndAssurance } from "./assurance-requirements.js";
import { Injectable } from "@nestjs/common";
import { TenantContext } from "../database/tenant-context.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { AuthorizationRepository } from "./authorization.repository.js";

// Internal combined evaluator; no external administrative routes.
@Injectable()
export class SessionAuthorizationService {
  constructor(
    private readonly tenants: TenantDatabase,
    private readonly repository: AuthorizationRepository,
    private readonly assurance: SessionAssuranceService,
  ) {}
  // Server-resolved subject only. One tenant transaction rechecks membership,
  // assignments and session authority. Future mutations must use this same pattern
  // inside their operation transaction and add object/privacy checks as applicable.
  async isAuthorized(
    context: TenantContext,
    subject: SessionSubject,
    permission: unknown,
  ): Promise<boolean> {
    TenantContext.assert(context);
    if (!isPermissionKey(permission)) return false;
    const requirements = PERMISSIONS[permission];
    if (
      (requirements.requiresPrivilegedAssurance ||
        requirements.requiresRecentStepUp) &&
      !SECURE_ELEVATION_COMPLETION_ENABLED
    )
      return false;
    try {
      return await this.tenants.transaction(context, async (tx) => {
        const [membership] = await tx
          .select({ id: churchMembership.id })
          .from(churchMembership)
          .where(
            and(
              eq(churchMembership.churchId, context.churchId),
              eq(churchMembership.userId, subject.userId),
            ),
          )
          .limit(1);
        if (
          !membership ||
          !(await this.repository.hasEligibleRolePermission(
            context,
            tx,
            membership.id,
            permission,
          ))
        )
          return false;
        if (
          !permissionAndAssurance(
            true,
            requirements,
            await this.assurance.evaluate(subject, tx),
          )
        )
          return false;
        if (
          requirements.requiresPrivilegedAssurance ||
          requirements.requiresRecentStepUp
        ) {
          // Current database state, never a client/session flag or role label.
          // Exactly one verified factor, consistent with the ownership boundary.
          const factors = await tx
            .select({
              enabled: user.twoFactorEnabled,
              verified: twoFactor.verified,
            })
            .from(user)
            .leftJoin(twoFactor, eq(twoFactor.userId, user.id))
            .where(eq(user.id, subject.userId))
            .limit(2);
          return (
            factors.length === 1 &&
            factors[0]?.enabled === true &&
            factors[0]?.verified === true
          );
        }
        return true;
      });
    } catch {
      throw new Error("Authorization evaluation failed");
    }
  }
}
