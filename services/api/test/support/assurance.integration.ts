import "reflect-metadata";
import request from "supertest";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AuthService } from "@thallesp/nestjs-better-auth";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { AuthEmailSender } from "../../src/auth/auth-email.js";
import type { createBetterAuth } from "../../src/auth/auth.config.js";
import {
  AssurancePolicy,
  ELEVATION_IDLE_MS,
  ELEVATION_MAX_MS,
  STEP_UP_MAX_MS,
} from "../../src/auth/assurance-policy.js";
import {
  SessionAssuranceService,
  type SessionSubject,
} from "../../src/auth/session-assurance.service.js";
import { DatabaseService } from "../../src/database/database.service.js";
import { DATABASE_POOL } from "../../src/database/database.constants.js";
import { getDatabaseUrl } from "../../src/database/database.config.js";
import { session, user } from "../../src/database/schema/auth.js";
import { sessionAssurance } from "../../src/database/schema/session-assurance.js";
import { TestAuthEmailSender } from "./auth-email.js";

// ONLY test fixtures may issue assurance. No production module imports this file.
export async function issueTestAssurance(
  pool: Pool,
  sessionId: string,
  now = new Date(),
) {
  await pool.query(
    "insert into session_assurance(session_id,elevated_at,last_elevated_activity_at,step_up_at,created_at,updated_at) values($1,$2,$2,$2,$2,$2)",
    [sessionId, now],
  );
}

export function assuranceIntegrationTests() {
  describe("session assurance in disposable PostgreSQL", () => {
    const name = "assurance_test_" + randomUUID().replaceAll("-", "");
    const origin = "http://localhost:3001",
      base = "/api/v1/auth";
    const folder = fileURLToPath(new URL("../../migrations", import.meta.url));
    const sender = new TestAuthEmailSender();
    const password = "assurance-test-only credential password";
    const a: SessionSubject = { userId: randomUUID(), sessionId: randomUUID() },
      b = { userId: a.userId, sessionId: randomUUID() },
      other = { userId: randomUUID(), sessionId: randomUUID() };
    let maintenance: Pool,
      pool: Pool,
      db: DatabaseService,
      app: NestExpressApplication;
    let service: SessionAssuranceService,
      auth: ReturnType<typeof createBetterAuth>,
      created = false;
    let now = 0;
    beforeAll(async () => {
      const url = new URL(getDatabaseUrl());
      maintenance = new Pool({ connectionString: url.toString() });
      await maintenance.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
      created = true;
      url.pathname = "/" + name;
      pool = new Pool({ connectionString: url.toString(), max: 5 });
      await migrate(drizzle(pool), { migrationsFolder: folder });
      vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("hex"));
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
      db = app.get(DatabaseService);
      service = new SessionAssuranceService(db, new AssurancePolicy(() => now));
      auth =
        app.get<AuthService<ReturnType<typeof createBetterAuth>>>(
          AuthService,
        ).instance;
    }, 30000);
    beforeEach(async () => {
      sender.reset();
      await pool.query('TRUNCATE "user" CASCADE');
      now = Date.now();
      await db.db.insert(user).values([
        {
          id: a.userId,
          name: "Fixture A",
          email: "a@example.invalid",
          emailVerified: true,
        },
        {
          id: other.userId,
          name: "Fixture B",
          email: "b@example.invalid",
          emailVerified: true,
        },
      ]);
      for (const s of [a, b, other])
        await db.db.insert(session).values({
          id: s.sessionId,
          userId: s.userId,
          token: randomBytes(32).toString("hex"),
          createdAt: new Date(now - 86400000),
          updatedAt: new Date(now),
          expiresAt: new Date(now + 7 * 86400000),
        });
    });
    afterEach(async () => {
      await sender.onModuleDestroy();
      sender.reset();
      vi.restoreAllMocks();
    });
    afterAll(async () => {
      try {
        if (app) await app.close();
        else await pool?.end();
      } finally {
        try {
          if (created) await maintenance.query(`DROP DATABASE "${name}"`);
        } finally {
          await maintenance?.end();
          vi.unstubAllEnvs();
        }
      }
    });
    const issue = (s = a) =>
      issueTestAssurance(pool, s.sessionId, new Date(now));
    async function state(s = a) {
      return (
        await db.db
          .select()
          .from(sessionAssurance)
          .where(eq(sessionAssurance.sessionId, s.sessionId))
      )[0];
    }
    const status = (s = a) => service.evaluate(s);
    async function post(
      path: string,
      body: Record<string, unknown> = {},
      cookie = "",
    ) {
      return auth.handler(
        new Request(origin + base + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    }
    function cookie(res: Response) {
      return res.headers
        .getSetCookie()
        .filter(
          (c) =>
            c.split("=")[0]!.includes("session_token") &&
            !c.includes("Max-Age=0"),
        )
        .map((c) => c.split(";")[0])
        .join("; ");
    }
    async function current(c: string) {
      const res = await auth.handler(
        new Request(origin + base + "/get-session", { headers: { cookie: c } }),
      );
      expect(res.status).toBe(200);
      return res.json();
    }
    async function login(email: string) {
      const res = await post("/sign-in/email", { email, password });
      expect(res.status).toBe(200);
      const c = cookie(res);
      expect(Boolean(c)).toBe(true);
      const data = await current(c);
      return {
        cookie: c,
        subject: {
          userId: data.user.id as string,
          sessionId: data.session.id as string,
        },
      };
    }
    async function register() {
      const email = "http@example.invalid";
      const res = await post("/sign-up/email", {
        name: "HTTP fixture",
        email,
        password,
      });
      expect(res.status).toBe(200);
      const verify = await auth.handler(
        new Request(sender.messages.at(-1)!.url),
      );
      expect([200, 302]).toContain(verify.status);
      return login(email);
    }
    async function count(userId: string) {
      return (
        await pool.query(
          "select count(*)::int n from session_assurance a join session s on s.id=a.session_id where s.user_id=$1",
          [userId],
        )
      ).rows[0].n as number;
    }

    it("migrates through 0008 and repeat migration preserves data and history", async () => {
      await issue();
      const before = await state();
      const journal = await pool.query(
        "select hash from drizzle.__drizzle_migrations order by id",
      );
      expect(journal.rows).toHaveLength(9);
      await migrate(drizzle(pool), { migrationsFolder: folder });
      expect(
        (
          await pool.query(
            "select hash from drizzle.__drizzle_migrations order by id",
          )
        ).rows,
      ).toEqual(journal.rows);
      expect(await state()).toEqual(before);
    });
    it("enforces one row per concrete existing session and does not duplicate user ownership", async () => {
      await issue();
      await expect(issue()).rejects.toThrow();
      await expect(issueTestAssurance(pool, "missing")).rejects.toThrow();
      expect(
        (
          await pool.query(
            "select column_name from information_schema.columns where table_name='session_assurance'",
          )
        ).rows.map((r) => r.column_name),
      ).not.toContain("user_id");
    });
    it("normal session and another session of the same user inherit no assurance", async () => {
      expect(await status()).toEqual({
        authenticated: true,
        elevated: false,
        recentStepUp: false,
      });
      await issue();
      expect((await status()).elevated).toBe(true);
      expect((await status(b)).elevated).toBe(false);
    });
    it("cross-user session selection and invalidation cannot use another user's assurance", async () => {
      await issue();
      expect(
        (await status({ userId: other.userId, sessionId: a.sessionId }))
          .authenticated,
      ).toBe(false);
      await service.invalidateSession({
        userId: other.userId,
        sessionId: a.sessionId,
      });
      expect((await status()).elevated).toBe(true);
      expect(
        await service.recordSuccessfulPrivilegedActivity({
          userId: other.userId,
          sessionId: a.sessionId,
        }),
      ).toBe(false);
    });
    it("session revocation cascades and cannot be revived by activity", async () => {
      await issue();
      await db.db.delete(session).where(eq(session.id, a.sessionId));
      expect(await state()).toBeUndefined();
      expect((await status()).authenticated).toBe(false);
      expect(await service.recordSuccessfulPrivilegedActivity(a)).toBe(false);
    });
    it.each(["rolling", "absolute"])(
      "%s session expiry defeats stored assurance",
      async (kind) => {
        await issue();
        await db.db
          .update(session)
          .set(
            kind === "rolling"
              ? { expiresAt: new Date(now) }
              : { createdAt: new Date(now - 30 * 86400000) },
          )
          .where(eq(session.id, a.sessionId));
        expect(await status()).toEqual({
          authenticated: false,
          elevated: false,
          recentStepUp: false,
        });
        expect(await service.recordSuccessfulPrivilegedActivity(a)).toBe(false);
      },
    );
    it.each([-1, 0, 1])("DB fifteen-minute boundary %i", async (offset) => {
      await issue();
      now += ELEVATION_IDLE_MS + offset;
      expect((await status()).elevated).toBe(offset < 0);
    });
    it.each([-1, 0, 1])(
      "DB eight-hour boundary despite recent activity %i",
      async (offset) => {
        await issue();
        await db.db
          .update(sessionAssurance)
          .set({
            lastElevatedActivityAt: new Date(now + ELEVATION_MAX_MS - 1000),
          })
          .where(eq(sessionAssurance.sessionId, a.sessionId));
        now += ELEVATION_MAX_MS + offset;
        expect((await status()).elevated).toBe(offset < 0);
      },
    );
    it.each([-1, 0, 1])(
      "DB five-minute step-up boundary %i",
      async (offset) => {
        await issue();
        now += STEP_UP_MAX_MS + offset;
        expect((await status()).recentStepUp).toBe(offset < 0);
      },
    );
    it("activity updates only activity/audit time, not elevation, step-up or original session", async () => {
      await issue();
      const before = await state();
      const [original] = await db.db
        .select({ createdAt: session.createdAt })
        .from(session)
        .where(eq(session.id, a.sessionId));
      now += 600000;
      expect(await service.recordSuccessfulPrivilegedActivity(a)).toBe(true);
      const after = await state();
      expect(after?.elevatedAt).toEqual(before?.elevatedAt);
      expect(after?.stepUpAt).toEqual(before?.stepUpAt);
      expect(after?.createdAt).toEqual(before?.createdAt);
      expect(after?.lastElevatedActivityAt?.getTime()).toBe(now);
      expect(
        (
          await db.db
            .select({ createdAt: session.createdAt })
            .from(session)
            .where(eq(session.id, a.sessionId))
        )[0],
      ).toEqual(original);
      expect(await status()).toEqual({
        authenticated: true,
        elevated: true,
        recentStepUp: false,
      });
    });
    it("fresh step-up cannot revive expired elevation", async () => {
      await issue();
      now += ELEVATION_IDLE_MS;
      await db.db
        .update(sessionAssurance)
        .set({ stepUpAt: new Date(now) })
        .where(eq(sessionAssurance.sessionId, a.sessionId));
      expect(await status()).toEqual({
        authenticated: true,
        elevated: false,
        recentStepUp: true,
      });
      expect(await service.recordSuccessfulPrivilegedActivity(a)).toBe(false);
    });
    it("concurrent refresh is monotonic and cannot move elevation start", async () => {
      await issue();
      const original = await state();
      now += 1000;
      expect(
        await Promise.all([
          service.recordSuccessfulPrivilegedActivity(a),
          service.recordSuccessfulPrivilegedActivity(a),
        ]),
      ).toEqual([true, true]);
      expect((await state())?.elevatedAt).toEqual(original?.elevatedAt);
      expect((await state())?.lastElevatedActivityAt?.getTime()).toBe(now);
      now -= 1;
      expect(await service.recordSuccessfulPrivilegedActivity(a)).toBe(false);
      expect((await state())?.lastElevatedActivityAt?.getTime()).toBe(now + 1);
    });
    it("concurrent invalidation wins over refresh and later refresh cannot resurrect", async () => {
      await issue();
      now += 1000;
      await Promise.all([
        service.recordSuccessfulPrivilegedActivity(a),
        service.invalidateSession(a),
      ]);
      expect(await state()).toBeUndefined();
      expect(await service.recordSuccessfulPrivilegedActivity(a)).toBe(false);
      expect((await status()).elevated).toBe(false);
    });
    it("refresh waiting behind invalidation sees deletion, never upserts", async () => {
      await issue();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "delete from session_assurance where session_id=$1",
          [a.sessionId],
        );
        const pending = service.recordSuccessfulPrivilegedActivity(a);
        await client.query("COMMIT");
        expect(await pending).toBe(false);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      expect(await state()).toBeUndefined();
    });
    it("all-user invalidation removes own states only", async () => {
      for (const s of [a, b, other]) await issue(s);
      await service.invalidateUser(a.userId);
      expect(await count(a.userId)).toBe(0);
      expect((await status(other)).elevated).toBe(true);
    });
    it("polling session/profile reads does not slide assurance", async () => {
      const c = await register();
      now = Date.now();
      await issue(c.subject);
      const before = await state(c.subject);
      await current(c.cookie);
      await request(app.getHttpServer())
        .get("/api/v1/profile/me")
        .set("Cookie", c.cookie)
        .expect(200);
      await current(c.cookie);
      expect(await state(c.subject)).toEqual(before);
    });
    it("HTTP logout deletes assurance and the old cookie cannot authenticate", async () => {
      const c = await register();
      await issueTestAssurance(pool, c.subject.sessionId);
      expect((await post("/sign-out", {}, c.cookie)).status).toBe(200);
      expect(await count(c.subject.userId)).toBe(0);
      expect(await current(c.cookie)).toBeNull();
    });
    it("password reset removes all own assurance without affecting another user", async () => {
      const c = await register(),
        second = await login("http@example.invalid");
      for (const s of [c.subject, second.subject, other])
        await issueTestAssurance(pool, s.sessionId);
      expect(
        (
          await post("/request-password-reset", {
            email: "http@example.invalid",
            redirectTo: origin,
          })
        ).status,
      ).toBe(200);
      await sender.onModuleDestroy();
      expect(
        (
          await post("/reset-password", {
            token: sender.passwordResets.at(-1)!.token,
            newPassword: "assurance-only changed password",
          })
        ).status,
      ).toBe(200);
      expect(await count(c.subject.userId)).toBe(0);
      expect(await state(other)).toBeDefined();
      expect(await current(c.cookie)).toBeNull();
    });
    it("password change preserves current proof timestamps without issuing fresh assurance", async () => {
      const c = await register(),
        second = await login("http@example.invalid");
      await issueTestAssurance(pool, c.subject.sessionId);
      await issueTestAssurance(pool, second.subject.sessionId);
      const before = await state(c.subject);
      expect(
        (
          await post(
            "/change-password",
            {
              currentPassword: password,
              newPassword: "assurance-only changed password",
            },
            c.cookie,
          )
        ).status,
      ).toBe(200);
      expect(await state(c.subject)).toEqual(before);
      expect(await state(second.subject)).toBeUndefined();
      expect(await count(c.subject.userId)).toBe(1);
    });
    it("email change preserves retained session proof timestamps without auto-login or new proof", async () => {
      const c = await register(),
        second = await login("http@example.invalid");
      await issueTestAssurance(pool, c.subject.sessionId);
      await issueTestAssurance(pool, second.subject.sessionId);
      const before = await state(c.subject);
      expect(
        (
          await post(
            "/email-change/request",
            { newEmail: "new-http@example.invalid" },
            c.cookie,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await post("/email-change/approve-current", {
            token: sender.emailChangeApprovals.at(-1)!.token,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await post("/email-change/verify-new", {
            token: sender.emailChangeVerifications.at(-1)!.token,
          })
        ).status,
      ).toBe(200);
      expect(await state(c.subject)).toEqual(before);
      expect(await state(second.subject)).toBeUndefined();
      expect((await current(c.cookie)).user.id).toBe(c.subject.userId);
    });
    it("factor disable invalidates every own assurance before rotation, retaining original absolute start", async () => {
      const c = await register(),
        second = await login("http@example.invalid");
      expect(
        (await post("/two-factor/enable", { password }, c.cookie)).status,
      ).toBe(200);
      for (const s of [c.subject, second.subject, other])
        await issueTestAssurance(pool, s.sessionId);
      const [before] = await db.db
        .select({ createdAt: session.createdAt })
        .from(session)
        .where(eq(session.id, c.subject.sessionId));
      const res = await post("/two-factor/disable", { password }, c.cookie);
      expect(res.status).toBe(200);
      expect(await count(c.subject.userId)).toBe(0);
      expect(await state(other)).toBeDefined();
      const replacement = await current(cookie(res));
      expect(replacement.session.id).not.toBe(c.subject.sessionId);
      expect(new Date(replacement.session.createdAt)).toEqual(
        before?.createdAt,
      );
      expect(await current(c.cookie)).toBeNull();
      expect(
        (
          await service.evaluate({
            userId: c.subject.userId,
            sessionId: replacement.session.id,
          })
        ).elevated,
      ).toBe(false);
    });
    it("failed factor password leaves existing assurance unchanged", async () => {
      const c = await register();
      await issueTestAssurance(pool, c.subject.sessionId);
      const before = await state(c.subject);
      expect(
        (await post("/two-factor/disable", { password: "incorrect" }, c.cookie))
          .status,
      ).toBe(400);
      expect(await state(c.subject)).toEqual(before);
    });
    it("invalidation database failure stops factor removal and reports sanitized failure", async () => {
      const c = await register();
      expect(
        (await post("/two-factor/enable", { password }, c.cookie)).status,
      ).toBe(200);
      await issueTestAssurance(pool, c.subject.sessionId);
      // A disposable trigger proves failure at the real persistence boundary.
      await pool.query(
        "CREATE FUNCTION reject_assurance_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture-private-detail'; END $$; CREATE TRIGGER reject_assurance_delete BEFORE DELETE ON session_assurance FOR EACH ROW EXECUTE FUNCTION reject_assurance_delete()",
      );
      try {
        const res = await post("/two-factor/disable", { password }, c.cookie);
        expect(res.status).toBe(503);
        expect(
          JSON.stringify(await res.json()).includes("fixture-private-detail"),
        ).toBe(false);
        expect(
          (
            await pool.query(
              "select count(*)::int n from two_factor where user_id=$1",
              [c.subject.userId],
            )
          ).rows[0].n,
        ).toBe(1);
        expect(await state(c.subject)).toBeDefined();
      } finally {
        await pool.query(
          "DROP TRIGGER reject_assurance_delete ON session_assurance; DROP FUNCTION reject_assurance_delete()",
        );
      }
    });
    it("pending enrollment cannot regenerate backup codes or manufacture assurance", async () => {
      const c = await register();
      expect(
        (await post("/two-factor/enable", { password }, c.cookie)).status,
      ).toBe(200);
      expect(
        (
          await post(
            "/two-factor/generate-backup-codes",
            { password },
            c.cookie,
          )
        ).status,
      ).toBe(400);
      expect(await count(c.subject.userId)).toBe(0);
    });
    it.each(["mfa", "elevated", "stepUpAt", "assuranceLevel"])(
      "client %s cannot issue assurance through sign-in or factor preparation",
      async (field) => {
        const c = await register();
        expect(
          (
            await post("/sign-in/email", {
              email: "http@example.invalid",
              password,
              [field]: true,
            })
          ).status,
        ).toBe(400);
        expect(
          (
            await post(
              "/two-factor/enable",
              { password, [field]: true },
              c.cookie,
            )
          ).status,
        ).toBe(400);
        expect(await count(c.subject.userId)).toBe(0);
      },
    );
    it("no public assurance issuer exists and login verifier rejects an active session", async () => {
      const c = await register();
      for (const path of ["/elevate", "/assurance/complete", "/step-up"])
        expect((await post(path, { elevated: true }, c.cookie)).status).toBe(
          404,
        );
      expect(
        (await post("/two-factor/verify-totp", { code: "000000" }, c.cookie))
          .status,
      ).toBe(409);
      expect(await count(c.subject.userId)).toBe(0);
    });
    it("service errors do not contain database or session secrets", async () => {
      const broken = vi.spyOn(db.db, "select").mockImplementationOnce(() => {
        throw new Error("private-session-material");
      });
      await expect(service.evaluate(a)).rejects.toThrow(
        /^Assurance evaluation failed$/,
      );
      broken.mockRestore();
    });
  });
}
