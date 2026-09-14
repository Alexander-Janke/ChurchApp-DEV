import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { church } from "../database/schema/church.js";
import type { DatabaseTransaction } from "../database/database.types.js";
import { TenantContext } from "../database/tenant-context.js";
import { parseChurchDetails } from "./church-policy.js";
import {
  evaluateChurchVerificationTransition,
  type VerificationRequestResult,
} from "./church-verification-policy.js";

// Internal data access only. Every call requires both explicit scope and the
// caller's transaction handle. No pool fallback and no unrestricted listing API.
@Injectable()
export class ChurchRepository {
  // Only trusted bootstrap code supplies the new server-generated tenant scope.
  // Plain INSERT (never upsert) cannot overwrite an existing tenant on collision.
  async createChurch(
    context: TenantContext,
    tx: DatabaseTransaction,
    input: unknown,
  ) {
    TenantContext.assert(context);
    const details = parseChurchDetails(input);
    const [row] = await tx
      .insert(church)
      .values({
        id: context.churchId,
        name: details.name,
        slug: details.slug,
        addressLine1: details.addressLine1,
        addressLine2: details.addressLine2,
        postalCode: details.postalCode,
        locality: details.locality,
        region: details.region,
        countryCode: details.countryCode,
        denomination: details.denomination,
        logo: details.logo,
        status: "active",
        verificationState: "unverified",
      })
      .returning();
    if (!row) throw new Error("Church creation failed");
    return row;
  }
  // No caller-selected target state or church ID. The policy and lock are inside
  // the repository boundary so direct internal use cannot skip request semantics.
  async requestVerification(
    context: TenantContext,
    tx: DatabaseTransaction,
  ): Promise<VerificationRequestResult> {
    TenantContext.assert(context);
    const [current] = await tx
      .select({ state: church.verificationState })
      .from(church)
      .where(eq(church.id, context.churchId))
      .for("update");
    if (!current) return { outcome: "not_found" };
    const decision = evaluateChurchVerificationTransition(
      current.state,
      "pending",
    );
    if (decision.outcome === "unchanged")
      return { outcome: "unchanged", state: "pending" };
    if (decision.outcome !== "transition" || decision.authority !== "request")
      return { outcome: "invalid_transition", state: current.state };
    const rows = await tx
      .update(church)
      .set({ verificationState: "pending", updatedAt: new Date() })
      .where(
        and(
          eq(church.id, context.churchId),
          eq(church.verificationState, decision.from),
        ),
      )
      .returning({ id: church.id });
    return rows.length === 1
      ? { outcome: "changed", state: "pending" }
      : { outcome: "stale" };
  }

  async getCurrentChurch(context: TenantContext, tx: DatabaseTransaction) {
    TenantContext.assert(context);
    const [row] = await tx
      .select()
      .from(church)
      .where(eq(church.id, context.churchId));
    return row ?? null;
  }
  async updateCurrentChurch(
    context: TenantContext,
    tx: DatabaseTransaction,
    input: unknown,
  ) {
    TenantContext.assert(context);
    const details = parseChurchDetails(input);
    const [row] = await tx
      .update(church)
      .set({
        name: details.name,
        slug: details.slug,
        addressLine1: details.addressLine1,
        addressLine2: details.addressLine2,
        postalCode: details.postalCode,
        locality: details.locality,
        region: details.region,
        countryCode: details.countryCode,
        denomination: details.denomination,
        logo: details.logo,
        updatedAt: new Date(),
      })
      .where(eq(church.id, context.churchId))
      .returning();
    return row ?? null;
  }
}
