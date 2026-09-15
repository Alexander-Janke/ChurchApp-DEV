import { standardRoleId } from "../../src/authorization/standard-roles.js";
import {
  createTenantTestFixture,
  type TenantTestFixture,
} from "./tenant/database-fixture.js";
import { DatabaseService } from "../../src/database/database.service.js";
import { TenantContext } from "../../src/database/tenant-context.js";
import { OwnershipService } from "../../src/ownership/ownership.service.js";
import { symmetricEncrypt } from "better-auth/crypto";
import { AuthSessionReader } from "../../src/auth/auth-session-reader.js";
import request from "supertest";
import { Test } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AuthService } from "@thallesp/nestjs-better-auth";
import { randomUUID, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { twoFactor } from "better-auth/plugins";
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
import { DATABASE_POOL } from "../../src/database/database.constants.js";
import { AuthTransaction } from "../../src/auth/auth-transaction.js";
import { GooglePreAuth } from "../../src/auth/google-pre-auth.js";
import { challengeKey } from "../../src/auth/google-pre-auth-policy.js";
import * as applicationSchema from "../../src/database/schema/index.js";
import { TestAuthEmailSender } from "./auth-email.js";

type Target = ReturnType<typeof createBetterAuth>;
export function googleCompletionIntegrationTests() {
  describe("Google factor completion", () => {
    let name: string, f: TenantTestFixture;
    const origin = "http://localhost:3001",
      base = "/api/v1/auth";
    const secret = randomBytes(48).toString("hex"),
      sender = new TestAuthEmailSender();
    let pool: Pool,
      app: NestExpressApplication,
      auth: Target,
      created = false;
    let userId: string, providerId: string, providerEmail: string;
    let rawSeed: string;
    const recovery = "abcde-12345";
    beforeAll(async () => {
      f = await createTenantTestFixture({
        protectedTables: [
          "church",
          "church_membership",
          "church_role",
          "church_role_permission",
          "church_membership_role",
          "church_primary_owner",
          "church_ownership_audit",
          "church_admin_audit",
        ],
      });
      pool = f.fixturePool;
      name = f.databaseName;
      created = true;
      await pool.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON "user",account,session,verification,two_factor,two_factor_enrollment,session_assurance,email_change_request,user_profile TO "${f.roleName}"`,
      );
      await pool.query(
        `GRANT INSERT ON auth_security_event TO "${f.roleName}"`,
      );
      vi.stubEnv("BETTER_AUTH_SECRET", secret);
      vi.stubEnv("BETTER_AUTH_URL", origin);
      vi.stubEnv("GOOGLE_CLIENT_ID", "isolated-placeholder");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "isolated-placeholder");
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DATABASE_POOL)
        .useValue(f.concurrentPool)
        .overrideProvider(DatabaseService)
        .useValue(f.concurrentDb)
        .overrideProvider(AuthEmailSender)
        .useValue(sender)
        .compile();
      app = module.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      });
      configureApp(app);
      await app.init();
      auth = app.get<AuthService<Target>>(AuthService).instance;
    }, 30000);
    beforeEach(async () => {
      if (
        !created ||
        (await pool.query("select current_database() name")).rows[0].name !==
          name ||
        !name.startsWith("tenant_test_")
      )
        throw new Error("Disposable database boundary failed");
      await pool.query('TRUNCATE church, "user", verification CASCADE');
      rawSeed = randomBytes(16).toString("hex");
      userId = randomUUID();
      providerId = randomUUID();
      providerEmail = "linked@example.invalid";
      await pool.query(
        'INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at,two_factor_enabled) VALUES($1,$2,$3,true,now(),now(),true)',
        [userId, "Google fixture", providerEmail],
      );
      await pool.query(
        "INSERT INTO account(id,user_id,account_id,provider_id,created_at,updated_at) VALUES($1,$2,$3,$4,now(),now())",
        [randomUUID(), userId, providerId, "google"],
      );
      await pool.query(
        "INSERT INTO two_factor(id,user_id,secret,backup_codes,verified) VALUES($1,$2,$3,$4,true)",
        [
          randomUUID(),
          userId,
          await symmetricEncrypt({ key: secret, data: rawSeed }),
          await symmetricEncrypt({
            key: secret,
            data: JSON.stringify([recovery]),
          }),
        ],
      );
      await stubProvider(auth);
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });
    afterAll(async () => {
      try {
        await app?.close();
      } finally {
        await f?.dispose();
        vi.unstubAllEnvs();
      }
    });
    async function stubProvider(target: { $context: Target["$context"] }) {
      const ctx = await target.$context;
      const provider = ctx.socialProviders.find((p) => p.id === "google")!;
      vi.spyOn(provider, "validateAuthorizationCode").mockImplementation(
        async () => ({
          accessToken: "provider-fixture-not-a-real-token",
          scopes: ["openid", "email", "profile"],
        }),
      );
      vi.spyOn(provider, "getUserInfo").mockImplementation(async () => ({
        user: {
          name: "Google fixture",
          email: providerEmail,
          emailVerified: true,
        },
        data: { sub: providerId, email: providerEmail, email_verified: true },
      }));
      // No call to Google or any other external provider is allowed in this suite.
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("External network forbidden"),
      );
    }
    function cookies(r: Response) {
      return r.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
    }
    function token(r: Response) {
      const c = r.headers
        .getSetCookie()
        .find((c) => c.startsWith("better-auth.social_pre_auth="));
      return c?.split(";")[0]?.split("=")[1];
    }
    async function begin() {
      const r = await auth.api.signInSocial({
        headers: new Headers({ origin }),
        body: {},
        asResponse: true,
      });
      expect(r.status).toBe(200);
      const b = (await r.json()) as { url: string };
      const state = new URL(b.url).searchParams.get("state")!;
      return { state, cookie: cookies(r) };
    }
    function callback(start: { state: string; cookie: string }) {
      return auth.api.callbackOAuth({
        headers: new Headers({ origin, cookie: start.cookie }),
        body: { code: "isolated-authorization-code", state: start.state },
        asResponse: true,
      });
    }
    async function counts() {
      const r = await pool.query(
        "SELECT (SELECT count(*)::int FROM session) sessions,(SELECT count(*)::int FROM session_assurance) assurance,(SELECT count(*)::int FROM church) churches,(SELECT count(*)::int FROM church_membership) memberships,(SELECT count(*)::int FROM church_role) roles,(SELECT count(*)::int FROM church_primary_owner) owners",
      );
      return r.rows[0] as {
        sessions: number;
        assurance: number;
        churches: number;
        memberships: number;
        roles: number;
        owners: number;
      };
    }
    async function pending(t: unknown, owner = userId, now = Date.now()) {
      const transactions = new AuthTransaction(
        drizzle(pool, { schema: applicationSchema }),
      );
      return transactions.run((tx) =>
        new GooglePreAuth(transactions, () => now).pending(tx, t, owner),
      );
    }
    async function challenge() {
      const response = await callback(await begin());
      expect(response.status).toBe(200);
      return token(response)!;
    }
    async function totp() {
      return (
        await twoFactor().endpoints.generateTOTP({
          body: { secret: rawSeed },
          context: await auth.$context,
        })
      ).code;
    }
    function complete(
      raw: string,
      code: string,
      method = "totp",
      extra: Record<string, unknown> = {},
    ) {
      return auth.handler(
        new Request(
          origin +
            base +
            "/social/google/verify-" +
            (method === "totp" ? "totp" : "recovery-code"),
          {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: JSON.stringify({ challenge: raw, code, ...extra }),
          },
        ),
      );
    }
    async function eventCount() {
      return (
        await pool.query(
          "SELECT count(*)::int n FROM auth_security_event WHERE event_type='recovery_code_used' AND subject_user_id=$1",
          [userId],
        )
      ).rows[0].n;
    }
    async function failureEventCount(method = "totp") {
      return (
        await pool.query(
          "SELECT count(*)::int n FROM auth_security_event WHERE event_type='authentication_failure' AND subject_user_id=$1 AND metadata->>'method'=$2",
          [userId, method],
        )
      ).rows[0].n;
    }
    async function storedCodes() {
      return (
        await pool.query(
          "SELECT backup_codes FROM two_factor WHERE user_id=$1",
          [userId],
        )
      ).rows[0]?.backup_codes;
    }
    it.each(["totp", "recovery"])(
      "%s completion creates one ordinary cookie session, no assurance or tenant side effects",
      async (method) => {
        const raw = await challenge();
        await expect(
          app
            .get(AuthSessionReader)
            .resolve("better-auth.social_pre_auth=" + raw),
        ).rejects.toThrow();
        const response = await complete(
          raw,
          method === "totp" ? await totp() : recovery,
          method,
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: true });
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(
          (await app.get(AuthSessionReader).resolve(cookies(response)))
            .userId === userId,
        ).toBe(true);
        expect(await counts()).toEqual({
          sessions: 1,
          assurance: 0,
          churches: 0,
          memberships: 0,
          roles: 0,
          owners: 0,
        });
        expect(await eventCount()).toBe(method === "recovery" ? 1 : 0);
        const row = (
          await pool.query("SELECT created_at,expires_at FROM session")
        ).rows[0];
        expect(
          Math.abs(
            row.expires_at.getTime() - row.created_at.getTime() - 604800000,
          ),
        ).toBeLessThan(100);
        const replay = await complete(
          raw,
          method === "totp" ? await totp() : recovery,
          method,
        );
        expect(replay.status).toBe(401);
        expect((await counts()).sessions).toBe(1);
        expect(await eventCount()).toBe(method === "recovery" ? 1 : 0);
      },
    );
    it.each(["totp", "recovery"])(
      "concurrent %s completion has one winner, one session and at most one event",
      async (method) => {
        const raw = await challenge(),
          code = method === "totp" ? await totp() : recovery;
        const responses = await Promise.all([
          complete(raw, code, method),
          complete(raw, code, method),
        ]);
        expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
        expect((await counts()).sessions).toBe(1);
        expect(await eventCount()).toBe(method === "recovery" ? 1 : 0);
      },
    );
    it.each(["totp", "recovery"])(
      "invalid %s leaves challenge usable, persists native failure count and emits no success",
      async (method) => {
        const raw = await challenge();
        const valid = method === "totp" ? await totp() : recovery;
        const bad =
          method === "totp"
            ? valid === "000000"
              ? "111111"
              : "000000"
            : "zzzzz-99999";
        expect((await complete(raw, bad, method)).status).toBe(401);
        expect((await counts()).sessions).toBe(0);
        expect(await eventCount()).toBe(0);
        expect((await pending(raw)).userId === userId).toBe(true);
        expect(
          (await pool.query("SELECT failed_verification_count FROM two_factor"))
            .rows[0].failed_verification_count,
        ).toBe(1);
        expect((await complete(raw, valid, method)).status).toBe(200);
      },
    );
    it("recovery code cannot be reused on an independent Google challenge", async () => {
      expect(
        (await complete(await challenge(), recovery, "recovery")).status,
      ).toBe(200);
      expect(
        (await complete(await challenge(), recovery, "recovery")).status,
      ).toBe(401);
      expect((await counts()).sessions).toBe(1);
      expect(await eventCount()).toBe(1);
    });
    it("classifies five conclusive Google factor failures once without storing provider data", async () => {
      const raw = await challenge();
      const valid = await totp();
      const invalid = valid === "000000" ? "111111" : "000000";
      for (let attempt = 0; attempt < 5; attempt++)
        expect((await complete(raw, invalid)).status).toBe(401);
      expect(await failureEventCount()).toBe(1);
      const rows = await pool.query(
        "SELECT metadata FROM auth_security_event WHERE event_type='authentication_failure' AND subject_user_id=$1",
        [userId],
      );
      expect(rows.rows[0].metadata).toEqual({
        method: "totp",
        category: "repeated",
      });
      expect(JSON.stringify(rows.rows)).not.toContain(providerId);
      expect(JSON.stringify(rows.rows)).not.toContain(providerEmail);
    });
    it.each(["totp", "recovery"])(
      "session insertion failure rolls back %s proof, challenge and event",
      async (method) => {
        const raw = await challenge(),
          before = await storedCodes(),
          code = method === "totp" ? await totp() : recovery;
        // This pool is connected only to the newly created, guarded disposable DB.
        await pool.query(
          "CREATE FUNCTION reject_google_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-session-fixture'; END $$; CREATE TRIGGER reject_google_session BEFORE INSERT ON session FOR EACH ROW EXECUTE FUNCTION reject_google_session()",
        );
        try {
          const result = await complete(raw, code, method);
          expect(result.status).toBe(503);
          expect(
            (await result.text()).includes("private-session-fixture"),
          ).toBe(false);
          expect((await counts()).sessions).toBe(0);
          expect(await eventCount()).toBe(0);
          expect((await storedCodes()) === before).toBe(true);
          expect((await pending(raw)).userId === userId).toBe(true);
        } finally {
          await pool.query(
            "DROP TRIGGER reject_google_session ON session; DROP FUNCTION reject_google_session()",
          );
        }
        expect((await complete(raw, code, method)).status).toBe(200);
      },
    );
    it("mandatory recovery audit failure rolls back session, code and challenge", async () => {
      const raw = await challenge(),
        before = await storedCodes();
      await pool.query(
        "CREATE FUNCTION reject_google_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-audit-fixture'; END $$; CREATE TRIGGER reject_google_audit BEFORE INSERT ON auth_security_event FOR EACH ROW EXECUTE FUNCTION reject_google_audit()",
      );
      try {
        expect((await complete(raw, recovery, "recovery")).status).toBe(503);
        expect((await counts()).sessions).toBe(0);
        expect(await eventCount()).toBe(0);
        expect((await storedCodes()) === before).toBe(true);
        expect((await pending(raw)).userId === userId).toBe(true);
      } finally {
        await pool.query(
          "DROP TRIGGER reject_google_audit ON auth_security_event; DROP FUNCTION reject_google_audit()",
        );
      }
      expect((await complete(raw, recovery, "recovery")).status).toBe(200);
    });
    it.each([
      "expiry",
      "factor-disabled",
      "factor-replaced",
      "provider-changed",
      "provider-removed",
      "user-deleted",
    ])("%s makes completion fail closed", async (change) => {
      const raw = await challenge(),
        code = await totp();
      if (change === "expiry")
        await pool.query(
          "UPDATE verification SET expires_at=now() WHERE id=$1",
          [challengeKey(raw)],
        );
      if (change === "factor-disabled")
        await pool.query(
          'UPDATE "user" SET two_factor_enabled=false WHERE id=$1',
          [userId],
        );
      if (change === "factor-replaced")
        await pool.query(
          "UPDATE two_factor SET secret='changed' WHERE user_id=$1",
          [userId],
        );
      if (change === "provider-changed")
        await pool.query(
          "UPDATE account SET account_id='changed' WHERE user_id=$1",
          [userId],
        );
      if (change === "provider-removed")
        await pool.query("DELETE FROM account WHERE user_id=$1", [userId]);
      if (change === "user-deleted")
        await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
      expect((await complete(raw, code)).status).toBe(401);
      expect((await counts()).sessions).toBe(0);
      expect(await eventCount()).toBe(0);
    });
    it("expired TOTP is denied outside native window", async () => {
      const now = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now - 5 * 60000);
      const old = await totp();
      vi.setSystemTime(now);
      expect((await complete(await challenge(), old)).status).toBe(401);
      expect((await counts()).sessions).toBe(0);
    });
    it.each(["no-origin", "wrong-origin", "unknown-field", "malformed-totp"])(
      "HTTP rejects %s",
      async (kind) => {
        const raw = await challenge();
        const response = await auth.handler(
          new Request(origin + base + "/social/google/verify-totp", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(kind === "no-origin"
                ? {}
                : {
                    origin:
                      kind === "wrong-origin"
                        ? "https://untrusted.invalid"
                        : origin,
                  }),
            },
            body: JSON.stringify({
              challenge: raw,
              code: kind === "malformed-totp" ? "bad" : await totp(),
              ...(kind === "unknown-field" ? { userId } : {}),
            }),
          }),
        );
        expect(response.status).toBe(kind.includes("origin") ? 403 : 400);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect((await counts()).sessions).toBe(0);
      },
    );
    it.each([
      "sign-out",
      "revoke-sessions",
      "revoke-session",
      "revoke-other-sessions",
    ])("completed session uses canonical %s revocation", async (route) => {
      const first = await complete(await challenge(), await totp());
      const c = cookies(first),
        actor = await app.get(AuthSessionReader).resolve(c);
      let other: string | undefined;
      if (route === "revoke-other-sessions")
        other = cookies(await complete(await challenge(), await totp()));
      const response = await auth.handler(
        new Request(origin + base + "/" + route, {
          method: "POST",
          headers: { origin, cookie: c, "content-type": "application/json" },
          body: JSON.stringify(
            route === "revoke-session" ? { sessionId: actor.sessionId } : {},
          ),
        }),
      );
      expect(response.status).toBe(200);
      if (other) {
        await expect(
          app.get(AuthSessionReader).resolve(other),
        ).rejects.toThrow();
        expect(
          (await app.get(AuthSessionReader).resolve(c)).userId === userId,
        ).toBe(true);
      } else
        await expect(app.get(AuthSessionReader).resolve(c)).rejects.toThrow();
    });
    it("cross-user TOTP/recovery and target injection never authenticate", async () => {
      const raw = await challenge(),
        originalSeed = rawSeed;
      rawSeed = randomBytes(16).toString("hex");
      const foreignCode = await totp();
      rawSeed = originalSeed;
      expect((await complete(raw, foreignCode)).status).toBe(401);
      expect((await complete(raw, "other-54321", "recovery")).status).toBe(401);
      expect(
        (await complete(raw, await totp(), "totp", { userId: randomUUID() }))
          .status,
      ).toBe(400);
      await expect(pending(raw, randomUUID())).rejects.toThrow();
      expect((await counts()).sessions).toBe(0);
      expect(await eventCount()).toBe(0);
    });
    it("unresolved pre-auth denies profile/onboarding/tenant/admin; completion permits own profile", async () => {
      const raw = await challenge();
      for (const [method, path] of [
        ["get", "/api/v1/profile/me"],
        ["post", "/api/v1/churches"],
        ["get", `/api/v1/churches/${randomUUID()}/members`],
        ["patch", `/api/v1/churches/${randomUUID()}/settings`],
      ] as const) {
        const denied = await request(app.getHttpServer())
          [method](path)
          .set("Cookie", "better-auth.social_pre_auth=" + raw)
          .set("Origin", origin)
          .send({});
        expect(denied.status).toBe(401);
      }
      const done = await complete(raw, await totp());
      expect(
        (
          await request(app.getHttpServer())
            .get("/api/v1/profile/me")
            .set("Cookie", cookies(done))
        ).status,
      ).toBe(200);
    });
    it("expiry equality and challenge expiry after waiting on user lock deny completion", async () => {
      const raw = await challenge(),
        code = await totp();
      const blocker = await pool.connect();
      await blocker.query("BEGIN");
      try {
        await blocker.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [
          userId,
        ]);
        const result = complete(raw, code);
        await waitForLock();
        const now = Date.now();
        await blocker.query(
          "UPDATE verification SET expires_at=$2 WHERE id=$1",
          [challengeKey(raw), new Date(now).toISOString()],
        );
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(now);
        expect(
          Number(
            (
              await blocker.query(
                "SELECT extract(epoch FROM expires_at AT TIME ZONE 'UTC')*1000 expiry FROM verification WHERE id=$1",
                [challengeKey(raw)],
              )
            ).rows[0].expiry,
          ),
        ).toBe(now);
        await blocker.query("COMMIT");
        expect((await result).status).toBe(401);
        expect((await counts()).sessions).toBe(0);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
    });
    async function waitForLock() {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const row = await pool.query(
          "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
        );
        if (row.rows[0].n > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Expected completion lock wait");
    }
    it.each([
      "factor-disabled",
      "factor-replaced",
      "provider-changed",
      "provider-removed",
      "user-deleted",
    ])(
      "waiting completion rechecks %s after concurrent commit",
      async (change) => {
        const raw = await challenge(),
          code = await totp(),
          blocker = await pool.connect();
        await blocker.query("BEGIN");
        try {
          await blocker.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [
            userId,
          ]);
          const result = complete(raw, code);
          await waitForLock();
          if (change === "factor-disabled")
            await blocker.query(
              'UPDATE "user" SET two_factor_enabled=false WHERE id=$1',
              [userId],
            );
          if (change === "factor-replaced")
            await blocker.query(
              "UPDATE two_factor SET secret='changed' WHERE user_id=$1",
              [userId],
            );
          if (change === "provider-changed")
            await blocker.query(
              "UPDATE account SET account_id='changed' WHERE user_id=$1",
              [userId],
            );
          if (change === "provider-removed")
            await blocker.query("DELETE FROM account WHERE user_id=$1", [
              userId,
            ]);
          if (change === "user-deleted")
            await blocker.query('DELETE FROM "user" WHERE id=$1', [userId]);
          await blocker.query("COMMIT");
          expect((await result).status).toBe(401);
          expect((await counts()).sessions).toBe(0);
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
        }
      },
    );
    it("native source throttling returns no-store through the mounted completion API", async () => {
      const ctx = await auth.$context;
      const previous = ctx.rateLimit.enabled;
      ctx.rateLimit.enabled = true;
      try {
        for (let i = 0; i < 6; i++) {
          const response = await request(app.getHttpServer())
            .post(base + "/social/google/verify-totp")
            .set("Origin", origin)
            .set("X-Forwarded-For", "192.0.2.217")
            .send({
              challenge: randomBytes(32).toString("hex"),
              code: "123456",
            });
          expect(response.status).toBe(i < 5 ? 401 : 429);
          expect(response.headers["cache-control"]).toBe("no-store");
        }
        expect((await counts()).sessions).toBe(0);
      } finally {
        ctx.rateLimit.enabled = previous;
      }
    });
    it("five failed proofs exhaust the shared native challenge budget without false success or rearming", async () => {
      const raw = await challenge(),
        good = await totp(),
        bad = good === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++)
        expect((await complete(raw, bad)).status).toBe(401);
      expect((await complete(raw, good)).status).toBe(429);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 61000);
      expect((await complete(raw, await totp())).status).toBe(429);
      expect((await complete(raw, await totp())).status).toBe(401);
      expect((await counts()).sessions).toBe(0);
    });
    it("native account lockout persists across independent social challenges and expires natively", async () => {
      for (let c = 0; c < 2; c++) {
        const raw = await challenge(),
          good = await totp(),
          bad = good === "000000" ? "111111" : "000000";
        for (let i = 0; i < 5; i++)
          expect((await complete(raw, bad)).status).toBe(401);
      }
      expect((await complete(await challenge(), await totp())).status).toBe(
        429,
      );
      const row = (
        await pool.query(
          "SELECT failed_verification_count, extract(epoch FROM locked_until AT TIME ZONE 'UTC')*1000 locked_epoch FROM two_factor",
        )
      ).rows[0];
      expect(row.failed_verification_count).toBe(10);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Number(row.locked_epoch) + 1);
      expect((await complete(await challenge(), await totp())).status).toBe(
        200,
      );
      expect(
        (await pool.query("SELECT failed_verification_count FROM two_factor"))
          .rows[0].failed_verification_count,
      ).toBe(0);
    });
    it("another session's elevation cannot transfer; admin and owner transfer require their explicit proofs", async () => {
      const first = cookies(await complete(await challenge(), await totp()));
      expect(
        (
          await auth.api.completeTotpElevation({
            headers: new Headers({ origin, cookie: first }),
            body: { code: await totp() },
            asResponse: true,
          })
        ).status,
      ).toBe(200);
      const second = cookies(await complete(await challenge(), await totp()));
      const current = await app.get(AuthSessionReader).resolve(second);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM session_assurance WHERE session_id=$1",
            [current.sessionId],
          )
        ).rows[0].n,
      ).toBe(0);
      const onboard = await request(app.getHttpServer())
        .post("/api/v1/churches")
        .set("Cookie", second)
        .set("Origin", origin)
        .send({ name: "Google Owner", slug: "google-owner" });
      expect(onboard.status).toBe(201);
      const churchId = onboard.body.church.id,
        membershipId = onboard.body.membership.id;
      await pool.query(
        "INSERT INTO church_membership_role(church_id,membership_id,role_id) SELECT $1,$2,id FROM church_role WHERE church_id=$1 AND id=$3",
        [
          churchId,
          membershipId,
          standardRoleId(
            TenantContext.fromAuthorizedScope(churchId),
            "main_church_administrator",
          ),
        ],
      );
      const members = () =>
        request(app.getHttpServer())
          .get(`/api/v1/churches/${churchId}/members`)
          .set("Cookie", second);
      expect((await members()).status).toBe(403);
      const scope = TenantContext.fromAuthorizedScope(churchId);
      const subject = { userId: current.userId, sessionId: current.sessionId };
      const ownership = app.get(OwnershipService);
      expect(
        await ownership.transferPrimaryOwner(scope, subject, membershipId),
      ).toBe("denied");
      expect(
        (
          await auth.api.completeTotpElevation({
            headers: new Headers({ origin, cookie: second }),
            body: { code: await totp() },
            asResponse: true,
          })
        ).status,
      ).toBe(200);
      expect((await members()).status).toBe(200);
      expect(
        await ownership.transferPrimaryOwner(scope, subject, membershipId),
      ).toBe("denied");
      expect(
        (
          await auth.api.completeTotpStepUp({
            headers: new Headers({ origin, cookie: second }),
            body: { code: await totp() },
            asResponse: true,
          })
        ).status,
      ).toBe(200);
      expect(
        await ownership.transferPrimaryOwner(scope, subject, membershipId),
      ).toBe("unchanged");
    });
    it("completion responses and logs contain no factor, provider or session internals", async () => {
      const entries: unknown[] = [];
      for (const level of ["log", "warn", "error", "debug", "verbose"] as const)
        vi.spyOn(Logger.prototype, level).mockImplementation(
          (...args: unknown[]) => {
            entries.push(args);
          },
        );
      const raw = await challenge();
      const response = await complete(raw, recovery, "recovery");
      expect(response.status).toBe(200);
      const body = await response.text(),
        logs = JSON.stringify(entries);
      for (const value of [
        raw,
        rawSeed,
        secret,
        recovery,
        "provider-fixture-not-a-real-token",
      ])
        expect(body.includes(value) || logs.includes(value)).toBe(false);
      expect(
        response.headers
          .getSetCookie()
          .filter((c) => c.includes("two_factor=")),
      ).toHaveLength(0);
      expect(body).toBe(JSON.stringify({ status: true }));
    });
    it("browser completes using HttpOnly pre-auth cookie without exposing it to JavaScript", async () => {
      const raw = await challenge();
      const response = await request(app.getHttpServer())
        .post(base + "/social/google/verify-totp")
        .set("Origin", origin)
        .set("Cookie", "better-auth.social_pre_auth=" + raw)
        .send({ code: await totp() });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: true });
      expect(response.headers["cache-control"]).toBe("no-store");
    });
    it("independent concurrent recovery challenges still consume the shared code and audit once", async () => {
      const a = await challenge(),
        b = await challenge();
      const results = await Promise.all([
        complete(a, recovery, "recovery"),
        complete(b, recovery, "recovery"),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
      expect((await counts()).sessions).toBe(1);
      expect(await eventCount()).toBe(1);
    });
  });
}
