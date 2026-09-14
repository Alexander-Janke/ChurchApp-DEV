export const churchStatuses = ["active", "inactive"] as const;
export const churchVerificationStates = [
  "unverified",
  "pending",
  "verified",
  "rejected",
  "revoked",
] as const;
export interface ChurchDetails {
  name: string;
  slug: string;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  locality: string | null;
  region: string | null;
  countryCode: string | null;
  denomination: string | null;
  logo: string | null;
}
function invalid(): never {
  throw new Error("Invalid church details");
}
function text(value: unknown, max: number, nullable = true): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || value.includes("\u0000")) invalid();
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > max) invalid();
  return normalized;
}
// Internal full-value update. Lifecycle/verification transitions are not exposed.
export function parseChurchDetails(value: unknown): ChurchDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  const keys = [
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
  ];
  if (Object.keys(input).some((k) => !keys.includes(k))) invalid();
  const slug = input.slug;
  if (
    typeof slug !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]$/.test(slug)
  )
    invalid();
  const country = input.countryCode ?? null;
  if (
    country !== null &&
    (typeof country !== "string" || !/^[A-Z]{2}$/.test(country))
  )
    invalid();
  const logo = input.logo ?? null;
  if (logo !== null) {
    if (
      typeof logo !== "string" ||
      logo !== logo.trim() ||
      logo.length > 2048 ||
      !logo.startsWith("https://")
    )
      invalid();
    let url: URL;
    try {
      url = new URL(logo);
    } catch {
      invalid();
    }
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    )
      invalid();
  }
  return {
    name: text(input.name, 200, false)!,
    slug: slug.toLowerCase(),
    addressLine1: text(input.addressLine1 ?? null, 200),
    addressLine2: text(input.addressLine2 ?? null, 200),
    postalCode: text(input.postalCode ?? null, 32),
    locality: text(input.locality ?? null, 120),
    region: text(input.region ?? null, 120),
    countryCode: country,
    denomination: text(input.denomination ?? null, 120),
    logo,
  };
}
