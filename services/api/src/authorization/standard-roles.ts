import { TenantContext } from "../database/tenant-context.js";
import type { PermissionKey } from "./permission-policy.js";

function defineRole<K extends string>(
  key: K,
  name: string,
  description: string,
  permissions: readonly PermissionKey[] = [],
  privileged = false,
) {
  return Object.freeze({
    key,
    name,
    description,
    isSystem: true as const,
    privileged,
    // Empty for the four assigned-object roles; the approved admin bundle is explicit.
    permissions: Object.freeze([...permissions]),
  });
}
export const STANDARD_ROLES = Object.freeze([
  defineRole(
    "group_leader",
    "Group Leader",
    "Assigned-group leadership; group-scoped capabilities remain deferred.",
  ),
  defineRole(
    "area_leader",
    "Area Leader",
    "Assigned-area coordination; area-scoped capabilities remain deferred.",
  ),
  defineRole(
    "event_administrator",
    "Event Administrator",
    "Assigned-event coordination; event-scoped capabilities remain deferred.",
  ),
  defineRole(
    "childrens_worker",
    "Children’s Worker",
    "Children’s ministry identity; operational context and safeguarding capabilities remain deferred.",
  ),
  defineRole(
    "main_church_administrator",
    "Main Church Administrator",
    "Ordinary member and church settings administration; current verified 2FA and session elevation required.",
    ["members.manage", "church.settings.manage"],
    true,
  ),
]);
export type StandardRoleKey = (typeof STANDARD_ROLES)[number]["key"];

export function standardRoleId(
  context: TenantContext,
  key: StandardRoleKey,
): string {
  TenantContext.assert(context);
  if (!STANDARD_ROLES.some((role) => role.key === key))
    throw new Error("Invalid standard role key");
  // Persist identity in the existing text PK. UUID tenant syntax and fixed keys
  // make this encoding unambiguous. Labels never determine identity/entitlement.
  // Keep this namespace stable across releases, including future label changes.
  return `system-role:${context.churchId}:${key}`;
}
export class StandardRoleConflictError extends Error {
  readonly code = "STANDARD_ROLE_CONFLICT";
  constructor() {
    super("Standard role provisioning conflicts with an existing role");
  }
}
