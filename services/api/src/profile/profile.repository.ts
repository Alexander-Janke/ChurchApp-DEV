import { Injectable, UnauthorizedException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { UpdateSelfProfileRequest } from "@church-platform/contracts";
import { DatabaseService } from "../database/database.service.js";
import { user } from "../database/schema/auth.js";
import { userProfile } from "../database/schema/user-profile.js";
import type {
  Database,
  DatabaseTransaction,
} from "../database/database.types.js";
import { mapSelfProfile } from "./profile.mapper.js";

@Injectable()
export class ProfileRepository {
  constructor(private readonly database: DatabaseService) {}
  async read(
    userId: string,
    db: Database | DatabaseTransaction = this.database.db,
  ) {
    const [row] = await db
      .select({
        identity: {
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
          image: user.image,
          createdAt: user.createdAt,
        },
        profile: userProfile,
      })
      .from(user)
      .leftJoin(userProfile, eq(userProfile.userId, user.id))
      .where(eq(user.id, userId));
    if (!row) throw new UnauthorizedException();
    return mapSelfProfile(row.identity, row.profile);
  }
  async update(userId: string, patch: UpdateSelfProfileRequest) {
    // Image and product fields can change together: one transaction prevents partial writes.
    return this.database.transaction(async (tx) => {
      const update: Partial<typeof userProfile.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (patch.username !== undefined) update.username = patch.username;
      if (patch.firstName !== undefined) update.firstName = patch.firstName;
      if (patch.lastName !== undefined) update.lastName = patch.lastName;
      if (patch.dateOfBirth !== undefined)
        update.dateOfBirth = patch.dateOfBirth;
      if (patch.phoneNumber !== undefined)
        update.phoneNumber = patch.phoneNumber;
      if (patch.biography !== undefined) update.biography = patch.biography;
      if (patch.address !== undefined) {
        update.addressLine1 = patch.address?.line1 ?? null;
        update.addressLine2 = patch.address?.line2 ?? null;
        update.postalCode = patch.address?.postalCode ?? null;
        update.locality = patch.address?.locality ?? null;
        update.region = patch.address?.region ?? null;
        update.countryCode = patch.address?.countryCode ?? null;
      }
      // Lock identity first; serializes same-user patches and coordinates email-change writes.
      const [identity] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .for("update");
      if (!identity) throw new UnauthorizedException();
      update.updatedAt = new Date();
      // Only explicitly mapped fields above are accepted by persistence.
      await tx
        .insert(userProfile)
        .values({ userId, ...update })
        .onConflictDoUpdate({ target: userProfile.userId, set: update });
      if (patch.image !== undefined)
        await tx
          .update(user)
          .set({ image: patch.image })
          .where(eq(user.id, userId));
      return this.read(userId, tx);
    });
  }
}
