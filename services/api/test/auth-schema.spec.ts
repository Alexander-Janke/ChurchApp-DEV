import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, expect, it, vi } from "vitest";
import { createBetterAuth } from "../src/auth/auth.config.js";
import * as schema from "../src/database/schema/index.js";

afterEach(() => vi.unstubAllEnvs());

it("validates the canonical Drizzle models with Better Auth's default schema checks", async () => {
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "schema-test-only-not-a-runtime-secret-12345",
  );
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
  const auth = createBetterAuth(drizzle.mock({ schema }));
  const context = await auth.$context;
  expect(context.checkSchema).toBeTypeOf("function");
  await expect(context.checkSchema!()).resolves.toBeUndefined();
});
