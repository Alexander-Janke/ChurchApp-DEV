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
import { createBetterAuth } from "../../src/auth/auth.config.js";
import { getDatabaseUrl } from "../../src/database/database.config.js";
import { DATABASE_POOL } from "../../src/database/database.constants.js";
import * as schema from "../../src/database/schema/auth.js";
import * as applicationSchema from "../../src/database/schema/index.js";
import { factorFingerprint } from "../../src/auth/two-factor-enrollment-policy.js";
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
// Disposable native instance is used only to generate fixture codes, never to
// confirm enrollment or bypass the production boundary in these tests.
export function enrollmentIntegrationTests() {
  describe("transactionally consistent two-factor enrollment", () => {
    const name = `auth_enrollment_test_${randomUUID().replaceAll("-", "")}`;
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
    async function pending(userId = id) {
      return (
        await pool.query(
          "SELECT * FROM two_factor_enrollment WHERE user_id=$1",
          [userId],
        )
      ).rows;
    }
    async function confirm(
      material: Material,
      credential = cookie,
      otp?: string,
    ) {
      return post(
        "/two-factor/enrollment/confirm",
        { enrollmentId: material.enrollmentId, code: otp ?? (await code()) },
        credential,
      );
    }
    it("begins, replaces and confirms only the current generation without login or assurance", async () => {
      const a = await enroll();
      const aCode = await code();
      const b = await enroll();
      expect(a.enrollmentId === b.enrollmentId).toBe(false);
      expect(await pending()).toHaveLength(1);
      expect((await confirm(a, cookie, aCode)).status).toBe(409);
      expect((await rows())[0]!.verified).toBe(false);
      const before = await sessions();
      const res = await confirm(b);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: true, sessionRotated: true });
      expect((await rows())[0]!.verified).toBe(true);
      expect(await pending()).toHaveLength(0);
      const after = await sessions();
      expect(after).toHaveLength(before.length);
      expect(after[0].created_at).toEqual(before[0].created_at);
      expect((await current(cookies(res))).user.id).toBe(id);
      expect(
        (await pool.query("SELECT count(*)::int n FROM session_assurance"))
          .rows[0].n,
      ).toBe(0);
      expect(
        (
          await post(
            "/two-factor/verify-totp",
            { code: await code() },
            await challenge(),
          )
        ).status,
      ).toBe(503);
    });
    it("requires session, password, exact fields and trusted origin before generation", async () => {
      expect((await post("/two-factor/enable", { password })).status).toBe(401);
      expect(
        (await post("/two-factor/enable", { password: "wrong" }, cookie))
          .status,
      ).toBe(400);
      expect(
        (
          await post(
            "/two-factor/enable",
            { password, userId: "foreign" },
            cookie,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await post(
            "/two-factor/enable",
            { password },
            cookie,
            auth,
            "https://attacker.invalid",
          )
        ).status,
      ).toBe(403);
      expect(await rows()).toHaveLength(0);
      expect(await pending()).toHaveLength(0);
    });
    it("keeps one opaque generation, only a ciphertext fingerprint and a one-hour expiry", async () => {
      const material = await enroll();
      const row = (await pending())[0];
      expect(row.id).toBe(material.enrollmentId);
      expect(row.user_id).toBe(id);
      expect(row.factor_fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(3600000);
      const nativeRow = (await rows())[0]!;
      const raw = await symmetricDecrypt({
        key: secret,
        data: nativeRow.secret,
      });
      noLeaks(row, [
        raw,
        nativeRow.secret,
        nativeRow.backup_codes,
        material.totpURI,
        ...material.backupCodes,
      ]);
      expect(
        (await pool.query("SELECT count(*)::int n FROM session_assurance"))
          .rows[0].n,
      ).toBe(0);
    });
    it("rejects expired, mismatched and invalid confirmations without consuming the current generation", async () => {
      const a = await enroll();
      expect((await confirm(a, cookie, "invalid")).status).toBe(400);
      expect((await confirm({ ...a, enrollmentId: randomUUID() })).status).toBe(
        409,
      );
      const valid = await code();
      const wrong = String((Number(valid) + 1) % 1000000).padStart(6, "0");
      expect((await confirm(a, cookie, wrong)).status).toBe(401);
      expect((await rows())[0]!.verified).toBe(false);
      expect(await pending()).toHaveLength(1);
      await pool.query(
        "UPDATE two_factor_enrollment SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [id],
      );
      expect((await confirm(a)).status).toBe(409);
      expect((await rows())[0]!.verified).toBe(false);
    });
    it("refuses altered native material rather than confirming whatever factor exists", async () => {
      const a = await enroll();
      await pool.query(
        "UPDATE two_factor_enrollment SET factor_fingerprint=$1 WHERE user_id=$2",
        ["0".repeat(64), id],
      );
      expect((await confirm(a)).status).toBe(409);
      expect((await rows())[0]!.verified).toBe(false);
    });
    it("rejects all caller-selected confirmation identity/assurance fields", async () => {
      const a = await enroll();
      for (const field of [
        "userId",
        "sessionId",
        "trustDevice",
        "elevatedAt",
        "stepUpAt",
        "verified",
        "password",
      ]) {
        const res = await post(
          "/two-factor/enrollment/confirm",
          { enrollmentId: a.enrollmentId, code: await code(), [field]: true },
          cookie,
        );
        expect(res.status).toBe(400);
      }
      expect((await rows())[0]!.verified).toBe(false);
    });
    it("rejects unauthenticated and untrusted-origin confirmation", async () => {
      const a = await enroll();
      const body = { enrollmentId: a.enrollmentId, code: await code() };
      expect((await post("/two-factor/enrollment/confirm", body)).status).toBe(
        401,
      );
      expect(
        (
          await post(
            "/two-factor/enrollment/confirm",
            body,
            cookie,
            auth,
            "https://attacker.invalid",
          )
        ).status,
      ).toBe(403);
      expect((await rows())[0]!.verified).toBe(false);
    });
    it("cannot confirm or replace another user's generation", async () => {
      const a = await enroll();
      const otherId = await register("other@example.invalid");
      const otherCookie = await login("other@example.invalid");
      const b = await enroll(otherCookie);
      const before = JSON.stringify(await pending());
      const beforeFactor = JSON.stringify(await rows());
      expect((await confirm(a, otherCookie)).status).toBe(409);
      expect((await confirm(b, cookie)).status).toBe(409);
      await enroll(otherCookie);
      expect(JSON.stringify(await pending())).toBe(before);
      expect(JSON.stringify(await rows()) === beforeFactor).toBe(true);
      expect(await pending(otherId)).toHaveLength(1);
    });
    async function orderedRace(
      first: () => Promise<Response>,
      second: () => Promise<Response>,
    ) {
      const lock = await pool.connect();
      let a: Promise<Response> | undefined, b: Promise<Response> | undefined;
      try {
        await lock.query("BEGIN");
        await lock.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [id]);
        const wait = async (count: number) =>
          vi.waitFor(
            async () => {
              const result = await pool.query(
                `SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%from "user"%for update%'`,
              );
              expect(result.rows[0].n).toBe(count);
            },
            { timeout: 3000, interval: 10 },
          );
        a = first();
        await wait(1);
        b = second();
        await wait(2);
        await lock.query("COMMIT");
        return await Promise.all([a, b]);
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
        await Promise.allSettled([a, b].filter(Boolean));
      }
    }
    // Separate configured instance and adapter scope, sharing only PostgreSQL.
    function otherInstance() {
      return createBetterAuth(
        drizzle(pool, { schema: applicationSchema }),
        sender,
      );
    }
    it("confirm A wins: a concurrent replacement on another instance is rejected and A stays verified", async () => {
      const otherSession = await login(email);
      const a = await enroll();
      const fingerprint = (await pending())[0].factor_fingerprint;
      const second = otherInstance();
      const [confirmed, replaced] = await orderedRace(
        () => confirm(a),
        () => post("/two-factor/enable", { password }, otherSession, second),
      );
      expect(confirmed.status).toBe(200);
      expect(replaced.status).toBe(409);
      expect((await rows())[0]!.verified).toBe(true);
      expect(await pending()).toHaveLength(0);
      expect(
        (await post("/two-factor/enable", { password }, cookies(confirmed)))
          .status,
      ).toBe(409);
      expect(factorFingerprint((await rows())[0]!.secret) === fingerprint).toBe(
        true,
      );
    });
    it("replace B wins: concurrent A confirmation is stale, B needs its own proof", async () => {
      const a = await enroll();
      const aCode = await code();
      const second = otherInstance();
      const [replacement, stale] = await orderedRace(
        () => post("/two-factor/enable", { password }, cookie, second),
        () => confirm(a, cookie, aCode),
      );
      expect(replacement.status).toBe(200);
      expect(stale.status).toBe(409);
      const b = (await replacement.json()) as Material;
      expect((await rows())[0]!.verified).toBe(false);
      expect((await pending())[0].id).toBe(b.enrollmentId);
      expect((await confirm(a, cookie, aCode)).status).toBe(409);
      expect((await confirm(b)).status).toBe(200);
      expect((await rows())[0]!.verified).toBe(true);
    });
    it("concurrent same-generation proof produces exactly one completed transition", async () => {
      const otherSession = await login(email);
      const a = await enroll();
      const otp = await code();
      const [first, second] = await orderedRace(
        () => confirm(a, cookie, otp),
        () => confirm(a, otherSession, otp),
      );
      expect([first.status, second.status]).toEqual([200, 409]);
      expect((await rows())[0]!.verified).toBe(true);
      expect(await pending()).toHaveLength(0);
      expect(await sessions()).toHaveLength(2);
    });
    it("generation persistence failure rolls back native replacement material", async () => {
      const a = await enroll();
      const before = JSON.stringify(await rows());
      await pool.query(
        "CREATE FUNCTION reject_enrollment_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture-private-detail'; END $$; CREATE TRIGGER reject_enrollment_write BEFORE INSERT OR UPDATE ON two_factor_enrollment FOR EACH ROW EXECUTE FUNCTION reject_enrollment_write()",
      );
      try {
        const res = await post("/two-factor/enable", { password }, cookie);
        expect(res.status).toBe(503);
        expect(res.headers.getSetCookie()).toHaveLength(0);
        expect(
          JSON.stringify(await res.json()).includes("fixture-private-detail"),
        ).toBe(false);
        expect(JSON.stringify(await rows()) === before).toBe(true);
        expect((await pending())[0].id).toBe(a.enrollmentId);
      } finally {
        await pool.query(
          "DROP TRIGGER reject_enrollment_write ON two_factor_enrollment; DROP FUNCTION reject_enrollment_write()",
        );
      }
    });
    it("confirmation persistence failure rolls back factor flag and session rotation without sending cookies", async () => {
      const a = await enroll();
      const before = await sessions();
      await pool.query(
        "CREATE FUNCTION reject_enrollment_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture-private-detail'; END $$; CREATE TRIGGER reject_enrollment_delete BEFORE DELETE ON two_factor_enrollment FOR EACH ROW EXECUTE FUNCTION reject_enrollment_delete()",
      );
      try {
        const res = await confirm(a);
        expect(res.status).toBe(503);
        expect(res.headers.getSetCookie()).toHaveLength(0);
        expect((await rows())[0]!.verified).toBe(false);
        expect(
          (
            await pool.query(
              'SELECT two_factor_enabled FROM "user" WHERE id=$1',
              [id],
            )
          ).rows[0].two_factor_enabled,
        ).toBe(false);
        expect(await sessions()).toEqual(before);
        expect((await pending())[0].id).toBe(a.enrollmentId);
      } finally {
        await pool.query(
          "DROP TRIGGER reject_enrollment_delete ON two_factor_enrollment; DROP FUNCTION reject_enrollment_delete()",
        );
      }
    });
    it("disable removes pending state only after password proof", async () => {
      await enroll();
      expect(
        (await post("/two-factor/disable", { password: "wrong" }, cookie))
          .status,
      ).toBe(400);
      expect(await pending()).toHaveLength(1);
      expect(
        (await post("/two-factor/disable", { password }, cookie)).status,
      ).toBe(200);
      expect(await pending()).toHaveLength(0);
      expect(await rows()).toHaveLength(0);
    });
    it("absolute-expired session cannot confirm even a current pending generation", async () => {
      const a = await enroll();
      await pool.query(
        "UPDATE session SET created_at=now()-interval '31 days' WHERE user_id=$1",
        [id],
      );
      expect((await confirm(a)).status).toBe(401);
      expect((await rows())[0]!.verified).toBe(false);
    });
    it("rechecks a session revoked while confirmation waits for the user lock", async () => {
      const a = await enroll();
      const otp = await code();
      const lock = await pool.connect();
      let waiting: Promise<Response> | undefined;
      try {
        await lock.query("BEGIN");
        await lock.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [id]);
        waiting = confirm(a, cookie, otp);
        await vi.waitFor(
          async () => {
            const result = await pool.query(
              `SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%from "user"%for update%'`,
            );
            expect(result.rows[0].n).toBe(1);
          },
          { timeout: 3000, interval: 10 },
        );
        await lock.query("DELETE FROM session WHERE user_id=$1", [id]);
        await lock.query("COMMIT");
        expect((await waiting).status).toBe(401);
        expect((await rows())[0]!.verified).toBe(false);
        expect((await pending())[0].id).toBe(a.enrollmentId);
        expect(await sessions()).toHaveLength(0);
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
        if (waiting) await Promise.allSettled([waiting]);
      }
    });
    it("retains native endpoint throttling on authenticated enrollment confirmation", async () => {
      const a = await enroll();
      const ctx = await auth.$context;
      const previous = ctx.rateLimit.enabled;
      ctx.rateLimit.enabled = true;
      try {
        const statuses: number[] = [];
        for (let n = 0; n < 4; n++) {
          const res = await auth.handler(
            new Request(origin + base + "/two-factor/enrollment/confirm", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Origin: origin,
                cookie,
                "x-forwarded-for": "192.0.2.172",
              },
              body: JSON.stringify({
                enrollmentId: a.enrollmentId,
                code: "invalid",
              }),
            }),
          );
          statuses.push(res.status);
        }
        expect(statuses).toEqual([400, 400, 400, 429]);
        expect((await rows())[0]!.verified).toBe(false);
      } finally {
        ctx.rateLimit.enabled = previous;
      }
    });
    it("clean/repeated migrations preserve pending data and user deletion cascades coordination", async () => {
      await enroll();
      const before = JSON.stringify(await pending());
      await migrate(drizzle(pool), { migrationsFolder: folder });
      expect(JSON.stringify(await pending())).toBe(before);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(9);
      await pool.query('DELETE FROM "user" WHERE id=$1', [id]);
      expect(await pending()).toHaveLength(0);
      expect(await rows()).toHaveLength(0);
    });
    it("never logs setup, submitted proof, session material or enrollment fingerprints", async () => {
      const log = vi
        .spyOn(Logger.prototype, "log")
        .mockImplementation(() => {});
      const warn = vi
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => {});
      const error = vi
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => {});
      const a = await enroll();
      const otp = await code();
      const before = (await rows())[0]!;
      const res = await confirm(a, cookie, otp);
      expect(res.status).toBe(200);
      noLeaks(await res.json(), [
        otp,
        cookie,
        before.secret,
        before.backup_codes,
        a.totpURI,
        ...a.backupCodes,
      ]);
      noLeaks(
        [log.mock.calls, warn.mock.calls, error.mock.calls],
        [
          otp,
          cookie,
          before.secret,
          before.backup_codes,
          a.totpURI,
          ...a.backupCodes,
        ],
      );
    });
  });
}
