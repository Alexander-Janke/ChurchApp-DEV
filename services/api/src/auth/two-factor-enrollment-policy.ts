import { createHash, randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";

export const ENROLLMENT_LIFETIME_MS = 60 * 60 * 1000;
export const newEnrollmentId = () => randomUUID();
export const factorFingerprint = (encryptedSecret: string) =>
  createHash("sha256").update(encryptedSecret).digest("hex");

export function staleEnrollment(): APIError {
  return new APIError("CONFLICT", {
    code: "ENROLLMENT_NOT_CURRENT",
    message: "Enrollment is no longer current",
  });
}
export function isCurrentEnrollment(
  row:
    | { id: string; userId: string; factorFingerprint: string; expiresAt: Date }
    | undefined,
  userId: string,
  id: string,
  fingerprint: string,
  now: number,
): boolean {
  return (
    !!row &&
    row.userId === userId &&
    row.id === id &&
    row.factorFingerprint === fingerprint &&
    Number.isFinite(now) &&
    row.expiresAt.getTime() > now
  );
}
export function enrollmentInput(body: unknown, confirm: boolean) {
  const allowed = confirm ? ["enrollmentId", "code"] : ["password"];
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== allowed.length ||
    Object.keys(body).some((key) => !allowed.includes(key))
  )
    throw new APIError("BAD_REQUEST", {
      message: "Invalid enrollment request",
    });
  const input = body as Record<string, unknown>;
  if (confirm) {
    if (
      typeof input.enrollmentId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        input.enrollmentId,
      ) ||
      typeof input.code !== "string" ||
      !/^[0-9]{6}$/.test(input.code)
    )
      throw new APIError("BAD_REQUEST", {
        message: "Invalid enrollment request",
      });
    return { enrollmentId: input.enrollmentId, code: input.code };
  }
  if (typeof input.password !== "string" || !input.password)
    throw new APIError("BAD_REQUEST", {
      message: "Invalid enrollment request",
    });
  return { password: input.password };
}
