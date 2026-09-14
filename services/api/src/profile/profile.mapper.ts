import type { SelfProfile } from "@church-platform/contracts";
import type { user } from "../database/schema/auth.js";
import type { userProfile } from "../database/schema/user-profile.js";
type Identity = Pick<
  typeof user.$inferSelect,
  "id" | "email" | "emailVerified" | "image" | "createdAt"
>;
export function mapSelfProfile(
  identity: Identity,
  p: typeof userProfile.$inferSelect | null,
): SelfProfile {
  const address = {
    line1: p?.addressLine1 ?? null,
    line2: p?.addressLine2 ?? null,
    postalCode: p?.postalCode ?? null,
    locality: p?.locality ?? null,
    region: p?.region ?? null,
    countryCode: p?.countryCode ?? null,
  };
  return {
    id: identity.id,
    email: identity.email,
    emailVerified: identity.emailVerified,
    image: identity.image,
    username: p?.username ?? null,
    firstName: p?.firstName ?? null,
    lastName: p?.lastName ?? null,
    dateOfBirth: p?.dateOfBirth ?? null,
    phoneNumber: p?.phoneNumber ?? null,
    address: Object.values(address).every((v) => v === null) ? null : address,
    biography: p?.biography ?? null,
    identityCreatedAt: identity.createdAt.toISOString(),
    profileCreatedAt: p?.createdAt.toISOString() ?? null,
    profileUpdatedAt: p?.updatedAt.toISOString() ?? null,
  };
}
