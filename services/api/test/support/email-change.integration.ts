import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AuthService } from "@thallesp/nestjs-better-auth";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

export function emailChangeIntegrationTests() {
  describe("application-owned email change against disposable PostgreSQL", () => {
    const databaseName = `auth_email_change_test_${randomUUID().replaceAll("-", "")}`;
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
    const destination = "new@example.invalid";
    async function begin(cookie: string, target = destination) {
      const response = await post(
        "/email-change/request",
        { newEmail: target },
        cookie,
      ).expect(200);
      noLeaks(response.body);
      return sender.emailChangeApprovals.at(-1)!;
    }
    const approve = (token: string) =>
      post("/email-change/approve-current", { token });
    const verify = (token: string) =>
      post("/email-change/verify-new", { token });
    async function phase2(cookie: string, target = destination) {
      const approval = await begin(cookie, target);
      await approve(approval.token).expect(200);
      return sender.emailChangeVerifications.at(-1)!;
    }
    async function owner(id: string) {
      return (await pool.query('SELECT * FROM "user" WHERE id=$1', [id]))
        .rows[0];
    }
    async function workflows() {
      return (
        await pool.query(
          "SELECT * FROM email_change_request ORDER BY created_at",
        )
      ).rows;
    }

    it("requires an authenticated session and keeps native changeEmail disabled", async () => {
      await post("/email-change/request", { newEmail: destination }).expect(
        401,
      );
      await register();
      const a = await login();
      await post("/change-email", { newEmail: destination }, a.cookie).expect(
        400,
      );
      expect((await workflows()).length).toBe(0);
    });
    it.each([true, false])(
      "requires current-address approval even when emailVerified=%s",
      async (verified) => {
        const id = await register();
        const a = await login();
        if (!verified)
          await pool.query(
            'UPDATE "user" SET email_verified=false WHERE id=$1',
            [id],
          );
        const approval = await begin(a.cookie);
        expect(approval.recipient).toBe(email);
        expect(sender.emailChangeVerifications.length).toBe(0);
        expect((await owner(id)).email).toBe(email);
        const first = (await workflows())[0]!;
        expect(first.current_email_token_hash.length).toBe(64);
        expect(JSON.stringify(first).includes(approval.token)).toBe(false);
        const response = await approve(approval.token).expect(200);
        noLeaks(response.body, [approval.token]);
        const message = sender.emailChangeVerifications[0]!;
        expect(message.recipient).toBe(destination);
        expect((await owner(id)).email).toBe(email);
        const second = (await workflows())[0]!;
        expect(second.current_email_token_hash).toBeNull();
        expect(second.new_email_token_hash.length).toBe(64);
        expect(JSON.stringify(second).includes(message.token)).toBe(false);
        expect(second.expires_at).toEqual(first.expires_at);
      },
    );
    it.each([email, email.toUpperCase(), " new@example.invalid "])(
      "rejects same/case-equivalent or whitespace email %s before mail",
      async (proposed) => {
        await register();
        const a = await login();
        await post(
          "/email-change/request",
          { newEmail: proposed },
          a.cookie,
        ).expect(400);
        expect(sender.emailChangeApprovals.length).toBe(0);
        expect((await workflows()).length).toBe(0);
      },
    );
    it("rejects an owned destination without changing either identity", async () => {
      const id = await register();
      await register(destination);
      const a = await login();
      await post(
        "/email-change/request",
        { newEmail: destination.toUpperCase() },
        a.cookie,
      ).expect(400);
      expect((await owner(id)).email).toBe(email);
      expect(sender.emailChangeApprovals.length).toBe(0);
    });
    it("completes atomically with stable identity/password/current session and other-user isolation", async () => {
      const id = await register();
      const a = await login();
      const b = await login();
      const c = await login();
      const accountBefore = (
        await pool.query("SELECT * FROM account WHERE user_id=$1", [id])
      ).rows;
      await register("other@example.invalid");
      const other = await login("other@example.invalid");
      const message = await phase2(a.cookie, destination.toUpperCase());
      const response = await verify(message.token).expect(200);
      noLeaks(response.body, [message.token, accountBefore[0].password]);
      expect(response.headers["set-cookie"]).toBeUndefined();
      const updated = await owner(id);
      expect(updated.email).toBe(destination);
      expect(updated.email_verified).toBe(true);
      expect(
        (await pool.query("SELECT * FROM account WHERE user_id=$1", [id])).rows,
      ).toEqual(accountBefore);
      const current = (await session(a.cookie)).body;
      expect(current.user.id).toBe(id);
      expect(current.user.email).toBe(destination);
      expect(current.session.createdAt).toBe(a.createdAt);
      expect((await session(b.cookie)).body).toBeNull();
      expect((await session(c.cookie)).body).toBeNull();
      expect((await session(other.cookie)).body.session.id).toBe(other.id);
      expect(await count("session")).toBe(2);
      expect(await count("user")).toBe(2);
      expect(await count("account")).toBe(2);
      await signin(email).expect(401);
      await signin(destination).expect(200);
      await sender.onModuleDestroy();
      expect(sender.emailChangeCompletions).toEqual([
        { recipient: email, newEmail: destination },
      ]);
      expect((await workflows())[0].status).toBe("completed");
      await verify(message.token).expect(400);
    });
    it.each(["approve", "verify"])(
      "rejects malformed/wrong %s tokens",
      async (phase) => {
        await register();
        const a = await login();
        const approval = await begin(a.cookie);
        if (phase === "verify") await approve(approval.token).expect(200);
        const action = phase === "approve" ? approve : verify;
        await action("bad").expect(400);
        await action("x".repeat(43)).expect(400);
        expect(
          (await pool.query('SELECT email FROM "user"')).rows[0].email,
        ).toBe(email);
      },
    );
    it.each(["approve", "verify"])(
      "rejects %s at the exact original one-hour expiry",
      async (phase) => {
        const id = await register();
        const a = await login();
        const approval = await begin(a.cookie);
        let token = approval.token;
        if (phase === "verify") {
          await approve(token).expect(200);
          token = sender.emailChangeVerifications[0]!.token;
        }
        const expiry = (await workflows())[0].expires_at;
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(expiry);
        await (phase === "approve" ? approve(token) : verify(token)).expect(
          400,
        );
        expect((await owner(id)).email).toBe(email);
      },
    );
    it.each(["approve", "verify"])(
      "consumes %s only once under concurrent and sequential replay",
      async (phase) => {
        await register();
        const a = await login();
        const approval = await begin(a.cookie);
        let token = approval.token;
        if (phase === "verify") {
          await approve(token).expect(200);
          token = sender.emailChangeVerifications[0]!.token;
        }
        const action = phase === "approve" ? approve : verify;
        const results = await Promise.all([action(token), action(token)]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
        await action(token).expect(400);
      },
    );
    it.each(["approve", "verify"])(
      "supersedes stale %s requests, including after original-address reassignment",
      async (phase) => {
        const idA = await register();
        const a = await login();
        const staleApproval = await begin(a.cookie, "stale@example.invalid");
        let staleToken = staleApproval.token;
        if (phase === "verify") {
          await approve(staleToken).expect(200);
          staleToken = sender.emailChangeVerifications.at(-1)!.token;
        }
        const legitimate = await phase2(a.cookie);
        await (
          phase === "approve" ? approve(staleToken) : verify(staleToken)
        ).expect(400);
        await verify(legitimate.token).expect(200);
        const idB = await register(email);
        const beforeSessions = await count("session");
        const response = await (
          phase === "approve" ? approve(staleToken) : verify(staleToken)
        ).expect(400);
        noLeaks(response.body, [staleToken]);
        expect((await owner(idA)).email).toBe(destination);
        expect((await owner(idB)).email).toBe(email);
        expect(await count("session")).toBe(beforeSessions);
        expect((await workflows()).map((row) => row.status)).toEqual([
          "superseded",
          "completed",
        ]);
      },
    );
    it("allows only one active workflow during concurrent creation", async () => {
      await register();
      const a = await login();
      const replies = await Promise.all([
        post("/email-change/request", { newEmail: destination }, a.cookie),
        post(
          "/email-change/request",
          { newEmail: "another@example.invalid" },
          a.cookie,
        ),
      ]);
      expect(replies.map((r) => r.status)).toEqual([200, 200]);
      const rows = await workflows();
      expect(
        rows.filter((r) => r.status === "pending_current_email").length,
      ).toBe(1);
      const results = await Promise.all(
        sender.emailChangeApprovals.map((m) => approve(m.token)),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    });
    it("rechecks the destination at completion", async () => {
      const id = await register();
      const a = await login();
      const message = await phase2(a.cookie);
      const idB = await register(destination);
      await verify(message.token).expect(400);
      expect((await owner(id)).email).toBe(email);
      expect((await owner(idB)).email).toBe(destination);
    });
    it("fails if the immutable user's current email no longer matches the snapshot", async () => {
      const id = await register();
      const a = await login();
      const message = await phase2(a.cookie);
      await pool.query('UPDATE "user" SET email=$1 WHERE id=$2', [
        "changed@example.invalid",
        id,
      ]);
      await verify(message.token).expect(400);
      expect((await owner(id)).email).toBe("changed@example.invalid");
    });
    it.each(["missing", "absolute-expired"])(
      "revokes all remaining own sessions if initiator is %s without auto-login",
      async (kind) => {
        await register();
        const a = await login();
        const b = await login();
        const message = await phase2(a.cookie);
        if (kind === "missing")
          await post("/sign-out", {}, a.cookie).expect(200);
        else
          await pool.query('UPDATE "session" SET created_at=$1 WHERE id=$2', [
            new Date(Date.now() - 30 * 86400000).toISOString(),
            a.id,
          ]);
        await verify(message.token).expect(200);
        expect((await session(a.cookie)).body).toBeNull();
        expect((await session(b.cookie)).body).toBeNull();
        expect(await count("session")).toBe(0);
      },
    );
    it.each([
      "userId",
      "sessionId",
      "emailVerified",
      "currentEmail",
      "role",
      "churchId",
      "createdAt",
      "updatedAt",
    ])("rejects injected %s fields", async (field) => {
      await register();
      const a = await login();
      await post(
        "/email-change/request",
        { newEmail: destination, [field]: "injected" },
        a.cookie,
      ).expect(400);
      await post("/email-change/approve-current", {
        token: "x".repeat(43),
        [field]: "injected",
      }).expect(400);
      await post("/email-change/verify-new", {
        token: "x".repeat(43),
        [field]: "injected",
      }).expect(400);
    });
    it.each(["request", "approve-current", "verify-new"])(
      "requires trusted Origin and POST for %s",
      async (path) => {
        const data =
          path === "request"
            ? { newEmail: destination }
            : { token: "x".repeat(43) };
        await request(app.getHttpServer())
          .post(base + "/email-change/" + path)
          .send(data)
          .expect(403);
        await request(app.getHttpServer())
          .post(base + "/email-change/" + path)
          .set("Origin", "https://attacker.example.invalid")
          .send(data)
          .expect(403);
        const get = await request(app.getHttpServer()).get(
          base + "/email-change/" + path,
        );
        expect(get.status).toBeGreaterThanOrEqual(400);
      },
    );
    it("rolls back request creation when delivery is unavailable", async () => {
      await register();
      const a = await login();
      vi.spyOn(sender, "assertAvailable").mockImplementationOnce(() => {
        throw new Error("private provider failure");
      });
      const r = await post(
        "/email-change/request",
        { newEmail: destination },
        a.cookie,
      ).expect(503);
      expect(r.text.includes("private provider failure")).toBe(false);
      expect((await workflows()).length).toBe(0);
    });
    it("keeps phase-1 approval retryable when new-address delivery fails", async () => {
      await register();
      const a = await login();
      const approval = await begin(a.cookie);
      vi.spyOn(sender, "sendEmailChangeVerification").mockRejectedValueOnce(
        new Error("private token/provider error"),
      );
      await approve(approval.token).expect(503);
      expect((await workflows())[0].status).toBe("pending_current_email");
      await approve(approval.token).expect(200);
      await verify(sender.emailChangeVerifications.at(-1)!.token).expect(200);
    });
    it.each(["request", "approval"] as const)(
      "rejects a token delivered after the %s transaction timed out and rolled back",
      async (phase) => {
        const id = await register();
        const current = await login();
        const initialApproval =
          phase === "approval" ? await begin(current.cookie) : undefined;
        let release!: () => void;
        let lateToken: string | undefined;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const method =
          phase === "request"
            ? "sendEmailChangeApproval"
            : "sendEmailChangeVerification";
        // Hold only the external operation. The real five-second sender timeout and
        // PostgreSQL transaction run normally; tokens stay in test-process memory.
        vi.spyOn(sender, method).mockImplementationOnce(
          async (message: { token: string }) => {
            await gate;
            lateToken = message.token;
          },
        );
        try {
          const response = await (
            phase === "request"
              ? post(
                  "/email-change/request",
                  { newEmail: destination },
                  current.cookie,
                )
              : approve(initialApproval!.token)
          ).expect(503);
          noLeaks(response.body);
          const rows = await workflows();
          if (phase === "request") expect(rows.length).toBe(0);
          else {
            expect(rows[0].status).toBe("pending_current_email");
            expect(rows[0].new_email_token_hash).toBeNull();
          }
          expect(lateToken === undefined).toBe(true);
          release();
          await sender.onModuleDestroy();
          expect(typeof lateToken === "string").toBe(true);
          const redeemLate = () =>
            phase === "request" ? approve(lateToken!) : verify(lateToken!);
          await redeemLate().expect(400);
          expect((await owner(id)).email).toBe(email);
          expect(await count("session")).toBe(1);
          // Normal retry is still possible, but does not revive the late token.
          const validApproval =
            initialApproval ?? (await begin(current.cookie));
          await approve(validApproval.token).expect(200);
          await redeemLate().expect(400);
          await verify(sender.emailChangeVerifications.at(-1)!.token).expect(
            200,
          );
          await redeemLate().expect(400);
        } finally {
          release();
          await sender.onModuleDestroy();
        }
      },
      15000,
    );
    it("preserves completed identity if informational notice fails", async () => {
      const id = await register();
      const a = await login();
      const message = await phase2(a.cookie);
      vi.spyOn(sender, "sendEmailChangeCompleted").mockRejectedValueOnce(
        new Error("private notice error"),
      );
      await verify(message.token).expect(200);
      await sender.onModuleDestroy();
      expect((await owner(id)).email).toBe(destination);
      expect((await workflows())[0].status).toBe("completed");
    });
    it("applies migrations to a clean database and repeating migrations preserves workflow data", async () => {
      await register();
      const a = await login();
      await begin(a.cookie);
      const migrationNames = [
        "0000_auth_foundation",
        "0001_email_change_workflow",
        "0002_user_profile",
        "0003_church_tenant_foundation",
        "0004_tenant_membership_foundation",
        "0005_roles_permissions_foundation",
        "0006_two_factor_foundation",
        "0007_session_assurance_foundation",
        "0008_two_factor_enrollment_binding",
        "0009_primary_owner_foundation",
        "0010_church_admin_audit_foundation",
      ];
      const expectedHashes = migrationNames.map((name) =>
        createHash("sha256")
          .update(
            readFileSync(
              new URL("../../migrations/" + name + ".sql", import.meta.url),
            ),
          )
          .digest("hex"),
      );
      const applied = await pool.query<{ hash: string }>(
        "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id",
      );
      expect(applied.rows.map((row) => row.hash)).toEqual(expectedHashes);
      const before = await workflows();
      await migrate(drizzle(pool), {
        migrationsFolder: fileURLToPath(
          new URL("../../migrations", import.meta.url),
        ),
      });
      expect(await workflows()).toEqual(before);
      const repeated = await pool.query<{ hash: string }>(
        "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id",
      );
      expect(repeated.rows).toEqual(applied.rows);
    });
  });
}
