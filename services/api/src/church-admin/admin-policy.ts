import { BadRequestException } from "@nestjs/common";
import {
  parseChurchDetails,
  type ChurchDetails,
} from "../church/church-policy.js";
import { parseRelationshipPage } from "../membership/membership-policy.js";

export const SETTINGS_FIELDS = [
  "name",
  "slug",
  "addressLine1",
  "addressLine2",
  "postalCode",
  "locality",
  "region",
  "countryCode",
  "denomination",
  "logo",
] as const;
export type SettingsPatch = Partial<ChurchDetails>;
export function parseSettingsPatch(value: unknown): SettingsPatch {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException("Invalid church settings");
  const data = value as Record<string, unknown>,
    keys = Object.keys(data);
  if (!keys.length || keys.some((k) => !SETTINGS_FIELDS.some((f) => f === k)))
    throw new BadRequestException("Invalid church settings");
  try {
    // Validate provided fields with the canonical full-value policy, then retain
    // ONLY submitted keys. Placeholder required fields never reach persistence.
    if (keys.some((k) => data[k] === undefined)) throw new Error();
    const parsed = parseChurchDetails({
      name: "Validation",
      slug: "validation",
      ...data,
    });
    return Object.fromEntries(
      keys.map((k) => [k, parsed[k as keyof ChurchDetails]]),
    );
  } catch {
    throw new BadRequestException("Invalid church settings");
  }
}
export function parseMemberPage(query: Record<string, unknown>) {
  try {
    if (Object.keys(query).some((k) => k !== "limit" && k !== "after"))
      throw new Error();
    if (
      query.limit !== undefined &&
      (typeof query.limit !== "string" ||
        !/^[1-9][0-9]{0,2}$/.test(query.limit))
    )
      throw new Error();
    if (query.after !== undefined && typeof query.after !== "string")
      throw new Error();
    return parseRelationshipPage(
      query.limit === undefined ? 50 : Number(query.limit),
      query.after as string | undefined,
    );
  } catch {
    throw new BadRequestException("Invalid member page");
  }
}
export function mapSettings(
  row: ChurchDetails & {
    id: string;
    status: string;
    verificationState: string;
  },
) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    postalCode: row.postalCode,
    locality: row.locality,
    region: row.region,
    countryCode: row.countryCode,
    denomination: row.denomination,
    logo: row.logo,
    status: row.status,
    verificationState: row.verificationState,
  };
}
export function mapMember(row: { id: string; userId: string; status: string }) {
  return { id: row.id, userId: row.userId, status: row.status };
}
export function isSlugConflict(error: unknown): boolean {
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
