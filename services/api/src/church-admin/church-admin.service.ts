import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { user } from "../database/schema/auth.js";
import { church } from "../database/schema/church.js";
import { TenantContext } from "../database/tenant-context.js";
import { TenantDatabase } from "../database/tenant-database.js";
import type { DatabaseTransaction } from "../database/database.types.js";
import { SessionAuthorizationService } from "../authorization/session-authorization.service.js";
import {
  SessionAssuranceService,
  type SessionSubject,
} from "../auth/session-assurance.service.js";
import { ChurchRepository } from "../church/church.repository.js";
import { MembershipRepository } from "../membership/membership.repository.js";
import { AdminAuditRepository } from "./admin-audit.repository.js";
import {
  parseSettingsPatch,
  parseMemberPage,
  mapSettings,
  mapMember,
  SETTINGS_FIELDS,
  isSlugConflict,
} from "./admin-policy.js";

@Injectable()
export class ChurchAdminService {
  constructor(
    private readonly tenants: TenantDatabase,
    private readonly authorization: SessionAuthorizationService,
    private readonly assurance: SessionAssuranceService,
    private readonly churches: ChurchRepository,
    private readonly memberships: MembershipRepository,
    private readonly audit: AdminAuditRepository,
  ) {}
  private async authorized<T>(
    churchId: string,
    subject: SessionSubject,
    permission: "church.settings.manage" | "members.manage",
    write: boolean,
    work: (context: TenantContext, tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    let context: TenantContext;
    try {
      context = TenantContext.fromAuthorizedScope(churchId);
    } catch {
      throw new BadRequestException("Invalid church selector");
    }
    // The server-created candidate scope only constrains the authorization query.
    // No resource is returned/mutated until the scoped permission check succeeds.
    try {
      return await this.tenants.transaction(context, async (tx) => {
        await tx.execute(sql`set local lock_timeout = '5s'`);
        // Deny unknown/foreign scopes before resource locks: lock contention must
        // not reveal existence of a church for which this actor lacks entitlement.
        if (
          !(await this.authorization.isAuthorizedInTransaction(
            context,
            subject,
            permission,
            tx,
          ))
        ) {
          if (!(await this.assurance.evaluate(subject, tx)).authenticated)
            throw new UnauthorizedException();
          throw new ForbiddenException("Administration denied");
        }
        // Match ownership/auth lock ordering; privilege cannot disappear between
        // authorization and commit. Church serialization also prevents lost PATCH fields.
        await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, subject.userId))
          .for("share");
        const query = tx
          .select({ id: church.id })
          .from(church)
          .where(eq(church.id, context.churchId));
        await (write ? query.for("update") : query.for("share"));
        if (
          !(await this.authorization.isAuthorizedInTransaction(
            context,
            subject,
            permission,
            tx,
            true,
          ))
        ) {
          if (!(await this.assurance.evaluate(subject, tx)).authenticated)
            throw new UnauthorizedException();
          throw new ForbiddenException("Administration denied");
        }
        return work(context, tx);
      });
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof UnauthorizedException
      )
        throw error;
      if (isSlugConflict(error))
        throw new ConflictException("Church slug is unavailable");
      throw new ServiceUnavailableException(
        "Church administration unavailable",
      );
    }
  }
  updateSettings(churchId: string, subject: SessionSubject, input: unknown) {
    const patch = parseSettingsPatch(input);
    return this.authorized(
      churchId,
      subject,
      "church.settings.manage",
      true,
      async (context, tx) => {
        const current = await this.churches.getCurrentChurch(context, tx);
        if (!current) throw new Error("Scoped church unavailable");
        const changed = SETTINGS_FIELDS.filter(
          (k) => Object.hasOwn(patch, k) && patch[k] !== current[k],
        );
        if (!changed.length) return mapSettings(current);
        const details = {
          name: current.name,
          slug: current.slug,
          addressLine1: current.addressLine1,
          addressLine2: current.addressLine2,
          postalCode: current.postalCode,
          locality: current.locality,
          region: current.region,
          countryCode: current.countryCode,
          denomination: current.denomination,
          logo: current.logo,
          ...patch,
        };
        const updated = await this.churches.updateCurrentChurch(
          context,
          tx,
          details,
        );
        if (!updated) throw new Error("Settings update failed");
        await this.audit.appendSettingsUpdated(context, tx, subject, changed);
        // No second connection: update + audit + activity all commit or all roll back.
        if (
          !(await this.assurance.recordSuccessfulPrivilegedActivityInTransaction(
            subject,
            tx,
          ))
        )
          throw new ForbiddenException("Administration denied");
        return mapSettings(updated);
      },
    );
  }
  listMembers(
    churchId: string,
    subject: SessionSubject,
    query: Record<string, unknown>,
  ) {
    const page = parseMemberPage(query);
    return this.authorized(
      churchId,
      subject,
      "members.manage",
      false,
      async (context, tx) => {
        const rows = await this.memberships.listRelationships(
          context,
          tx,
          page.limit,
          page.after,
        );
        return {
          items: rows.map(mapMember),
          nextCursor: rows.length === page.limit ? rows.at(-1)!.id : null,
        };
      },
    );
  }
}
