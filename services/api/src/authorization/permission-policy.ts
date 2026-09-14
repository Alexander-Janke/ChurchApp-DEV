// Stable application-owned keys from PERMISSIONS.md; not a product-wide catalog.
export const PERMISSIONS = Object.freeze({
  "members.view": Object.freeze({
    inactiveEligible: true,
    requiresPrivilegedAssurance: false,
  }),
  "events.create": Object.freeze({ requiresPrivilegedAssurance: false }),
});
export type PermissionKey = keyof typeof PERMISSIONS;
export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && Object.hasOwn(PERMISSIONS, value);
}
export function parsePermission(value: unknown): PermissionKey {
  if (!isPermissionKey(value)) throw new Error("Invalid permission");
  return value;
}
export function isPermissionEligibleForInactiveMembership(
  value: unknown,
): boolean {
  if (!isPermissionKey(value)) return false;
  const policy: {
    inactiveEligible?: boolean;
    requiresPrivilegedAssurance: boolean;
  } = PERMISSIONS[value];
  return policy.inactiveEligible === true;
}
// This answers assignment eligibility only, not object/privacy/assurance entitlement.
// No privileged permission may become usable before secure TOTP and assurance exist.
export function membershipAllowsPermission(
  status: unknown,
  permission: unknown,
): boolean {
  if (!isPermissionKey(permission)) return false;
  const policy: { requiresPrivilegedAssurance: boolean } =
    PERMISSIONS[permission];
  if (policy.requiresPrivilegedAssurance) return false;
  return (
    status === "member" ||
    (status === "inactive" &&
      isPermissionEligibleForInactiveMembership(permission))
  );
}
