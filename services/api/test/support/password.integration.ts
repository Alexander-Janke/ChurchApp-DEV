import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AuthService } from "@thallesp/nestjs-better-auth";
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
import type { createBetterAuth } from "../../src/auth/auth.config.js";
import { getDatabaseUrl } from "../../src/database/database.config.js";
import { DATABASE_POOL } from "../../src/database/database.constants.js";
import { TestAuthEmailSender } from "./auth-email.js";

export function passwordIntegrationTests() {
  describe("password operations against disposable PostgreSQL", () => {
    const databaseName = `auth_password_test_${randomUUID().replaceAll("-", "")}`;
    const sender = new TestAuthEmailSender();
    const origin = "http://localhost:3001";
    const base = "/api/v1/auth";
    const password = "password-test-only initial password";
    const replacement = "password-test-only replacement password";
    const email = "password@example.invalid";
    let maintenance: Pool;
    let pool: Pool;
    let app: NestExpressApplication;
    let auth: ReturnType<typeof createBetterAuth>;
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
        "password-integration-test-only-not-a-runtime-secret-12345",
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
      auth =
        app.get<AuthService<ReturnType<typeof createBetterAuth>>>(
          AuthService,
        ).instance;
    }, 30_000);
    beforeEach(async () => {
      sender.reset();
      await pool.query(
        'TRUNCATE "session", "account", "verification", "user" CASCADE',
      );
    });
    afterEach(async () => {
      await sender.onModuleDestroy();
      sender.reset();
      vi.useRealTimers();
      vi.restoreAllMocks();
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
    function post(
      path: string,
      body: Record<string, unknown>,
      cookie?: string,
    ) {
      const call = request(app.getHttpServer())
        .post(base + path)
        .set("Origin", origin);
      if (cookie) call.set("Cookie", cookie);
      return call.send(body);
    }
    async function register(address = email) {
      const response = await post("/sign-up/email", {
        name: "Password fixture",
        email: address,
        password,
      }).expect(200);
      const url = new URL(sender.messages.at(-1)!.url);
      await request(app.getHttpServer())
        .get(url.pathname + url.search)
        .expect(302);
      return response.body.user.id as string;
    }
    function signin(address = email, credential = password) {
      return post("/sign-in/email", { email: address, password: credential });
    }
    async function login(address = email, credential = password) {
      const response = await signin(address, credential).expect(200);
      const values: unknown = response.headers["set-cookie"];
      const headers: string[] = Array.isArray(values)
        ? values
        : typeof values === "string"
          ? [values]
          : [];
      const cookie = headers
        .find((value) => value.startsWith("better-auth.session_token="))
        ?.split(";")[0];
      expect(Boolean(cookie)).toBe(true);
      const current = await session(cookie!);
      return {
        cookie: cookie!,
        id: current.body.session.id as string,
        createdAt: current.body.session.createdAt as string,
      };
    }
    function session(cookie: string) {
      return request(app.getHttpServer())
        .get(base + "/get-session")
        .set("Cookie", cookie)
        .expect(200);
    }
    async function count(
      table: "user" | "account" | "session" | "verification",
    ) {
      return (
        await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM "${table}"`,
        )
      ).rows[0]!.count;
    }
    async function hash(userId: string) {
      return (
        await pool.query<{ password: string }>(
          "SELECT password FROM account WHERE user_id=$1 AND provider_id='credential'",
          [userId],
        )
      ).rows[0]!.password;
    }
    function noLeaks(body: unknown, secrets: string[] = []) {
      const text = JSON.stringify(body);
      expect(
        [password, replacement, ...secrets].some((secret) =>
          text.includes(secret),
        ),
      ).toBe(false);
      expect(
        /"(?:password|passwordHash|accessToken|refreshToken)"\s*:/.test(text),
      ).toBe(false);
      expect(/"token"\s*:\s*"/.test(text)).toBe(false);
    }
    async function requestReset(address = email) {
      const response = await post("/request-password-reset", {
        email: address,
        redirectTo: origin + "/reset",
      }).expect(200);
      await sender.onModuleDestroy();
      return response;
    }
    function reset(token: string, newPassword = replacement) {
      return post("/reset-password", { token, newPassword });
    }

    it.each([true, false, undefined])(
      "changes the password and preserves A's original lifetime while revoking B/C despite client option %s",
      async (revokeOtherSessions) => {
        const userId = await register();
        const a = await login();
        const b = await login();
        const c = await login();
        await register("other@example.invalid");
        const other = await login("other@example.invalid");
        const oldHash = await hash(userId);
        const response = await post(
          "/change-password",
          {
            currentPassword: password,
            newPassword: replacement,
            ...(revokeOtherSessions === undefined
              ? {}
              : { revokeOtherSessions }),
          },
          a.cookie,
        ).expect(200);
        noLeaks(response.body, [oldHash]);
        const current = (await session(a.cookie)).body;
        expect(current.session.id).toBe(a.id);
        expect(current.session.createdAt).toBe(a.createdAt);
        expect((await session(b.cookie)).body).toBeNull();
        expect((await session(c.cookie)).body).toBeNull();
        expect((await session(other.cookie)).body.session.id).toBe(other.id);
        expect(await count("session")).toBe(2);
        expect(await count("user")).toBe(2);
        expect(await count("account")).toBe(2);
        const updated = await hash(userId);
        expect(updated !== oldHash && updated !== replacement).toBe(true);
        await signin(email, password).expect(401);
        await signin(email, replacement).expect(200);
        await signin("other@example.invalid").expect(200);
        expect(
          sender.passwordChanges.some(
            (message) =>
              message.reason === "change" && message.recipient === email,
          ),
        ).toBe(true);
      },
    );
    it.each([false, true])(
      "password audit is atomic with password and revoked sessions (reset=%s)",
      async (resetFlow) => {
        const id = await register();
        const a = await login();
        await login();
        const oldHash = await hash(id);
        if (resetFlow) await requestReset();
        await pool.query(
          "CREATE FUNCTION reject_password_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-audit-fixture'; END $$; CREATE TRIGGER reject_password_audit BEFORE INSERT ON auth_security_event FOR EACH ROW EXECUTE FUNCTION reject_password_audit()",
        );
        try {
          const response = resetFlow
            ? await reset(sender.passwordResets.at(-1)!.token)
            : await post(
                "/change-password",
                { currentPassword: password, newPassword: replacement },
                a.cookie,
              );
          expect(response.status).toBe(503);
          expect((await hash(id)) === oldHash).toBe(true);
          expect(await count("session")).toBe(2);
          expect(
            (
              await pool.query(
                "SELECT count(*)::int n FROM auth_security_event WHERE subject_user_id=$1",
                [id],
              )
            ).rows[0].n,
          ).toBe(0);
        } finally {
          await pool.query(
            "DROP TRIGGER reject_password_audit ON auth_security_event; DROP FUNCTION reject_password_audit()",
          );
        }
        const success = resetFlow
          ? await reset(sender.passwordResets.at(-1)!.token)
          : await post(
              "/change-password",
              { currentPassword: password, newPassword: replacement },
              a.cookie,
            );
        expect(success.status).toBe(200);
        const events = (
          await pool.query(
            "SELECT event_type,metadata FROM auth_security_event WHERE subject_user_id=$1",
            [id],
          )
        ).rows;
        expect(
          events.filter(
            (row) =>
              row.event_type ===
              (resetFlow ? "password_reset" : "password_changed"),
          ),
        ).toHaveLength(1);
        expect(
          events.filter((row) => row.event_type === "session_revoked"),
        ).toHaveLength(resetFlow ? 2 : 1);
        expect(
          events.every((row) => Object.keys(row.metadata).length === 0),
        ).toBe(true);
      },
    );
    it("rejects a wrong current password without updating credentials or revoking sessions", async () => {
      const id = await register();
      const a = await login();
      await login();
      const before = await hash(id);
      const response = await post(
        "/change-password",
        {
          currentPassword: "wrong fixture password",
          newPassword: replacement,
          revokeOtherSessions: true,
        },
        a.cookie,
      ).expect(400);
      noLeaks(response.body, [before]);
      expect((await hash(id)) === before).toBe(true);
      expect(await count("session")).toBe(2);
      await signin().expect(200);
      await signin(email, replacement).expect(401);
    });
    it("rejects an unauthenticated change and current-password reuse", async () => {
      await register();
      const a = await login();
      await post("/change-password", {
        currentPassword: password,
        newPassword: replacement,
      }).expect(401);
      const response = await post(
        "/change-password",
        { currentPassword: password, newPassword: password },
        a.cookie,
      ).expect(400);
      expect(response.body.code).toBe("PASSWORD_MUST_DIFFER");
      expect(await count("session")).toBe(1);
    });
    it.each([11, 129])(
      "rejects a changed password of length %i",
      async (length) => {
        await register();
        const a = await login();
        await post(
          "/change-password",
          { currentPassword: password, newPassword: "x".repeat(length) },
          a.cookie,
        ).expect(400);
        await signin().expect(200);
      },
    );
    it("does not restart the absolute session clock on password change", async () => {
      await register();
      const a = await login();
      const now = Date.now();
      const createdAt = new Date(now - 29 * 86400000);
      await pool.query('UPDATE "session" SET created_at=$1 WHERE id=$2', [
        createdAt.toISOString(),
        a.id,
      ]);
      await post(
        "/change-password",
        { currentPassword: password, newPassword: replacement },
        a.cookie,
      ).expect(200);
      expect((await session(a.cookie)).body.session.createdAt).toBe(
        createdAt.toISOString(),
      );
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(createdAt.getTime() + 30 * 86400000);
      expect((await session(a.cookie)).body).toBeNull();
      expect(await count("session")).toBe(0);
    });
    it("does not falsely report success if other-session deletion fails", async () => {
      await register();
      const a = await login();
      await login();
      const ctx = await auth.$context;
      vi.spyOn(ctx.internalAdapter, "deleteSession").mockRejectedValueOnce(
        new Error("private session store failure"),
      );
      const response = await post(
        "/change-password",
        { currentPassword: password, newPassword: replacement },
        a.cookie,
      ).expect(503);
      noLeaks(response.body);
      expect(response.text.includes("private session store failure")).toBe(
        false,
      );
    });
    it("returns the same generic reset response for existing and unknown accounts and only captures existing-account mail", async () => {
      await register();
      const known = await requestReset();
      const unknown = await requestReset("unknown@example.invalid");
      expect(known.body).toEqual(unknown.body);
      expect(sender.passwordResets.length).toBe(1);
      expect(sender.passwordResets[0]!.recipient).toBe(email);
      noLeaks(known.body, [sender.passwordResets[0]!.token]);
      expect(await count("verification")).toBe(1);
      expect(await count("session")).toBe(0);
    });
    it("returns the generic response while delivery is pending, then drains delivery safely", async () => {
      await register();
      let release!: () => void;
      let completed = false;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.spyOn(sender, "sendPasswordReset").mockImplementation(async () => {
        await gate;
        completed = true;
      });
      try {
        await post("/request-password-reset", {
          email,
          redirectTo: origin + "/reset",
        })
          .timeout({ response: 3000 })
          .expect(200);
        expect(completed).toBe(false);
        await post("/request-password-reset", {
          email: "unknown@example.invalid",
          redirectTo: origin + "/reset",
        }).expect(200);
      } finally {
        release();
        await sender.onModuleDestroy();
      }
      expect(completed).toBe(true);
    });
    it("uses native one-hour verification records and trusted redirect callbacks", async () => {
      const id = await register();
      const before = Date.now();
      await requestReset();
      const message = sender.passwordResets[0]!;
      const rows = (
        await pool.query<{ identifier: string; value: string; expires: Date }>(
          "SELECT identifier, value, expires_at AT TIME ZONE 'UTC' AS expires FROM verification",
        )
      ).rows;
      expect(rows.length).toBe(1);
      expect(rows[0]!.identifier === `reset-password:${message.token}`).toBe(
        true,
      );
      expect(rows[0]!.value).toBe(id);
      expect(rows[0]!.expires.getTime()).toBeGreaterThanOrEqual(
        before + 3600000,
      );
      expect(rows[0]!.expires.getTime()).toBeLessThanOrEqual(
        Date.now() + 3600000,
      );
      const url = new URL(message.url);
      const response = await request(app.getHttpServer())
        .get(url.pathname + url.search)
        .expect(302);
      const location = new URL(response.headers.location!);
      expect(location.origin).toBe(origin);
      expect(location.pathname).toBe("/reset");
      expect(location.searchParams.get("token") === message.token).toBe(true);
      expect(await count("verification")).toBe(1);
      url.searchParams.set(
        "callbackURL",
        "https://untrusted.example.invalid/reset",
      );
      await request(app.getHttpServer())
        .get(url.pathname + url.search)
        .expect(403);
    });
    it("rejects untrusted reset destinations before creating a record", async () => {
      await register();
      await post("/request-password-reset", {
        email,
        redirectTo: "https://untrusted.example.invalid/reset",
      }).expect(403);
      expect(await count("verification")).toBe(0);
      expect(sender.passwordResets.length).toBe(0);
    });
    it("resets through native consumption, revokes all own sessions, preserves other users, and never auto-signs in", async () => {
      const id = await register();
      const a = await login();
      const b = await login();
      const c = await login();
      await register("other@example.invalid");
      const other = await login("other@example.invalid");
      const original = await hash(id);
      await requestReset();
      const token = sender.passwordResets[0]!.token;
      const response = await reset(token).expect(200);
      noLeaks(response.body, [token, original]);
      expect(await count("verification")).toBe(0);
      for (const client of [a, b, c])
        expect((await session(client.cookie)).body).toBeNull();
      expect((await session(other.cookie)).body.session.id).toBe(other.id);
      expect(await count("session")).toBe(1);
      expect(await count("user")).toBe(2);
      expect(await count("account")).toBe(2);
      const updated = await hash(id);
      expect(updated !== original && updated !== replacement).toBe(true);
      await reset(token, "another test-only password").expect(400);
      expect((await hash(id)) === updated).toBe(true);
      await signin().expect(401);
      await signin(email, replacement).expect(200);
      await signin("other@example.invalid").expect(200);
      expect(
        sender.passwordChanges.some(
          (message) =>
            message.reason === "reset" && message.recipient === email,
        ),
      ).toBe(true);
    });
    it.each(["malformed", "tampered", "expired"])(
      "rejects a %s reset token without changing password or sessions",
      async (kind) => {
        const id = await register();
        const a = await login();
        const original = await hash(id);
        await requestReset();
        const token = sender.passwordResets[0]!.token;
        let submitted = token;
        if (kind === "malformed") submitted = "invalid-token";
        if (kind === "tampered") submitted = token + "changed";
        if (kind === "expired") {
          vi.useFakeTimers({ toFake: ["Date"] });
          vi.setSystemTime(Date.now() + 3601000);
        }
        const response = await reset(submitted).expect(400);
        noLeaks(response.body, [token, original]);
        expect((await hash(id)) === original).toBe(true);
        expect(await count("session")).toBe(1);
        expect((await session(a.cookie)).body.session.id).toBe(a.id);
      },
    );
    it("allows only one concurrent reset with the same native token", async () => {
      await register();
      await requestReset();
      const token = sender.passwordResets[0]!.token;
      const responses = await Promise.all([reset(token), reset(token)]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 400,
      ]);
      expect(await count("verification")).toBe(0);
      expect(await count("session")).toBe(0);
      expect(await count("account")).toBe(1);
    });
    it("does not turn recovery into implicit password creation for an account without a credential", async () => {
      const id = await register();
      // Test-only fixture for a future identity without a local password; no OAuth.
      await pool.query("DELETE FROM account WHERE user_id=$1", [id]);
      await requestReset();
      const response = await reset(sender.passwordResets[0]!.token).expect(400);
      expect(response.body.code).toBe("PASSWORD_CREATION_NOT_ENABLED");
      expect(await count("account")).toBe(0);
      expect(await count("session")).toBe(0);
      expect(await count("user")).toBe(1);
    });
    it("blocks the native server-only setPassword API from bypassing explicit credential-creation policy", async () => {
      const id = await register();
      const current = await login();
      await pool.query("DELETE FROM account WHERE user_id=$1", [id]);
      await expect(
        auth.api.setPassword({
          headers: new Headers({ cookie: current.cookie }),
          body: { newPassword: replacement },
        }),
      ).rejects.toMatchObject({
        body: { code: "PASSWORD_CREATION_NOT_ENABLED" },
      });
      expect(await count("account")).toBe(0);
      expect((await session(current.cookie)).body.session.id).toBe(current.id);
    });
    it.each([12, 128])(
      "accepts the shared reset password boundary of %i characters",
      async (length) => {
        await register();
        await requestReset();
        const changed = "x".repeat(length);
        await reset(sender.passwordResets[0]!.token, changed).expect(200);
        await signin(email, changed).expect(200);
      },
    );
    it("does not report reset success if all-session revocation fails", async () => {
      await register();
      await login();
      await requestReset();
      const ctx = await auth.$context;
      vi.spyOn(ctx.internalAdapter, "deleteUserSessions").mockRejectedValueOnce(
        new Error("private revocation failure"),
      );
      const response = await reset(sender.passwordResets[0]!.token);
      expect(response.status).toBeGreaterThanOrEqual(500);
      noLeaks(response.body);
      expect(response.text.includes("private revocation failure")).toBe(false);
    });
  });
}
