import { createHash, randomBytes } from "node:crypto";
import { APIError } from "better-auth/api";

// Public activation requires separately reviewed completion and security events.
export const GOOGLE_AUTHENTICATION_ENABLED = false;
export const SOCIAL_PRE_AUTH_LIFETIME_MS = 10 * 60 * 1000;
export const SOCIAL_PRE_AUTH_PREFIX = "social-pre-auth:";
export const GOOGLE_PUBLIC_START_PATH = "/api/v1/google/start";
export const GOOGLE_PUBLIC_CALLBACK_PATH = "/api/v1/google/callback";
export const GOOGLE_PUBLIC_COMPLETE_PATH = "/auth/google/complete";
export const GOOGLE_PUBLIC_ERROR_PATH = "/auth/google/error";

export function googlePublicCallbackURL(baseURL: string): string {
  return new URL(GOOGLE_PUBLIC_CALLBACK_PATH, baseURL).href;
}

export function isApprovedGoogleRedirect(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  try {
    const url = new URL(value, "https://church-platform.invalid");
    return (
      url.origin === "https://church-platform.invalid" &&
      url.pathname === GOOGLE_PUBLIC_COMPLETE_PATH &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export function challengeHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function newSocialChallenge(): string {
  return randomBytes(32).toString("hex");
}
export function challengeKey(token: unknown): string {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw new APIError("UNAUTHORIZED", { message: "Invalid social challenge" });
  return SOCIAL_PRE_AUTH_PREFIX + challengeHash(token);
}
export function googleCredentials(env = process.env, redirectURI?: string) {
  const id = env.GOOGLE_CLIENT_ID;
  const secret = env.GOOGLE_CLIENT_SECRET;
  if (id === undefined && secret === undefined) return undefined;
  if (
    !id?.trim() ||
    !secret?.trim() ||
    id !== id.trim() ||
    secret !== secret.trim()
  )
    throw new Error("Both Google configuration variables must be nonempty");
  return {
    clientId: id,
    clientSecret: secret,
    ...(redirectURI ? { redirectURI } : {}),
    disableSignUp: true,
    overrideUserInfoOnSignIn: false,
  };
}
export function googleInput(value: unknown, callback: boolean) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new APIError("BAD_REQUEST", { message: "Invalid Google request" });
  const input = value as Record<string, unknown>;
  const keys = callback ? ["code", "state"] : [];
  if (
    Object.keys(input).length !== keys.length ||
    Object.keys(input).some((k) => !keys.includes(k)) ||
    keys.some(
      (k) =>
        typeof input[k] !== "string" ||
        !input[k] ||
        (input[k] as string).length > 4096,
    )
  )
    throw new APIError("BAD_REQUEST", { message: "Invalid Google request" });
  return input as { code?: string; state?: string };
}

export function googleBody(callback: boolean) {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "church-platform",
      validate(value: unknown) {
        try {
          return { value: googleInput(value, callback) };
        } catch {
          return { issues: [{ message: "Invalid Google request" }] };
        }
      },
    },
  };
}
