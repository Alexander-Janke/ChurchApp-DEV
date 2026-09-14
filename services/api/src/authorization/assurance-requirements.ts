import type { AssuranceResult } from "../auth/assurance-policy.js";

export interface AssuranceRequirements {
  readonly requiresPrivilegedAssurance: boolean;
  readonly requiresRecentStepUp: boolean;
}
// Unknown/incomplete metadata is denied, never interpreted as ordinary access.
// Requirements belong to immutable permission metadata, never role assignments.
export function permissionAndAssurance(
  permissionAllowed: boolean,
  requirements: AssuranceRequirements | undefined,
  assurance: AssuranceResult,
): boolean {
  if (
    !permissionAllowed ||
    !assurance.authenticated ||
    !requirements ||
    typeof requirements.requiresPrivilegedAssurance !== "boolean" ||
    typeof requirements.requiresRecentStepUp !== "boolean"
  )
    return false;
  return (
    (!requirements.requiresPrivilegedAssurance || assurance.elevated) &&
    (!requirements.requiresRecentStepUp ||
      (assurance.elevated && assurance.recentStepUp))
  );
}
