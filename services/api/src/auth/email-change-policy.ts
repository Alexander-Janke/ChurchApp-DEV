import { createHash, randomBytes } from "node:crypto";
import { APIError } from "better-auth/api";
export const EMAIL_CHANGE_LIFETIME_MS = 60 * 60 * 1000;
export const activeEmailChangeStates = [
  "pending_current_email",
  "pending_new_email",
] as const;
export function invalidEmailChange(): APIError {
  return new APIError("BAD_REQUEST", {
    code: "EMAIL_CHANGE_INVALID",
    message: "Email change cannot be completed",
  });
}
// Better Auth 1.7.4 validates with z.email(), then lowercases; it does not trim
// or apply provider-specific rewriting. This is Zod's default email expression.
export function normalizeEmail(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/.test(
      value,
    )
  )
    throw invalidEmailChange();
  return value.toLowerCase();
}
export function hashEmailChangeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function newEmailChangeToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashEmailChangeToken(token) };
}
export function requireEmailChangeToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value))
    throw invalidEmailChange();
  return value;
}
export function emailChangeExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}
export function singleField(body: unknown, field: string): unknown {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !(field in body)
  )
    throw invalidEmailChange();
  return (body as Record<string, unknown>)[field];
}
