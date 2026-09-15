import request from "supertest";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AuthService } from "@thallesp/nestjs-better-auth";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { symmetricDecrypt } from "better-auth/crypto";
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
import * as schema from "../../src/database/schema/auth.js";
import { TestAuthEmailSender } from "./auth-email.js";

type FactorRow = {
  id: string;
  secret: string;
  backup_codes: string;
  verified: boolean;
  user_id: string;
};
type Material = {
  totpURI: string;
  backupCodes: string[];
  enrollmentId: string;
};
// Native verification exists ONLY in this disposable security harness. It is not
// an override/export of the application gate and cannot configure a running app.
export function factorLoginIntegrationTests() {
  describe("production factor login and assurance", () => {
    const name = `auth_factor_login_test_${randomUUID().replaceAll("-", "")}`;
    const origin = "http://localhost:3001";
    const base = "/api/v1/auth";
    const secret = randomBytes(48).toString("hex");
    const password = "factor-test-only credential password";
    const email = "factor@example.invalid";
    const sender = new TestAuthEmailSender();
    const folder = fileURLToPath(new URL("../../migrations", import.meta.url));
    let maintenance: Pool, pool: Pool, app: NestExpressApplication;
    let auth: ReturnType<typeof createBetterAuth>;
    let native: ReturnType<typeof nativeProbe>;
    let created = false,
      id: string,
      cookie: string;
    function nativeProbe() {
      return betterAuth({
        baseURL: origin,
        basePath: base,
        secret,
        database: drizzleAdapter(drizzle(pool, { schema }), {
          provider: "pg",
          schema,
        }),
        emailAndPassword: { enabled: true },
        plugins: [twoFactor({ issuer: "Church Platform" })],
        // Probe concurrency, not IP throttling; the application defaults are unchanged.
        rateLimit: { enabled: false },
        logger: { disabled: true },
      });
    }
    beforeAll(async () => {
      const url = new URL(getDatabaseUrl());
      maintenance = new Pool({ connectionString: url.toString() });
      await maintenance.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
      created = true;
      url.pathname = `/${name}`;
      pool = new Pool({ connectionString: url.toString() });
      await migrate(drizzle(pool), { migrationsFolder: folder });
      vi.stubEnv("BETTER_AUTH_SECRET", secret);
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
      native = nativeProbe();
    }, 30_000);
    beforeEach(async () => {
      sender.reset();
      await pool.query('TRUNCATE "user" CASCADE');
      id = await register(email);
      cookie = await login(email);
    });
    afterEach(async () => {
      await sender.onModuleDestroy();
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
          if (created) await maintenance.query(`DROP DATABASE "${name}"`);
        } finally {
          await maintenance?.end();
          vi.unstubAllEnvs();
        }
      }
    });
    function cookies(res: Response, fragment = "session_token") {
      return res.headers
        .getSetCookie()
        .filter(
          (c) =>
            c.split("=")[0]!.includes(fragment) && !c.includes("Max-Age=0"),
        )
        .map((c) => c.split(";")[0])
        .join("; ");
    }
    function post(
      path: string,
      body: Record<string, unknown>,
      credential = "",
      target: { handler: (r: Request) => Promise<Response> } = auth,
      requestOrigin = origin,
    ) {
      return target.handler(
        new Request(origin + base + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: requestOrigin,
            ...(credential ? { cookie: credential } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    }
    async function current(credential: string) {
      const res = await auth.handler(
        new Request(origin + base + "/get-session", {
          headers: { cookie: credential },
        }),
      );
      expect(res.status).toBe(200);
      return res.json();
    }
    async function register(address: string) {
      const res = await post("/sign-up/email", {
        name: "Factor fixture",
        email: address,
        password,
      });
      expect(res.status).toBe(200);
      const userId = (await res.json()).user.id as string;
      const verify = await auth.handler(
        new Request(sender.messages.at(-1)!.url),
      );
      expect([200, 302]).toContain(verify.status);
      return userId;
    }
    async function login(address: string, credential = password) {
      const res = await post("/sign-in/email", {
        email: address,
        password: credential,
      });
      expect(res.status).toBe(200);
      const value = cookies(res);
      expect(Boolean(value)).toBe(true);
      return value;
    }
    async function rows(userId = id): Promise<FactorRow[]> {
      return (
        await pool.query<FactorRow>(
          "SELECT * FROM two_factor WHERE user_id=$1",
          [userId],
        )
      ).rows;
    }
    async function sessions(userId = id) {
      return (
        await pool.query(
          "SELECT id,created_at FROM session WHERE user_id=$1 ORDER BY id",
          [userId],
        )
      ).rows;
    }
    async function enroll(credential = cookie): Promise<Material> {
      const res = await post("/two-factor/enable", { password }, credential);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      return res.json();
    }
    async function code(userId = id) {
      const raw = await symmetricDecrypt({
        key: secret,
        data: (await rows(userId))[0]!.secret,
      });
      return (await native.api.generateTOTP({ body: { secret: raw } })).code;
    }
    async function activate() {
      const material = await enroll();
      const res = await post(
        "/two-factor/enrollment/confirm",
        { code: await code(), enrollmentId: material.enrollmentId },
        cookie,
      );
      expect(res.status).toBe(200);
      cookie = cookies(res);
      expect(Boolean(cookie)).toBe(true);
      return material;
    }
    async function challenge(address = email) {
      const res = await post("/sign-in/email", { email: address, password });
      expect(res.status).toBe(200);
      expect((await res.json()).twoFactorRedirect).toBe(true);
      const value = cookies(res, "two_factor");
      expect(Boolean(value)).toBe(true);
      return value;
    }
    function noLeaks(body: unknown, sensitive: string[]) {
      const text = JSON.stringify(body);
      // Boolean assertions prevent a failure from dumping secret-bearing responses.
      expect(
        [password, secret, ...sensitive].some(
          (s) => s.length > 0 && text.includes(s),
        ),
      ).toBe(false);
      expect(/otpauth:\/\//.test(text)).toBe(false);
    }
    async function ready() {
      const material = await activate();
      await pool.query("DELETE FROM session WHERE user_id=$1", [id]);
      return material;
    }
    async function auditEvents(eventType?: string) {
      return (
        await pool.query(
          "SELECT event_type,metadata,actor_user_id,subject_user_id,session_id,outcome FROM auth_security_event WHERE subject_user_id=$1 AND ($2::text IS NULL OR event_type=$2)",
          [id, eventType ?? null],
        )
      ).rows;
    }
    async function authenticationFailureEvents(method?: string) {
      return (
        await pool.query(
          "SELECT event_type,metadata,actor_user_id,subject_user_id,outcome FROM auth_security_event WHERE subject_user_id=$1 AND event_type='authentication_failure' AND ($2::text IS NULL OR metadata->>'method'=$2)",
          [id, method ?? null],
        )
      ).rows;
    }
    async function rejectAudit(work: () => Promise<void>) {
      await pool.query(
        "CREATE FUNCTION reject_auth_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-audit-fixture'; END $$; CREATE TRIGGER reject_auth_audit BEFORE INSERT ON auth_security_event FOR EACH ROW EXECUTE FUNCTION reject_auth_audit()",
      );
      try {
        await work();
      } finally {
        await pool.query(
          "DROP TRIGGER reject_auth_audit ON auth_security_event; DROP FUNCTION reject_auth_audit()",
        );
      }
    }
    it("durably audits verified enrollment, regeneration and disable without setup secrets", async () => {
      const material = await activate();
      expect(await auditEvents("two_factor_enabled")).toHaveLength(1);
      const regen = await post(
        "/two-factor/generate-backup-codes",
        { password },
        cookie,
      );
      expect(regen.status).toBe(200);
      expect(await auditEvents("recovery_codes_regenerated")).toHaveLength(1);
      const before = await sessions();
      const disabled = await post("/two-factor/disable", { password }, cookie);
      expect(disabled.status).toBe(200);
      expect(await auditEvents("two_factor_disabled")).toHaveLength(1);
      noLeaks(await auditEvents(), [
        ...material.backupCodes,
        material.totpURI,
        cookie,
      ]);
      expect(await sessions()).toHaveLength(before.length);
    });
    it("failed enrollment audit rolls back native activation and session rotation", async () => {
      const material = await enroll();
      const before = await sessions();
      await rejectAudit(async () => {
        const response = await post(
          "/two-factor/enrollment/confirm",
          { enrollmentId: material.enrollmentId, code: await code() },
          cookie,
        );
        expect(response.status).toBe(503);
        expect((await rows())[0].verified).toBe(false);
        expect(await sessions()).toEqual(before);
        expect(await auditEvents()).toHaveLength(0);
      });
      expect(
        (
          await post(
            "/two-factor/enrollment/confirm",
            { enrollmentId: material.enrollmentId, code: await code() },
            cookie,
          )
        ).status,
      ).toBe(200);
      expect(await auditEvents("two_factor_enabled")).toHaveLength(1);
    });
    it("failed regeneration audit preserves the old encrypted backup set", async () => {
      await activate();
      const before = (await rows())[0].backup_codes;
      await rejectAudit(async () => {
        expect(
          (
            await post(
              "/two-factor/generate-backup-codes",
              { password },
              cookie,
            )
          ).status,
        ).toBe(503);
        expect((await rows())[0].backup_codes === before).toBe(true);
        expect(await auditEvents("recovery_codes_regenerated")).toHaveLength(0);
      });
      expect(
        (await post("/two-factor/generate-backup-codes", { password }, cookie))
          .status,
      ).toBe(200);
      expect(await auditEvents("recovery_codes_regenerated")).toHaveLength(1);
    });
    it("failed disable audit preserves factor, session and assurance", async () => {
      await activate();
      await complete("totp", "elevation", cookie);
      const factorsBefore = JSON.stringify(await rows());
      const sessionsBefore = await sessions();
      const assuranceBefore = JSON.stringify(await assuranceRows());
      await rejectAudit(async () => {
        expect(
          (await post("/two-factor/disable", { password }, cookie)).status,
        ).toBe(503);
        expect(JSON.stringify(await rows()) === factorsBefore).toBe(true);
        expect(await sessions()).toEqual(sessionsBefore);
        expect(JSON.stringify(await assuranceRows()) === assuranceBefore).toBe(
          true,
        );
        expect(await auditEvents("two_factor_disabled")).toHaveLength(0);
      });
    });
    it("recovery proof and required audit commit together with no new session, and replay creates no success event", async () => {
      const material = await activate();
      const before = await sessions();
      expect(
        (await complete("recovery", "step-up", cookie, material.backupCodes[0]))
          .status,
      ).toBe(200);
      const evidence = await auditEvents("recovery_code_used");
      expect(evidence).toHaveLength(1);
      expect(evidence[0].metadata).toEqual({ purpose: "step_up" });
      expect(evidence[0].outcome).toBe("success");
      expect(
        (
          await complete(
            "recovery",
            "elevation",
            cookie,
            material.backupCodes[0],
          )
        ).status,
      ).toBe(401);
      expect(await auditEvents("recovery_code_used")).toHaveLength(1);
      expect(await sessions()).toEqual(before);
    });
    it("recovery audit failure rolls back native code consumption and assurance, allowing safe retry", async () => {
      const material = await activate();
      const before = (await rows())[0].backup_codes;
      const originalSessions = await sessions();
      await rejectAudit(async () => {
        const result = await complete(
          "recovery",
          "elevation",
          cookie,
          material.backupCodes[0],
        );
        expect(result.status).toBe(503);
        expect(
          JSON.stringify(await result.json()).includes("private-audit-fixture"),
        ).toBe(false);
        expect((await rows())[0].backup_codes === before).toBe(true);
        expect(await assuranceRows()).toHaveLength(0);
        expect(await auditEvents("recovery_code_used")).toHaveLength(0);
        expect(await sessions()).toEqual(originalSessions);
      });
      expect(
        (
          await complete(
            "recovery",
            "elevation",
            cookie,
            material.backupCodes[0],
          )
        ).status,
      ).toBe(200);
      expect(await auditEvents("recovery_code_used")).toHaveLength(1);
    });
    it("recovery login audit failure rolls back code and session, allowing safe retry", async () => {
      const material = await ready();
      const signInChallenge = await challenge();
      await rejectAudit(async () => {
        const response = await post(
          "/two-factor/verify-backup-code",
          { code: material.backupCodes[0] },
          signInChallenge,
        );
        expect(response.status).toBe(503);
        expect(await sessions()).toHaveLength(0);
        expect(await auditEvents("recovery_code_used")).toHaveLength(0);
      });
      const retry = await post(
        "/two-factor/verify-backup-code",
        { code: material.backupCodes[0] },
        signInChallenge,
      );
      expect(retry.status).toBe(200);
      expect(await sessions()).toHaveLength(1);
      expect(await auditEvents("recovery_code_used")).toHaveLength(1);
    });
    it("recovery login session failure rolls back code and audit, allowing safe retry", async () => {
      const material = await ready();
      const signInChallenge = await challenge();
      await pool.query(
        "CREATE FUNCTION reject_recovery_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-session-fixture'; END $$; CREATE TRIGGER reject_recovery_session BEFORE INSERT ON session FOR EACH ROW EXECUTE FUNCTION reject_recovery_session()",
      );
      try {
        const response = await post(
          "/two-factor/verify-backup-code",
          { code: material.backupCodes[0] },
          signInChallenge,
        );
        expect(response.status).toBe(503);
      } finally {
        await pool.query(
          "DROP TRIGGER reject_recovery_session ON session; DROP FUNCTION reject_recovery_session()",
        );
      }
      expect(await sessions()).toHaveLength(0);
      expect(await auditEvents("recovery_code_used")).toHaveLength(0);
      const retry = await post(
        "/two-factor/verify-backup-code",
        { code: material.backupCodes[0] },
        signInChallenge,
      );
      expect(retry.status).toBe(200);
      expect(await sessions()).toHaveLength(1);
      expect(await auditEvents("recovery_code_used")).toHaveLength(1);
    });
    it("concurrent native recovery proofs produce one success and one durable success event", async () => {
      const material = await activate();
      const outcomes = await Promise.all(
        [0, 1].map(() =>
          complete("recovery", "elevation", cookie, material.backupCodes[0]),
        ),
      );
      expect(
        outcomes.filter((response) => response.status === 200),
      ).toHaveLength(1);
      expect(
        outcomes.filter((response) => response.status === 401),
      ).toHaveLength(1);
      expect(await auditEvents("recovery_code_used")).toHaveLength(1);
      expect(await assuranceRows()).toHaveLength(1);
    });
    it("invalid recovery proof and wrong-password regeneration do not emit success audit", async () => {
      await activate();
      expect(
        (await complete("recovery", "elevation", cookie, "00000-00000")).status,
      ).toBe(401);
      expect(
        (
          await post(
            "/two-factor/generate-backup-codes",
            { password: "wrong password" },
            cookie,
          )
        ).status,
      ).toBe(400);
      expect(await auditEvents("recovery_code_used")).toHaveLength(0);
      expect(await auditEvents("recovery_codes_regenerated")).toHaveLength(0);
    });
    it("classifies five conclusive credential failures once and ignores malformed input", async () => {
      for (let attempt = 0; attempt < 5; attempt++)
        expect(
          (
            await post("/sign-in/email", {
              email,
              password: "wrong factor fixture password",
            })
          ).status,
        ).toBe(401);
      expect(await authenticationFailureEvents("password")).toHaveLength(1);
      expect(
        (
          await post("/sign-in/email", {
            email,
            password: 12345,
          })
        ).status,
      ).toBe(400);
      expect(await authenticationFailureEvents("password")).toHaveLength(1);
    });
    it("concurrent conclusive credential failures emit one durable event", async () => {
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          post("/sign-in/email", {
            email,
            password: "wrong factor fixture password",
          }),
        ),
      );
      expect(responses.every((response) => response.status === 401)).toBe(true);
      expect(await authenticationFailureEvents("password")).toHaveLength(1);
    });
    it.each(["totp", "recovery"])(
      "classifies five conclusive %s failures once without weakening native lock policy",
      async (method) => {
        await ready();
        const challengeCookie = await challenge();
        const valid = method === "totp" ? await code() : "00000-00000";
        const invalid =
          method === "totp"
            ? valid === "000000"
              ? "111111"
              : "000000"
            : "zzzzz-99999";
        for (let attempt = 0; attempt < 5; attempt++)
          expect(
            (
              await post(
                method === "totp"
                  ? "/two-factor/verify-totp"
                  : "/two-factor/verify-backup-code",
                { code: invalid },
                challengeCookie,
              )
            ).status,
          ).toBe(401);
        expect(await authenticationFailureEvents(method)).toHaveLength(1);
        expect(
          (
            await post(
              method === "totp"
                ? "/two-factor/verify-totp"
                : "/two-factor/verify-backup-code",
              { code: null },
              challengeCookie,
            )
          ).status,
        ).toBe(400);
        expect(await authenticationFailureEvents(method)).toHaveLength(1);
      },
    );
    it("password creates only a challenge; native TOTP then creates one ordinary session without assurance", async () => {
      await ready();
      const c = await challenge();
      expect(await sessions()).toHaveLength(0);
      expect(await current(c)).toBeNull();
      await request(app.getHttpServer())
        .get("/api/v1/profile/me")
        .set("Cookie", c)
        .expect(401);
      const otp = await code();
      const res = await post("/two-factor/verify-totp", { code: otp }, c);
      expect(res.status).toBe(200);
      const credential = cookies(res);
      expect(Boolean(credential)).toBe(true);
      expect((await current(credential)).user.id).toBe(id);
      expect(await sessions()).toHaveLength(1);
      expect(
        (await pool.query("SELECT count(*)::int n FROM session_assurance"))
          .rows[0].n,
      ).toBe(0);
      noLeaks(await res.json(), [otp, c, credential]);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
    it("wrong TOTP rejects without creating a session", async () => {
      await ready();
      const c = await challenge();
      const valid = await code();
      const wrong = String((Number(valid) + 1) % 1000000).padStart(6, "0");
      expect(
        (await post("/two-factor/verify-totp", { code: wrong }, c)).status,
      ).toBe(401);
      expect(await sessions()).toHaveLength(0);
      expect(await current(c)).toBeNull();
    });
    it.each(["invalid", "12345", "1234567", 123456, null])(
      "malformed TOTP %# rejects without a session",
      async (value) => {
        await ready();
        const c = await challenge();
        expect(
          (await post("/two-factor/verify-totp", { code: value }, c)).status,
        ).toBe(400);
        expect(await sessions()).toHaveLength(0);
      },
    );
    it("out-of-window TOTP is denied without widening native tolerance", async () => {
      await ready();
      const c = await challenge();
      const now = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now - 120000);
      const expired = await code();
      vi.setSystemTime(now);
      expect(
        (await post("/two-factor/verify-totp", { code: expired }, c)).status,
      ).toBe(401);
      expect(await sessions()).toHaveLength(0);
    });
    it("consumed challenge cannot create a second session", async () => {
      await ready();
      const c = await challenge();
      const otp = await code();
      expect(
        (await post("/two-factor/verify-totp", { code: otp }, c)).status,
      ).toBe(200);
      expect(
        (await post("/two-factor/verify-totp", { code: otp }, c)).status,
      ).toBe(401);
      expect(await sessions()).toHaveLength(1);
    });
    it("KNOWN UPSTREAM LIMITATION — better-auth/better-auth#10387: fresh independent challenges accept the same current TOTP", async () => {
      await ready();
      const a = await challenge(),
        b = await challenge();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now());
      const otp = await code();
      expect(
        (await post("/two-factor/verify-totp", { code: otp }, a)).status,
      ).toBe(200);
      expect(
        (await post("/two-factor/verify-totp", { code: otp }, b)).status,
      ).toBe(200);
      expect(await sessions()).toHaveLength(2);
      expect(
        (await pool.query("SELECT count(*)::int n FROM session_assurance"))
          .rows[0].n,
      ).toBe(0);
    });
    it("recovery login consumes once across ten concurrent challenges", async () => {
      const m = await ready();
      const challenges = await Promise.all(
        Array.from({ length: 10 }, () => challenge()),
      );
      const results = await Promise.all(
        challenges.map((c) =>
          post("/two-factor/verify-backup-code", { code: m.backupCodes[0] }, c),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status !== 200)).toHaveLength(9);
      expect(
        results.every((r) => [200, 401, 409, 429].includes(r.status)),
      ).toBe(true);
      expect(await sessions()).toHaveLength(1);
      expect(await auditEvents("recovery_code_used")).toHaveLength(1);
      expect(
        (
          await post(
            "/two-factor/verify-backup-code",
            { code: m.backupCodes[0] },
            await challenge(),
          )
        ).status,
      ).toBe(401);
      expect(await sessions()).toHaveLength(1);
      const success = results.find((r) => r.status === 200)!;
      expect((await current(cookies(success))).user.id).toBe(id);
      const body = await success.json();
      expect("token" in body).toBe(false);
      noLeaks(body, m.backupCodes);
    });
    it("ordinary login and recovery assurance race for one global redemption", async () => {
      const m = await activate();
      const signInChallenge = await challenge();
      const [login, assurance] = await Promise.all([
        post(
          "/two-factor/verify-backup-code",
          { code: m.backupCodes[0] },
          signInChallenge,
        ),
        complete("recovery", "elevation", cookie, m.backupCodes[0]),
      ]);
      expect(
        [login.status === 200, assurance.status === 200].filter(Boolean),
      ).toHaveLength(1);
      expect(await auditEvents("recovery_code_used")).toHaveLength(1);
      expect(await rows()).toHaveLength(1);
      expect(await sessions()).toHaveLength(login.status === 200 ? 2 : 1);
    });
    it("recovery redemption and regeneration serialize without resurrecting old codes", async () => {
      const material = await activate();
      const signInChallenge = await challenge();
      const [loginResult, regeneration] = await Promise.all([
        post(
          "/two-factor/verify-backup-code",
          { code: material.backupCodes[0] },
          signInChallenge,
        ),
        post("/two-factor/generate-backup-codes", { password }, cookie),
      ]);
      expect(regeneration.status).toBe(200);
      expect([200, 401, 409, 429]).toContain(loginResult.status);
      const encrypted = (await rows())[0]!.backup_codes;
      const current = JSON.parse(
        await symmetricDecrypt({ key: secret, data: encrypted }),
      ) as string[];
      expect(current).not.toContain(material.backupCodes[0]);
      expect(await auditEvents("recovery_code_used")).toHaveLength(
        loginResult.status === 200 ? 1 : 0,
      );
    });
    it("recovery redemption and factor disable serialize without resurrecting the factor", async () => {
      const material = await activate();
      const signInChallenge = await challenge();
      const [loginResult, disabled] = await Promise.all([
        post(
          "/two-factor/verify-backup-code",
          { code: material.backupCodes[0] },
          signInChallenge,
        ),
        post("/two-factor/disable", { password }, cookie),
      ]);
      expect(disabled.status).toBe(200);
      expect([200, 401, 409, 429]).toContain(loginResult.status);
      expect(await rows()).toHaveLength(0);
      expect(await auditEvents("two_factor_disabled")).toHaveLength(1);
      expect(await auditEvents("recovery_code_used")).toHaveLength(
        loginResult.status === 200 ? 1 : 0,
      );
    });
    it("user deletion racing recovery redemption leaves no usable recovery state", async () => {
      const material = await activate();
      const signInChallenge = await challenge();
      const [loginResult] = await Promise.all([
        post(
          "/two-factor/verify-backup-code",
          { code: material.backupCodes[0] },
          signInChallenge,
        ),
        pool.query('DELETE FROM "user" WHERE id=$1', [id]),
      ]);
      expect([200, 401, 409, 429]).toContain(loginResult.status);
      expect(await sessions()).toHaveLength(0);
      expect(await rows()).toHaveLength(0);
    });
    it("recovery code cannot cross user boundaries", async () => {
      const m = await ready();
      const other = await register("other@example.invalid");
      const oc = await login("other@example.invalid");
      const setup = await enroll(oc);
      expect(
        (
          await post(
            "/two-factor/enrollment/confirm",
            { enrollmentId: setup.enrollmentId, code: await code(other) },
            oc,
          )
        ).status,
      ).toBe(200);
      await pool.query("DELETE FROM session");
      expect(
        (
          await post(
            "/two-factor/verify-backup-code",
            { code: m.backupCodes[0] },
            await challenge("other@example.invalid"),
          )
        ).status,
      ).toBe(401);
      expect(await sessions(other)).toHaveLength(0);
      expect(await sessions()).toHaveLength(0);
    });
    it("rejects trusted-device, disableSession and identity/assurance fields before verification", async () => {
      const m = await ready();
      const c = await challenge();
      for (const path of ["verify-totp", "verify-backup-code"])
        for (const field of [
          "trustDevice",
          "disableSession",
          "userId",
          "sessionId",
          "elevated",
          "stepUpAt",
        ]) {
          const res = await post(
            "/two-factor/" + path,
            {
              code: path === "verify-totp" ? await code() : m.backupCodes[0],
              [field]: true,
            },
            c,
          );
          expect(res.status).toBe(400);
          expect(res.headers.getSetCookie()).toHaveLength(0);
        }
      expect(await sessions()).toHaveLength(0);
    });
    it("canonical login verifier cannot bypass generation-bound enrollment on an active session", async () => {
      const m = await enroll();
      for (const path of ["verify-totp", "verify-backup-code"]) {
        const res = await post(
          "/two-factor/" + path,
          { code: path === "verify-totp" ? await code() : m.backupCodes[0] },
          cookie,
        );
        expect(res.status).toBe(409);
      }
      expect((await rows())[0]!.verified).toBe(false);
      expect(await sessions()).toHaveLength(1);
    });
    it("expired challenge and untrusted origins cannot authenticate", async () => {
      await ready();
      const c = await challenge();
      const otp = await code();
      expect(
        (
          await post(
            "/two-factor/verify-totp",
            { code: otp },
            c,
            auth,
            "https://attacker.invalid",
          )
        ).status,
      ).toBe(403);
      await pool.query(
        "UPDATE verification SET expires_at=now()-interval '1 second' WHERE identifier LIKE '2fa-%'",
      );
      expect(
        (await post("/two-factor/verify-totp", { code: otp }, c)).status,
      ).toBe(401);
      expect(await sessions()).toHaveLength(0);
    });
    async function complete(
      method: "totp" | "recovery",
      purpose: "elevation" | "step-up",
      credential = cookie,
      value?: string,
    ) {
      const endpoint =
        method === "totp"
          ? purpose === "elevation"
            ? auth.api.completeTotpElevation
            : auth.api.completeTotpStepUp
          : purpose === "elevation"
            ? auth.api.completeRecoveryElevation
            : auth.api.completeRecoveryStepUp;
      return endpoint({
        headers: new Headers({ cookie: credential, origin }),
        body: { code: value ?? (await code()) },
        asResponse: true,
      });
    }
    async function assuranceRows() {
      return (
        await pool.query("SELECT * FROM session_assurance ORDER BY session_id")
      ).rows;
    }
    it("explicit native TOTP proof issues elevation only for A, step-up independently, with original session age", async () => {
      await ready();
      const a = cookies(
        await post(
          "/two-factor/verify-totp",
          { code: await code() },
          await challenge(),
        ),
      );
      const b = cookies(
        await post(
          "/two-factor/verify-totp",
          { code: await code() },
          await challenge(),
        ),
      );
      const before = await sessions();
      const ac = await current(a),
        bc = await current(b);
      expect(await assuranceRows()).toHaveLength(0);
      const start = Date.now();
      expect((await complete("totp", "elevation", a)).status).toBe(200);
      let [state] = await assuranceRows();
      expect(state.session_id).toBe(ac.session.id);
      expect(state.session_id === bc.session.id).toBe(false);
      expect(state.step_up_at).toBeNull();
      expect(state.elevated_at.getTime()).toBeGreaterThanOrEqual(start);
      expect(state.elevated_at.getTime()).toBeLessThanOrEqual(Date.now());
      const original = state.elevated_at.getTime();
      expect((await complete("totp", "step-up", a)).status).toBe(200);
      [state] = await assuranceRows();
      expect(state.elevated_at.getTime()).toBe(original);
      expect(state.step_up_at).not.toBeNull();
      expect(await sessions()).toEqual(before);
      const snapshot = JSON.stringify(await assuranceRows());
      await current(a);
      await current(b);
      expect(JSON.stringify(await assuranceRows())).toBe(snapshot);
    });
    it("step-up alone does not manufacture elevation; recovery proof is single-use", async () => {
      const material = await activate();
      expect(
        (await complete("recovery", "step-up", cookie, material.backupCodes[0]))
          .status,
      ).toBe(200);
      const [state] = await assuranceRows();
      expect(state.elevated_at).toBeNull();
      expect(state.last_elevated_activity_at).toBeNull();
      expect(state.step_up_at).not.toBeNull();
      expect(
        (
          await complete(
            "recovery",
            "elevation",
            cookie,
            material.backupCodes[0],
          )
        ).status,
      ).toBe(401);
      expect((await assuranceRows())[0].elevated_at).toBeNull();
    });
    it("pending, expired and wrong-code sessions cannot issue assurance", async () => {
      await enroll();
      expect((await complete("totp", "elevation")).status).toBe(401);
      expect(await assuranceRows()).toHaveLength(0);
      // Pending replacement remains within the approved enrollment coordinator.
      await activate();
      const otp = await code();
      const wrong = String((Number(otp) + 1) % 1000000).padStart(6, "0");
      expect((await complete("totp", "elevation", cookie, wrong)).status).toBe(
        401,
      );
      await pool.query(
        "UPDATE session SET created_at=now()-interval '31 days' WHERE user_id=$1",
        [id],
      );
      expect((await complete("totp", "elevation")).status).toBe(401);
      expect(await assuranceRows()).toHaveLength(0);
    });
    it("no public issuer, arbitrary timestamps, trust-device claims or cross-origin proof", async () => {
      await activate();
      for (const path of [
        "/completeTotpElevation",
        "/completeRecoveryStepUp",
        "/two-factor/complete-totp-elevation",
        "/assurance/complete",
        "/elevate",
        "/step-up",
      ])
        expect((await post(path, { code: await code() }, cookie)).status).toBe(
          404,
        );
      for (const field of [
        "userId",
        "sessionId",
        "elevatedAt",
        "stepUpAt",
        "mfa",
        "trustDevice",
      ]) {
        const r = await auth.api.completeTotpElevation({
          headers: new Headers({ cookie, origin }),
          body: { code: await code(), [field]: true },
          asResponse: true,
        });
        expect(r.status).toBe(400);
      }
      expect(
        (
          await auth.api.completeTotpElevation({
            headers: new Headers({
              cookie,
              origin: "https://attacker.invalid",
            }),
            body: { code: await code() },
            asResponse: true,
          })
        ).status,
      ).toBe(403);
      expect(await assuranceRows()).toHaveLength(0);
    });
    it("logout and session revocation cascade genuinely issued assurance", async () => {
      await activate();
      const a = cookie;
      const b = cookies(
        await post(
          "/two-factor/verify-totp",
          { code: await code() },
          await challenge(),
        ),
      );
      const bc = await current(b);
      await complete("totp", "elevation", a);
      await complete("totp", "elevation", b);
      expect(await assuranceRows()).toHaveLength(2);
      expect(
        (await post("/revoke-session", { sessionId: bc.session.id }, a)).status,
      ).toBe(200);
      expect(await assuranceRows()).toHaveLength(1);
      expect(await current(b)).toBeNull();
      expect((await post("/sign-out", {}, a)).status).toBe(200);
      expect(await assuranceRows()).toHaveLength(0);
    });
    it("password reset revokes issued assurance and all sessions, preserving the enrolled factor", async () => {
      await activate();
      await complete("totp", "elevation");
      const material = JSON.stringify(await rows());
      expect(
        (await post("/request-password-reset", { email, redirectTo: origin }))
          .status,
      ).toBe(200);
      await sender.onModuleDestroy();
      const next = "proof-reset-only replacement password";
      expect(
        (
          await post("/reset-password", {
            token: sender.passwordResets.at(-1)!.token,
            newPassword: next,
          })
        ).status,
      ).toBe(200);
      expect(await sessions()).toHaveLength(0);
      expect(await assuranceRows()).toHaveLength(0);
      expect(JSON.stringify(await rows()) === material).toBe(true);
      const r = await post("/sign-in/email", { email, password: next });
      expect(r.status).toBe(200);
      expect((await r.json()).twoFactorRedirect).toBe(true);
      expect(await current(cookies(r, "two_factor"))).toBeNull();
    });
    it("factor disable invalidates proof and material without resetting session age", async () => {
      await activate();
      await complete("totp", "elevation");
      const before = await sessions();
      expect(
        (await post("/two-factor/disable", { password: "wrong" }, cookie))
          .status,
      ).toBe(400);
      expect(await assuranceRows()).toHaveLength(1);
      const r = await post("/two-factor/disable", { password }, cookie);
      expect(r.status).toBe(200);
      expect(await assuranceRows()).toHaveLength(0);
      expect(await rows()).toHaveLength(0);
      expect(
        (await pool.query("SELECT count(*)::int n FROM two_factor_enrollment"))
          .rows[0].n,
      ).toBe(0);
      expect((await sessions())[0].created_at).toEqual(before[0].created_at);
    });
    it("email change preserves material and existing proof without issuing new assurance", async () => {
      await activate();
      await complete("totp", "elevation");
      const proof = JSON.stringify(await assuranceRows()),
        material = JSON.stringify(await rows());
      expect(
        (
          await post(
            "/email-change/request",
            { newEmail: "proof-changed@example.invalid" },
            cookie,
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
      expect(JSON.stringify(await assuranceRows())).toBe(proof);
      expect(JSON.stringify(await rows()) === material).toBe(true);
      expect(
        await current(await challenge("proof-changed@example.invalid")),
      ).toBeNull();
    });
    it("concurrent recovery assurance proof consumes once and cannot cross session ownership", async () => {
      const m = await activate();
      const b = cookies(
        await post(
          "/two-factor/verify-totp",
          { code: await code() },
          await challenge(),
        ),
      );
      const results = await Promise.all(
        [cookie, b].map((c) =>
          complete("recovery", "elevation", c, m.backupCodes[0]),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 401)).toHaveLength(1);
      expect(await assuranceRows()).toHaveLength(1);
    });
    it("assurance persistence failure rolls back proof consumption and exposes no driver diagnostics", async () => {
      const m = await activate();
      await pool.query(
        "CREATE FUNCTION reject_proof() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-proof-detail'; END $$; CREATE TRIGGER reject_proof BEFORE INSERT OR UPDATE ON session_assurance FOR EACH ROW EXECUTE FUNCTION reject_proof()",
      );
      try {
        const res = await complete(
          "recovery",
          "elevation",
          cookie,
          m.backupCodes[0],
        );
        expect(res.status).toBe(503);
        expect(
          JSON.stringify(await res.json()).includes("private-proof-detail"),
        ).toBe(false);
        expect(await assuranceRows()).toHaveLength(0);
      } finally {
        await pool.query(
          "DROP TRIGGER reject_proof ON session_assurance; DROP FUNCTION reject_proof()",
        );
      }
      expect(
        (await complete("recovery", "elevation", cookie, m.backupCodes[0]))
          .status,
      ).toBe(200);
    });
    it("concurrent TOTP completion of one challenge creates at most one session", async () => {
      await ready();
      const c = await challenge();
      const otp = await code();
      const results = await Promise.all(
        [1, 2].map(() => post("/two-factor/verify-totp", { code: otp }, c)),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        results.filter((r) => [400, 401, 409].includes(r.status)),
      ).toHaveLength(1);
      expect(await sessions()).toHaveLength(1);
    });
    it("native challenge failure budget remains effective in production login", async () => {
      await ready();
      const c = await challenge();
      const otp = await code();
      const wrong = String((Number(otp) + 1) % 1000000).padStart(6, "0");
      for (let n = 0; n < 5; n++)
        expect(
          (await post("/two-factor/verify-totp", { code: wrong }, c)).status,
        ).toBe(401);
      expect([400, 401]).toContain(
        (await post("/two-factor/verify-totp", { code: otp }, c)).status,
      );
      expect(await sessions()).toHaveLength(0);
    });
    it("login and internal proof never log submitted secrets or return reusable tokens", async () => {
      const m = await ready();
      const c = await challenge();
      const otp = await code();
      const log = vi
        .spyOn(Logger.prototype, "log")
        .mockImplementation(() => {});
      const warn = vi
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => {});
      const error = vi
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => {});
      const res = await post("/two-factor/verify-totp", { code: otp }, c);
      expect(res.status).toBe(200);
      const credential = cookies(res);
      const proof = await complete("totp", "elevation", credential, otp);
      expect(proof.status).toBe(200);
      const sensitive = [
        otp,
        c,
        credential,
        m.totpURI,
        ...m.backupCodes,
        (await rows())[0]!.secret,
      ];
      noLeaks(await res.json(), sensitive);
      noLeaks(await proof.json(), sensitive);
      noLeaks([log.mock.calls, warn.mock.calls, error.mock.calls], sensitive);
    });
  });
}
