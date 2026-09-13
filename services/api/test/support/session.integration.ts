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
import type { createBetterAuth } from "../../src/auth/auth.config.js";
import { AuthEmailSender } from "../../src/auth/auth-email.js";
import { getDatabaseUrl } from "../../src/database/database.config.js";
import { DATABASE_POOL } from "../../src/database/database.constants.js";
import { TestAuthEmailSender } from "./auth-email.js";

type SessionRow = {
  id: string;
  token: string;
  user_id: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  user_agent: string;
  ip_address: string;
};

// Registered only in the real-PostgreSQL suite; credentials stay in test memory.
export function sessionIntegrationTests() {
  describe("normal web sessions against disposable PostgreSQL", () => {
    const databaseName = `auth_session_test_${randomUUID().replaceAll("-", "")}`;
    const sender = new TestAuthEmailSender();
    const origin = "http://localhost:3001";
    const base = "/api/v1/auth";
    const password = "session-test-only fixture password";
    const day = 86_400_000;
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
        "session-integration-test-only-not-a-runtime-secret-12345",
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

    function post(
      path: string,
      cookie?: string,
      body: Record<string, unknown> = {},
    ) {
      const call = request(app.getHttpServer())
        .post(base + path)
        .set("Origin", origin);
      if (cookie) call.set("Cookie", cookie);
      return call.send(body);
    }
    function get(path: string, cookie?: string) {
      const call = request(app.getHttpServer()).get(base + path);
      if (cookie) call.set("Cookie", cookie);
      return call;
    }
    async function register(
      email = "session@example.invalid",
      verified = true,
    ) {
      const response = await post("/sign-up/email", undefined, {
        name: "Session fixture",
        email,
        password,
      }).expect(200);
      if (verified) {
        const url = new URL(sender.messages.at(-1)!.url);
        await request(app.getHttpServer())
          .get(url.pathname + url.search)
          .expect(302);
      }
      return { email, id: response.body.user.id as string };
    }
    async function rows() {
      // Canonical Drizzle timestamps are UTC without time zone. Interpret them
      // explicitly here; pg otherwise reads them in the Windows host time zone.
      return (
        await pool.query<SessionRow>(`SELECT id, token, user_id, user_agent, ip_address,
        created_at AT TIME ZONE 'UTC' AS created_at,
        updated_at AT TIME ZONE 'UTC' AS updated_at,
        expires_at AT TIME ZONE 'UTC' AS expires_at FROM "session"`)
      ).rows;
    }
    function cookieHeaders(value: unknown): string[] {
      if (Array.isArray(value))
        return value.filter((item): item is string => typeof item === "string");
      return typeof value === "string" ? [value] : [];
    }
    async function login(email = "session@example.invalid") {
      const response = await post("/sign-in/email", undefined, {
        email,
        password,
      })
        .set("User-Agent", "Session integration fixture")
        .expect(200);
      const headers = cookieHeaders(response.headers["set-cookie"]);
      const header = headers.find((value) =>
        value.startsWith("better-auth.session_token="),
      );
      expect(Boolean(header)).toBe(true);
      const cookie = header!.split(";")[0]!;
      const current = await get("/get-session", cookie).expect(200);
      const row = (await rows()).find(
        (value) => value.id === current.body.session.id,
      )!;
      expect(Boolean(row)).toBe(true);
      return { cookie, header: header!, row, response };
    }
    async function authenticated(cookie: string) {
      const response = await get("/get-session", cookie).expect(200);
      return response.body !== null && Boolean(response.body.session);
    }
    function safeResponse(value: unknown, credentials: string[]) {
      const serialized = JSON.stringify(value);
      // Boolean comparisons avoid printing cookies, hashes or tokens on failure.
      expect(credentials.some((secret) => serialized.includes(secret))).toBe(
        false,
      );
      expect(
        /"(?:password|passwordHash|accessToken|refreshToken|token)"\s*:/.test(
          serialized,
        ),
      ).toBe(false);
    }

    it("logs in a verified user with an opaque PostgreSQL credential, seven-day expiry and safe browser response", async () => {
      const user = await register();
      const before = Date.now();
      const { row, response, header } = await login();
      expect(row.user_id).toBe(user.id);
      expect(row.token.length > 0 && row.token.split(".").length === 1).toBe(
        true,
      );
      expect(row.expires_at.getTime()).toBeGreaterThanOrEqual(before + 7 * day);
      expect(row.expires_at.getTime()).toBeLessThanOrEqual(
        Date.now() + 7 * day,
      );
      expect(row.user_agent).toBe("Session integration fixture");
      expect(typeof row.ip_address).toBe("string");
      expect(
        header.includes("HttpOnly") &&
          header.includes("SameSite=Lax") &&
          header.includes("Path=/"),
      ).toBe(true);
      expect(header.includes("Secure")).toBe(false);
      safeResponse(response.body, [row.token, password]);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect((await rows()).length).toBe(1);
    });
    it("rejects an unverified password login without creating a session", async () => {
      const user = await register(undefined, false);
      await post("/sign-in/email", undefined, {
        email: user.email,
        password,
      }).expect(403);
      expect((await rows()).length).toBe(0);
    });
    it("uses the same safe response for wrong passwords and unknown email", async () => {
      const user = await register();
      const wrong = await post("/sign-in/email", undefined, {
        email: user.email,
        password: "wrong test-only password",
      }).expect(401);
      const unknown = await post("/sign-in/email", undefined, {
        email: "absent@example.invalid",
        password,
      }).expect(401);
      expect(wrong.body).toEqual(unknown.body);
      safeResponse(wrong.body, [password]);
      expect((await rows()).length).toBe(0);
    });
    it("rejects malformed sign-in without leaking database or credential details", async () => {
      const response = await post("/sign-in/email", undefined, {
        email: "invalid",
        password: 42,
      }).expect(400);
      expect(
        /postgres|select |passwordHash|session-integration-test-only/i.test(
          response.text,
        ),
      ).toBe(false);
      expect((await rows()).length).toBe(0);
    });
    it("returns null without a session and safe user/session metadata with a valid cookie", async () => {
      expect((await get("/get-session").expect(200)).body).toBeNull();
      await register();
      const { cookie, row } = await login();
      const response = await get("/get-session", cookie).expect(200);
      expect(response.body.session.id).toBe(row.id);
      expect(response.body.user.id).toBe(row.user_id);
      safeResponse(response.body, [row.token, password]);
    });
    it("signs out by deleting the database row and clearing the cookie; reuse does not authenticate", async () => {
      await register();
      const { cookie, row } = await login();
      const response = await post("/sign-out", cookie).expect(200);
      expect(
        cookieHeaders(response.headers["set-cookie"]).some(
          (value) =>
            value.startsWith("better-auth.session_token=") &&
            value.includes("Max-Age=0"),
        ),
      ).toBe(true);
      expect((await rows()).length).toBe(0);
      expect(await authenticated(cookie)).toBe(false);
      safeResponse(response.body, [row.token, password]);
    });
    it("does not report successful sign-out when native database deletion fails", async () => {
      await register();
      const { cookie, row } = await login();
      const ctx = await auth.$context;
      vi.spyOn(ctx.internalAdapter, "deleteSession").mockRejectedValueOnce(
        new Error("private database diagnostic"),
      );
      const response = await post("/sign-out", cookie).expect(503);
      expect(response.body.message).toBe(
        "Session operation could not be completed",
      );
      expect(response.text.includes("private database diagnostic")).toBe(false);
      safeResponse(response.body, [row.token]);
      expect((await rows()).length).toBe(1);
    });
    it("supports concurrent sessions and lists only the actor's metadata even with a foreign user query", async () => {
      await register();
      const a = await login();
      const b = await login();
      const other = await register("other@example.invalid");
      const c = await login(other.email);
      expect(await authenticated(a.cookie)).toBe(true);
      expect(await authenticated(b.cookie)).toBe(true);
      const response = await get(
        `/list-sessions?userId=${other.id}`,
        a.cookie,
      ).expect(200);
      expect(
        response.body.map((value: { id: string }) => value.id).sort(),
      ).toEqual([a.row.id, b.row.id].sort());
      safeResponse(response.body, [a.row.token, b.row.token, c.row.token]);
    });
    it("revokes one owned session by non-secret ID while preserving the initiating session", async () => {
      await register();
      const a = await login();
      const b = await login();
      await post("/revoke-session", a.cookie, { sessionId: b.row.id }).expect(
        200,
      );
      expect(await authenticated(a.cookie)).toBe(true);
      expect(await authenticated(b.cookie)).toBe(false);
      expect((await rows()).map((row) => row.id)).toEqual([a.row.id]);
    });
    it("does not revoke a foreign session and does not distinguish foreign from unknown IDs", async () => {
      await register();
      const a = await login();
      const other = await register("other@example.invalid");
      const b = await login(other.email);
      const foreign = await post("/revoke-session", a.cookie, {
        sessionId: b.row.id,
      }).expect(200);
      const missing = await post("/revoke-session", a.cookie, {
        sessionId: "nonexistent",
      }).expect(200);
      expect(foreign.body).toEqual(missing.body);
      expect(await authenticated(b.cookie)).toBe(true);
      expect((await rows()).length).toBe(2);
    });
    it("rejects raw-token and unauthenticated revocation requests", async () => {
      await register();
      const a = await login();
      const b = await login();
      await post("/revoke-session", a.cookie, { token: b.row.token }).expect(
        400,
      );
      await post("/revoke-session", undefined, { sessionId: b.row.id }).expect(
        401,
      );
      expect((await rows()).length).toBe(2);
    });
    it("revoke-other keeps current, removes other own sessions and preserves another user's session", async () => {
      await register();
      const a = await login();
      const b = await login();
      const c = await login();
      const other = await register("other@example.invalid");
      const d = await login(other.email);
      await post("/revoke-other-sessions", a.cookie).expect(200);
      expect(await authenticated(a.cookie)).toBe(true);
      expect(await authenticated(b.cookie)).toBe(false);
      expect(await authenticated(c.cookie)).toBe(false);
      expect(await authenticated(d.cookie)).toBe(true);
    });
    it("revoke-all includes current but never touches another user's sessions", async () => {
      await register();
      const a = await login();
      const b = await login();
      const c = await login();
      const other = await register("other@example.invalid");
      const d = await login(other.email);
      await post("/revoke-sessions", a.cookie).expect(200);
      for (const session of [a, b, c])
        expect(await authenticated(session.cookie)).toBe(false);
      expect(await authenticated(d.cookie)).toBe(true);
      expect((await rows()).map((row) => row.id)).toEqual([d.row.id]);
    });
    it("rejects unsafe origins for session revocation", async () => {
      await register();
      const a = await login();
      await post("/revoke-sessions", a.cookie)
        .set("Origin", "https://untrusted.example.invalid")
        .expect(403);
      expect(await authenticated(a.cookie)).toBe(true);
    });
    it.each([-1, 0, 1])(
      "enforces the absolute boundary at offset %i ms, independently of sliding expiry",
      async (offset) => {
        await register();
        const a = await login();
        const now = Date.now();
        await pool.query(
          'UPDATE "session" SET created_at=$1, expires_at=$2 WHERE id=$3',
          [
            new Date(now - 30 * day - offset).toISOString(),
            new Date(now + 7 * day).toISOString(),
            a.row.id,
          ],
        );
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(now);
        expect(await authenticated(a.cookie)).toBe(offset < 0);
        expect((await rows()).length).toBe(offset < 0 ? 1 : 0);
      },
    );
    it("enforces absolute revocation through the configured server API as well as HTTP", async () => {
      await register();
      const a = await login();
      await pool.query('UPDATE "session" SET created_at=$1 WHERE id=$2', [
        new Date(Date.now() - 31 * day).toISOString(),
        a.row.id,
      ]);
      const result = await auth.api.getSession({
        headers: new Headers({ cookie: a.cookie }),
      });
      expect(result).toBeNull();
      expect((await rows()).length).toBe(0);
    });
    it("denies protected session operations with an absolutely expired initiating session", async () => {
      await register();
      const a = await login();
      const b = await login();
      await pool.query('UPDATE "session" SET created_at=$1 WHERE id=$2', [
        new Date(Date.now() - 31 * day).toISOString(),
        a.row.id,
      ]);
      await post("/revoke-sessions", a.cookie).expect(401);
      expect(await authenticated(b.cookie)).toBe(true);
    });
    it("removes absolutely expired rows from the actor's session listing", async () => {
      await register();
      const a = await login();
      const b = await login();
      await pool.query('UPDATE "session" SET created_at=$1 WHERE id=$2', [
        new Date(Date.now() - 31 * day).toISOString(),
        b.row.id,
      ]);
      const response = await get("/list-sessions", a.cookie).expect(200);
      expect(response.body.map((value: { id: string }) => value.id)).toEqual([
        a.row.id,
      ]);
      expect((await rows()).map((row) => row.id)).toEqual([a.row.id]);
    });
    it("rejects and deletes an inactivity-expired session", async () => {
      await register();
      const a = await login();
      await pool.query('UPDATE "session" SET expires_at=$1 WHERE id=$2', [
        new Date(Date.now() - 1000).toISOString(),
        a.row.id,
      ]);
      expect(await authenticated(a.cookie)).toBe(false);
      expect((await rows()).length).toBe(0);
    });
    it("refreshes after the update threshold without changing creation time or bypassing absolute expiry", async () => {
      await register();
      const a = await login();
      const now = Date.now();
      const createdAt = new Date(now - 29 * day);
      await pool.query(
        'UPDATE "session" SET created_at=$1, updated_at=$2, expires_at=$3 WHERE id=$4',
        [
          createdAt.toISOString(),
          new Date(now - 2 * day).toISOString(),
          new Date(now + 5 * day).toISOString(),
          a.row.id,
        ],
      );
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      expect(await authenticated(a.cookie)).toBe(true);
      const refreshed = (await rows())[0]!;
      expect(refreshed.created_at.getTime()).toBe(createdAt.getTime());
      expect(refreshed.expires_at.getTime()).toBe(now + 7 * day);
      expect(refreshed.updated_at.getTime()).toBe(now);
      vi.setSystemTime(createdAt.getTime() + 30 * day);
      expect(await authenticated(a.cookie)).toBe(false);
      expect((await rows()).length).toBe(0);
    });
    it("does not refresh a newly created session before the update threshold", async () => {
      await register();
      const a = await login();
      expect(await authenticated(a.cookie)).toBe(true);
      expect((await rows())[0]!.expires_at.getTime()).toBe(
        a.row.expires_at.getTime(),
      );
    });
  });
}
