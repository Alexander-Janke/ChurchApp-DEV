export const relationshipStatuses = [
  "follower",
  "member",
  "inactive",
  "left",
] as const;
export type RelationshipStatus = (typeof relationshipStatuses)[number];
export function parseRelationshipStatus(value: unknown): RelationshipStatus {
  if (
    typeof value !== "string" ||
    !relationshipStatuses.some((status) => status === value)
  )
    throw new Error("Invalid relationship status");
  return value as RelationshipStatus;
}
export function parseRelationshipId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() !== value
  )
    throw new Error("Invalid relationship selector");
  return value;
}
export function parseRelationshipCreation(input: unknown) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== "userId" && key !== "status")
  )
    throw new Error("Invalid relationship input");
  const data = input as Record<string, unknown>;
  return {
    userId: parseRelationshipId(data.userId),
    status: parseRelationshipStatus(data.status),
  };
}
// Structural validation only; detailed workflows and their authorization are deferred.
// All states can be persisted, including reinstatement. Expected-state matching
// prevents stale callers from overwriting a concurrent transition.
export function parseRelationshipTransition(expected: unknown, next: unknown) {
  return {
    expected: parseRelationshipStatus(expected),
    next: parseRelationshipStatus(next),
  };
}
export function parseRelationshipPage(limit: number, after?: string) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid relationship page");
  return {
    limit,
    after: after === undefined ? undefined : parseRelationshipId(after),
  };
}
