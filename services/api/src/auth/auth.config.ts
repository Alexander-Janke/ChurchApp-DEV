import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import type { Database } from "../database/database.types.js";
import * as authSchema from "../database/schema/auth.js";
import { BETTER_AUTH_BASE_PATH } from "./auth.constants.js";

const MIN_SECRET_LENGTH = 32;

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export function getBetterAuthSecret(
  value = process.env.BETTER_AUTH_SECRET,
): string {
  if (!value?.trim()) {
    throw new AuthConfigurationError("BETTER_AUTH_SECRET is required");
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new AuthConfigurationError(
      `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  return value;
}

export function getBetterAuthUrl(value = process.env.BETTER_AUTH_URL): string {
  if (!value?.trim()) {
    throw new AuthConfigurationError("BETTER_AUTH_URL is required");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthConfigurationError(
      "BETTER_AUTH_URL must be an absolute HTTP(S) URL",
    );
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname
  ) {
    throw new AuthConfigurationError(
      "BETTER_AUTH_URL must be an absolute HTTP(S) URL",
    );
  }

  return url.toString().replace(/\/$/, "");
}

export function createBetterAuth(database: Database) {
  // Better Auth's default 2FA challenge covers credential sign-in but does not
  // automatically gate OAuth/social authentication; privileged assurance will
  // remain an application-owned check when those providers are added.
  return betterAuth({
    baseURL: getBetterAuthUrl(),
    basePath: BETTER_AUTH_BASE_PATH,
    secret: getBetterAuthSecret(),
    database: drizzleAdapter(database, { provider: "pg", schema: authSchema }),
  });
}
