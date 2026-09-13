import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { AuthEmailSender } from "../../src/auth/auth-email.js";
import { getDatabaseUrl } from "../../src/database/database.config.js";
import { DATABASE_POOL } from "../../src/database/database.constants.js";
import { TestAuthEmailSender } from "./auth-email.js";

// Registered only by database.integration.spec.ts; never part of the fast suite.
export function registrationIntegrationTests() {
  describe("registration against disposable PostgreSQL", () => {
    const databaseName = `auth_registration_test_${randomUUID().replaceAll("-", "")}`;
    const sender = new TestAuthEmailSender();
    const origin = "http://localhost:3001";
    const fixture = {
      name: "Registration fixture",
      email: "registration@example.invalid",
      password: "test-only registration password",
    };
    let maintenance: Pool;
    let pool: Pool;
    let app: NestExpressApplication;
    let created = false;

    beforeAll(async () => {
      const url = new URL(getDatabaseUrl());
      maintenance = new Pool({ connectionString: url.toString() });
      await maintenance.query(
        `CREATE DATABASE "${databaseName}" TEMPLATE template0`,
      );
      created = true;
      url.pathname = `/${databaseName}`;
      pool = new Pool({ connectionString: url.toString() });
      await migrate(drizzle(pool), {
        migrationsFolder: fileURLToPath(
          new URL("../../migrations", import.meta.url),
        ),
      });
      vi.stubEnv(
        "BETTER_AUTH_SECRET",
        "registration-test-only-not-a-runtime-secret-12345",
      );
      vi.stubEnv("BETTER_AUTH_URL", origin);
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DATABASE_POOL)
        .useValue(pool)
        .overrideProvider(AuthEmailSender)
        .useValue(sender)
        .compile();
      app = module.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      });
      configureApp(app);
      await app.init();
    }, 30_000);

    beforeEach(async () => {
      sender.reset();
      // This pool connects only to the randomly named database created above.
      await pool.query(
        'TRUNCATE "session", "account", "verification", "user" CASCADE',
      );
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      sender.reset();
    });

    afterAll(async () => {
      try {
        if (app) await app.close();
        else await pool?.end();
      } finally {
        try {
          if (created)
            await maintenance.query(`DROP DATABASE "${databaseName}"`);
        } finally {
          await maintenance?.end();
          vi.unstubAllEnvs();
        }
      }
    });

    function signup(overrides: Record<string, unknown> = {}) {
      return request(app.getHttpServer())
        .post("/api/v1/auth/sign-up/email")
        .set("Origin", origin)
        .send({ ...fixture, ...overrides });
    }

    function signin(password = fixture.password) {
      return request(app.getHttpServer())
        .post("/api/v1/auth/sign-in/email")
        .set("Origin", origin)
        .send({ email: fixture.email, password });
    }

    function verificationUrl() {
      expect(sender.messages.length).toBe(1);
      return new URL(sender.messages[0]!.url);
    }

    function verify(url = verificationUrl()) {
      return request(app.getHttpServer()).get(url.pathname + url.search);
    }

    async function count(
      table: "user" | "session" | "account" | "verification",
    ) {
      return (
        await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM "${table}"`,
        )
      ).rows[0]!.count;
    }

    it("registers an unverified user and credential account with a hash, without a session or response leakage", async () => {
      const response = await signup().expect(200);
      const users = (
        await pool.query<{
          id: string;
          email: string;
          email_verified: boolean;
        }>('SELECT id, email, email_verified FROM "user"')
      ).rows;
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({
        email: fixture.email,
        email_verified: false,
      });
      const accounts = (
        await pool.query<{
          account_id: string;
          user_id: string;
          provider_id: string;
          password: string;
        }>("SELECT account_id, user_id, provider_id, password FROM account")
      ).rows;
      expect(accounts.length).toBe(1);
      const account = accounts[0]!;
      expect(account.provider_id).toBe("credential");
      expect(account.user_id).toBe(users[0]!.id);
      expect(account.account_id).toBe(users[0]!.id);
      // Boolean assertions avoid printing the hash or credential on failure.
      expect(
        account.password.length > 0 && account.password !== fixture.password,
      ).toBe(true);
      expect(/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(account.password)).toBe(true);
      expect(response.body.token === null).toBe(true);
      expect(response.body.user.emailVerified).toBe(false);
      expect(Object.keys(response.body).sort()).toEqual(["token", "user"]);
      expect(Object.keys(response.body.user).sort()).toEqual([
        "createdAt",
        "email",
        "emailVerified",
        "id",
        "image",
        "name",
        "updatedAt",
      ]);
      expect(
        response.text.includes(fixture.password) ||
          response.text.includes(account.password),
      ).toBe(false);
      expect(sender.messages.length).toBe(1);
      expect(sender.messages[0]!.recipient).toBe(fixture.email);
      expect(response.text.includes(sender.messages[0]!.token)).toBe(false);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await count("session")).toBe(0);
    });

    it("normalizes email case and returns a synthetic success for duplicate signup without creating another account", async () => {
      const first = await signup({
        email: "Registration@Example.Invalid",
      }).expect(200);
      const second = await signup({ name: "Different submitted name" }).expect(
        200,
      );
      expect(first.body.user.email).toBe(fixture.email);
      expect(second.body.user.email).toBe(fixture.email);
      expect(second.body.user.name).toBe("Different submitted name");
      expect(second.body.user.id === first.body.user.id).toBe(false);
      expect(second.body.token === null).toBe(true);
      expect(Object.keys(second.body.user).sort()).toEqual(
        Object.keys(first.body.user).sort(),
      );
      expect(await count("user")).toBe(1);
      expect(await count("account")).toBe(1);
      expect(await count("session")).toBe(0);
      expect(sender.messages.length).toBe(1);
    });

    it("rejects unverified password sign-in without issuing a session", async () => {
      await signup().expect(200);
      const response = await signin().expect(403);
      expect(response.body.code).toBe("EMAIL_NOT_VERIFIED");
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await count("session")).toBe(0);
    });

    // Accepted native links are stateless verification tokens, not session credentials.
    it("verifies email and handles replay without duplicate users/accounts or sessions", async () => {
      await signup().expect(200);
      const url = verificationUrl();
      expect(url.origin).toBe(origin);
      expect(url.pathname).toBe("/api/v1/auth/verify-email");
      expect(url.searchParams.get("token") === sender.messages[0]!.token).toBe(
        true,
      );
      expect(await count("verification")).toBe(0);
      const first = await verify(url).expect(302);
      expect(first.headers.location).toBe("/");
      expect(first.headers["set-cookie"]).toBeUndefined();
      expect(
        (
          await pool.query<{ email_verified: boolean }>(
            'SELECT email_verified FROM "user"',
          )
        ).rows[0]!.email_verified,
      ).toBe(true);
      expect(await count("session")).toBe(0);
      expect(await count("user")).toBe(1);
      expect(await count("account")).toBe(1);
      const userStateQuery =
        'SELECT id, name, email, email_verified, image, created_at, updated_at FROM "user" ORDER BY id';
      const accountStateQuery =
        "SELECT id, account_id, user_id, provider_id, created_at, updated_at FROM account ORDER BY id";
      const verifiedUsers = (await pool.query(userStateQuery)).rows;
      const credentialAccounts = (await pool.query(accountStateQuery)).rows;
      // Better Auth 1.7.4 treats an already verified email as idempotent success.
      const repeated = await verify(url).expect(302);
      expect(repeated.headers.location).toBe("/");
      expect(repeated.headers["set-cookie"]).toBeUndefined();
      url.searchParams.delete("callbackURL");
      await verify(url).expect(200).expect({ status: true, user: null });
      expect(await count("user")).toBe(1);
      expect(await count("account")).toBe(1);
      expect((await pool.query(userStateQuery)).rows).toEqual(verifiedUsers);
      expect((await pool.query(accountStateQuery)).rows).toEqual(
        credentialAccounts,
      );
      expect(await count("session")).toBe(0);
      expect(await count("verification")).toBe(0);
    });

    it("allows explicit password sign-in after canonical verification and persists an opaque session", async () => {
      await signup().expect(200);
      await verify().expect(302);
      const response = await signin().expect(200);
      // The browser receives the credential only through its HttpOnly cookie.
      const token = (
        await pool.query<{ token: string }>('SELECT token FROM "session"')
      ).rows[0]!.token;
      expect(token.length > 0 && token.split(".").length === 1).toBe(true);
      expect(response.body.token).toBeUndefined();
      expect(Boolean(response.headers["set-cookie"])).toBe(true);
      expect(response.body.user.emailVerified).toBe(true);
      expect(await count("session")).toBe(1);
      expect(response.text.includes(fixture.password)).toBe(false);
      await signin("incorrect test password").expect(401);
      expect(await count("session")).toBe(1);
    });

    it("rejects a malformed verification token without updating the user", async () => {
      await signup().expect(200);
      const url = verificationUrl();
      url.searchParams.delete("callbackURL");
      url.searchParams.set("token", "invalid-test-token");
      const response = await verify(url).expect(401);
      expect(response.body.code).toBe("INVALID_TOKEN");
      expect(
        (
          await pool.query<{ email_verified: boolean }>(
            'SELECT email_verified FROM "user"',
          )
        ).rows[0]!.email_verified,
      ).toBe(false);
      expect(await count("session")).toBe(0);
    });

    it("rejects an altered signature on a correctly formatted verification token", async () => {
      await signup().expect(200);
      const url = verificationUrl();
      url.searchParams.delete("callbackURL");
      const parts = sender.messages[0]!.token.split(".");
      expect(parts.length).toBe(3);
      const signature = parts[2]!;
      parts[2] = (signature.startsWith("A") ? "B" : "A") + signature.slice(1);
      url.searchParams.set("token", parts.join("."));
      const response = await verify(url).expect(401);
      expect(response.body.code).toBe("INVALID_TOKEN");
      expect(
        (
          await pool.query<{ email_verified: boolean }>(
            'SELECT email_verified FROM "user"',
          )
        ).rows[0]!.email_verified,
      ).toBe(false);
      expect(await count("session")).toBe(0);
      expect(await count("user")).toBe(1);
      expect(await count("account")).toBe(1);
    });

    it("rejects the generated verification token after one hour", async () => {
      await signup().expect(200);
      const url = verificationUrl();
      url.searchParams.delete("callbackURL");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 3_601_000);
      const response = await verify(url).expect(401);
      expect(response.body.code).toBe("TOKEN_EXPIRED");
      expect(
        (
          await pool.query<{ email_verified: boolean }>(
            'SELECT email_verified FROM "user"',
          )
        ).rows[0]!.email_verified,
      ).toBe(false);
      expect(await count("session")).toBe(0);
    });

    it("rejects a changed verification callback without redirecting or updating the user", async () => {
      await signup().expect(200);
      const url = verificationUrl();
      url.searchParams.set("callbackURL", "https://untrusted.example.invalid");
      const response = await verify(url).expect(403);
      expect(response.headers.location).toBeUndefined();
      expect(
        (
          await pool.query<{ email_verified: boolean }>(
            'SELECT email_verified FROM "user"',
          )
        ).rows[0]!.email_verified,
      ).toBe(false);
    });

    it("rejects protected fields without persisting a user or sending mail", async () => {
      await signup({ emailVerified: true }).expect(400);
      expect(await count("user")).toBe(0);
      expect(await count("account")).toBe(0);
      expect(sender.messages.length).toBe(0);
    });

    it("rejects an external signup callback without persisting a user", async () => {
      await signup({ callbackURL: "https://untrusted.example.invalid" }).expect(
        403,
      );
      expect(await count("user")).toBe(0);
      expect(sender.messages.length).toBe(0);
    });

    it.each([12, 128])(
      "accepts the password policy boundary of %s characters",
      async (length) => {
        await signup({ password: "x".repeat(length) }).expect(200);
        expect(await count("user")).toBe(1);
      },
    );

    it("keeps health public after registration", async () => {
      await signup().expect(200);
      await request(app.getHttpServer())
        .get("/api/v1/health")
        .expect(200)
        .expect({ status: "ok" });
    });
  });
}
