// Closed identity-level audit vocabulary; no role, tenant or provider payloads.
export const AUTH_SECURITY_EVENTS = [
  "password_changed",
  "password_reset",
  "email_changed",
  "two_factor_enabled",
  "two_factor_disabled",
  "recovery_codes_regenerated",
  "recovery_code_used",
  "session_revoked",
  "authentication_failure",
] as const;
export type AuthSecurityEventType = (typeof AUTH_SECURITY_EVENTS)[number];
type Identity = {
  actorUserId: string | null;
  subjectUserId: string | null;
  sessionId: string | null;
};
export type AuthSecurityEventInput = Identity &
  (
    | {
        eventType: Exclude<
          AuthSecurityEventType,
          "recovery_code_used" | "authentication_failure"
        >;
        metadata: Record<string, never>;
      }
    | {
        eventType: "recovery_code_used";
        metadata: { purpose: "authentication" | "elevation" | "step_up" };
      }
    | {
        eventType: "authentication_failure";
        metadata: {
          method: "password" | "totp" | "recovery";
          category: "repeated" | "suspicious";
        };
      }
  );
const fail = (): never => {
  throw new Error("Invalid authentication security event");
};
function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    return fail();
  return value;
}
export function validateAuthSecurityEvent(
  value: unknown,
): AuthSecurityEventInput {
  const input = object(value);
  const fields = [
    "eventType",
    "actorUserId",
    "subjectUserId",
    "sessionId",
    "metadata",
  ];
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    return fail();
  if (!AUTH_SECURITY_EVENTS.includes(input.eventType as AuthSecurityEventType))
    return fail();
  const actorUserId = identifier(input.actorUserId);
  const subjectUserId = identifier(input.subjectUserId);
  const sessionId = identifier(input.sessionId);
  const metadata = object(input.metadata);
  const keys = Object.keys(metadata);
  if (input.eventType === "authentication_failure") {
    if (
      keys.length !== 2 ||
      keys.some((key) => !["method", "category"].includes(key)) ||
      typeof metadata.method !== "string" ||
      !["password", "totp", "recovery"].includes(metadata.method) ||
      typeof metadata.category !== "string" ||
      !["repeated", "suspicious"].includes(metadata.category)
    )
      return fail();
  } else {
    if (!subjectUserId || !actorUserId || actorUserId !== subjectUserId)
      return fail();
    if (
      !sessionId &&
      !["password_reset", "recovery_code_used"].includes(
        input.eventType as string,
      )
    )
      return fail();
    if (input.eventType === "recovery_code_used") {
      if (
        keys.length !== 1 ||
        keys[0] !== "purpose" ||
        typeof metadata.purpose !== "string" ||
        !["authentication", "elevation", "step_up"].includes(metadata.purpose)
      )
        return fail();
      if (metadata.purpose !== "authentication" && !sessionId) return fail();
    } else if (keys.length) return fail();
  }
  // Copy only validated fields. No caller-controlled timestamps, outcome or IDs.
  return {
    eventType: input.eventType,
    actorUserId,
    subjectUserId,
    sessionId,
    metadata: { ...metadata },
  } as AuthSecurityEventInput;
}
