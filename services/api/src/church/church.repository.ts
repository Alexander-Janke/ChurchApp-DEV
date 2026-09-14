import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { church } from "../database/schema/church.js";
import type { DatabaseTransaction } from "../database/database.types.js";
import { TenantContext } from "../database/tenant-context.js";
import { parseChurchDetails } from "./church-policy.js";

// Internal data access only. Every call requires both explicit scope and the
// caller's transaction handle. No pool fallback and no unrestricted listing API.
@Injectable()
export class ChurchRepository {
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
