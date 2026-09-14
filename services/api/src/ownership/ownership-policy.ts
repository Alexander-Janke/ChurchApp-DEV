import type { AssuranceResult } from "../auth/assurance-policy.js";
import type { SessionSubject } from "../auth/session-assurance.service.js";

export type OwnershipResult =
  "changed" | "unchanged" | "conflict" | "denied" | "not_found";
export function eligibleOwner(
  status: unknown,
  enabled: unknown,
  verified: unknown,
) {
  return status === "member" && enabled === true && verified === true;
}
export function mayTransfer(isOwner: boolean, assurance: AssuranceResult) {
  return (
    isOwner &&
    assurance.authenticated &&
    assurance.elevated &&
    assurance.recentStepUp
  );
}
// This is an internal server-resolved subject, not a public request DTO.
// The future caller MUST obtain it through AuthSessionReader, never body/query IDs.
export function assertOwnershipSubject(subject: SessionSubject) {
  if (
    !subject ||
    typeof subject !== "object" ||
    Array.isArray(subject) ||
    Object.keys(subject).some((k) => k !== "userId" && k !== "sessionId") ||
    ![subject.userId, subject.sessionId].every(
      (v) =>
        typeof v === "string" &&
        v.length > 0 &&
        v.length <= 128 &&
        v.trim() === v,
    )
  )
    throw new Error("Server-resolved ownership actor required");
}
