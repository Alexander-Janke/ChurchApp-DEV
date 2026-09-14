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
type Material = { totpURI: string; backupCodes: string[] };
// Native verification exists ONLY in this disposable security harness. It is not
// an override/export of the application gate and cannot configure a running app.
export function twoFactorIntegrationTests() {
  describe("two-factor preparation and isolated native security probes", () => {
    const name = `auth_factor_test_${randomUUID().replaceAll("-", "")}`;
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
        "/two-factor/verify-totp",
        { code: await code() },
        cookie,
        native,
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
    it("rejects unauthenticated enrollment and wrong current passwords", async () => {
      expect((await post("/two-factor/enable", { password })).status).toBe(401);
      expect(
        (await post("/two-factor/enable", { password: "incorrect" }, cookie))
          .status,
      ).toBe(400);
      expect(await rows()).toHaveLength(0);
    });
    it("starts pending encrypted enrollment with a no-store issuer URI and ten codes, not assurance", async () => {
      const before = await sessions();
      const material = await enroll();
      const row = (await rows())[0]!;
      const uri = new URL(material.totpURI);
      const raw = uri.searchParams.get("secret")!;
      expect(uri.protocol).toBe("otpauth:");
      expect(uri.searchParams.get("issuer")).toBe("Church Platform");
      expect(uri.searchParams.get("digits")).toBe("6");
      expect(uri.searchParams.get("period")).toBe("30");
      expect(material.backupCodes).toHaveLength(10);
      expect(
        material.backupCodes.every((c) =>
          /^[a-zA-Z0-9]{5}-[a-zA-Z0-9]{5}$/.test(c),
        ),
      ).toBe(true);
      expect(row.secret === raw).toBe(false);
      expect(row.backup_codes.includes(material.backupCodes[0]!)).toBe(false);
      expect(
        (await symmetricDecrypt({ key: secret, data: row.secret })) ===
          row.secret,
      ).toBe(false);
      const decryptedCodes = JSON.parse(
        await symmetricDecrypt({ key: secret, data: row.backup_codes }),
      );
      expect(
        JSON.stringify(decryptedCodes) === JSON.stringify(material.backupCodes),
      ).toBe(true);
      expect(row.verified).toBe(false);
      expect(
        (
          await pool.query(
            'SELECT two_factor_enabled FROM "user" WHERE id=$1',
            [id],
          )
        ).rows[0].two_factor_enabled,
      ).toBe(false);
      expect(await sessions()).toEqual(before);
      noLeaks(await current(cookie), [
        raw,
        row.secret,
        row.backup_codes,
        ...material.backupCodes,
      ]);
    });
    it("replaces pending material without creating duplicate records or authenticating a factor", async () => {
      const first = await enroll();
      const rowId = (await rows())[0]!.id;
      const second = await enroll();
      expect(await rows()).toHaveLength(1);
      expect((await rows())[0]!.id).toBe(rowId);
      expect(first.totpURI === second.totpURI).toBe(false);
      expect(
        first.backupCodes.some((c) => second.backupCodes.includes(c)),
      ).toBe(false);
      expect((await rows())[0]!.verified).toBe(false);
    });
    it.each(["userId", "trustDevice", "issuer", "method"])(
      "rejects caller-controlled %s in enrollment",
      async (field) => {
        expect(
          (
            await post(
              "/two-factor/enable",
              { password, [field]: "forged" },
              cookie,
            )
          ).status,
        ).toBe(400);
        expect(await rows()).toHaveLength(0);
      },
    );
    it("enforces trusted origins and rejects absolute-expired enrollment sessions", async () => {
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
      await pool.query("UPDATE session SET created_at=$1 WHERE user_id=$2", [
        new Date(Date.now() - 31 * 86400000).toISOString(),
        id,
      ]);
      expect(
        (await post("/two-factor/enable", { password }, cookie)).status,
      ).toBe(401);
      expect(await rows()).toHaveLength(0);
      expect(await sessions()).toHaveLength(0);
    });
    it("does not expose subsequent secret, stored code, email OTP or generator APIs", async () => {
      await enroll();
      for (const path of [
        "get-totp-uri",
        "view-backup-codes",
        "send-otp",
        "verify-otp",
        "generate-totp",
      ])
        expect(
          (await post("/two-factor/" + path, { password }, cookie)).status,
        ).toBe(404);
    });
    it("keeps native enrollment replacement protection for an already active test fixture", async () => {
      await activate();
      const before = JSON.stringify(await rows());
      expect(
        (await post("/two-factor/enable", { password }, cookie)).status,
      ).toBe(400);
      expect(JSON.stringify(await rows()) === before).toBe(true);
    });
    it("records the native blocker: same TOTP and timestep authenticate two independent challenges", async () => {
      await activate();
      await pool.query("DELETE FROM session WHERE user_id=$1", [id]);
      const a = await challenge(),
        b = await challenge();
      expect(a === b).toBe(false);
      expect(await current(a)).toBeNull();
      expect(await sessions()).toHaveLength(0);
      // Freeze only Date (not I/O timers), avoiding a boundary-dependent flaky probe.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date());
      const otp = await code();
      const first = await post(
        "/two-factor/verify-totp",
        { code: otp },
        a,
        native,
      );
      const second = await post(
        "/two-factor/verify-totp",
        { code: otp },
        b,
        native,
      );
      expect([first.status, second.status]).toEqual([200, 200]);
      expect(await sessions()).toHaveLength(2);
    });
    it("refuses valid TOTP for both independent application challenges, with no sessions or assurance", async () => {
      await activate();
      await pool.query("DELETE FROM session WHERE user_id=$1", [id]);
      const a = await challenge(),
        b = await challenge();
      const otp = await code();
      for (const c of [a, b]) {
        const res = await post("/two-factor/verify-totp", { code: otp }, c);
        expect(res.status).toBe(503);
        noLeaks(await res.json(), [otp, c]);
        expect(cookies(res)).toBe("");
        expect(await current(c)).toBeNull();
        await request(app.getHttpServer())
          .get("/api/v1/profile/me")
          .set("Cookie", c)
          .expect(401);
        await request(app.getHttpServer())
          .post(base + "/two-factor/verify-totp")
          .set("Origin", origin)
          .set("Cookie", c)
          .send({ code: otp })
          .expect(503);
        expect(
          (await post("/two-factor/disable", { password }, c)).status,
        ).toBe(401);
        expect(
          (await post("/two-factor/generate-backup-codes", { password }, c))
            .status,
        ).toBe(401);
      }
      expect(await sessions()).toHaveLength(0);
    });
    it("blocks enrollment proof and production backup login as well as trustDevice creation", async () => {
      const material = await enroll();
      const before = await sessions();
      for (const path of ["verify-totp", "verify-backup-code"]) {
        const res = await post(
          "/two-factor/" + path,
          {
            code:
              path === "verify-totp" ? await code() : material.backupCodes[0],
            trustDevice: true,
          },
          cookie,
        );
        expect(res.status).toBe(503);
        expect(res.headers.has("set-cookie")).toBe(false);
      }
      expect(await sessions()).toEqual(before);
      expect((await rows())[0]!.verified).toBe(false);
    });
    it("native backup redemption is atomic across independent concurrent challenges and sequential replay fails", async () => {
      const material = await activate();
      await pool.query("DELETE FROM session WHERE user_id=$1", [id]);
      const a = await challenge(),
        b = await challenge();
      const res = await Promise.all(
        [a, b].map((c) =>
          post(
            "/two-factor/verify-backup-code",
            { code: material.backupCodes[0] },
            c,
            native,
          ),
        ),
      );
      expect(res.filter((r) => r.status === 200)).toHaveLength(1);
      expect(res.filter((r) => [401, 409].includes(r.status))).toHaveLength(1);
      expect(await sessions()).toHaveLength(1);
      expect(
        (
          await post(
            "/two-factor/verify-backup-code",
            { code: material.backupCodes[0] },
            await challenge(),
            native,
          )
        ).status,
      ).toBe(401);
    });
    it("rejects unknown backup codes and another user's code without leaking material", async () => {
      const first = await activate();
      const otherId = await register("other@example.invalid");
      const otherCookie = await login("other@example.invalid");
      await enroll(otherCookie);
      const activated = await post(
        "/two-factor/verify-totp",
        { code: await code(otherId) },
        otherCookie,
        native,
      );
      expect(activated.status).toBe(200);
      for (const value of [first.backupCodes[0]!, "invalid-code"]) {
        const res = await post(
          "/two-factor/verify-backup-code",
          { code: value },
          await challenge("other@example.invalid"),
          native,
        );
        expect(res.status).toBe(401);
        noLeaks(await res.json(), [value]);
      }
      const remaining = await symmetricDecrypt({
        key: secret,
        data: (await rows())[0]!.backup_codes,
      });
      expect(
        (JSON.parse(remaining) as string[]).includes(first.backupCodes[0]!),
      ).toBe(true);
    });
    it("rotates backup codes with password proof, invalidating old codes without adding sessions", async () => {
      const old = await activate();
      const before = await sessions();
      expect(
        (
          await post(
            "/two-factor/generate-backup-codes",
            { password: "wrong" },
            cookie,
          )
        ).status,
      ).toBe(400);
      const rotated = await post(
        "/two-factor/generate-backup-codes",
        { password },
        cookie,
      );
      expect(rotated.status).toBe(200);
      expect(rotated.headers.get("cache-control")).toBe("no-store");
      const fresh = (await rotated.json()).backupCodes as string[];
      expect(fresh).toHaveLength(10);
      expect(fresh.some((c) => old.backupCodes.includes(c))).toBe(false);
      expect(await sessions()).toEqual(before);
      expect(
        (
          await post(
            "/two-factor/verify-backup-code",
            { code: old.backupCodes[0] },
            await challenge(),
            native,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await post(
            "/two-factor/verify-backup-code",
            { code: fresh[0] },
            await challenge(),
            native,
          )
        ).status,
      ).toBe(200);
    });
    it("disables only the authenticated user's material and explicitly rotates without resetting absolute age", async () => {
      await activate();
      const otherId = await register("other@example.invalid");
      await enroll(await login("other@example.invalid"));
      const other = JSON.stringify(await rows(otherId));
      await pool.query(
        "UPDATE session SET created_at=now()-interval '2 days' WHERE user_id=$1",
        [id],
      );
      const before = await sessions();
      expect(
        (await post("/two-factor/disable", { password: "wrong" }, cookie))
          .status,
      ).toBe(400);
      const res = await post("/two-factor/disable", { password }, cookie);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: true, sessionRotated: true });
      const after = await sessions();
      expect(after).toHaveLength(before.length);
      expect(after[0].created_at).toEqual(before[0].created_at);
      expect(after[0].id === before[0].id).toBe(false);
      expect(await current(cookie)).toBeNull();
      expect((await current(cookies(res))).user.id).toBe(id);
      expect(await rows()).toHaveLength(0);
      expect(JSON.stringify(await rows(otherId)) === other).toBe(true);
      expect(Boolean(await login(email))).toBe(true);
    });
    it("requires password re-entry with an authoritative older session, without claiming step-up", async () => {
      await enroll();
      await pool.query(
        "UPDATE session SET created_at=now()-interval '2 days' WHERE user_id=$1",
        [id],
      );
      // In 1.7.4 sensitiveSessionMiddleware is authoritative, not freshSessionMiddleware.
      expect((await post("/two-factor/disable", {}, cookie)).status).toBe(400);
      expect(await rows()).toHaveLength(1);
      expect(
        (await post("/two-factor/disable", { password }, cookie)).status,
      ).toBe(200);
      expect(await rows()).toHaveLength(0);
    });
    it("does not permit an existing native trusted-device cookie to bypass the application challenge", async () => {
      await activate();
      const c = await challenge();
      const res = await post(
        "/two-factor/verify-backup-code",
        {
          code: JSON.parse(
            await symmetricDecrypt({
              key: secret,
              data: (await rows())[0]!.backup_codes,
            }),
          )[0],
          trustDevice: true,
        },
        c,
        native,
      );
      expect(res.status).toBe(200);
      const trust = cookies(res, "trust_device");
      expect(Boolean(trust)).toBe(true);
      const before = await sessions();
      expect(
        (await post("/sign-in/email", { email, password }, trust)).status,
      ).toBe(403);
      expect(await sessions()).toEqual(before);
      expect(await current(await challenge())).toBeNull();
    });
    it("cascades factor material on user deletion and safely repeats all seven migrations", async () => {
      await enroll();
      const before = JSON.stringify(await rows());
      await migrate(drizzle(pool), { migrationsFolder: folder });
      expect(JSON.stringify(await rows()) === before).toBe(true);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(7);
      await pool.query('DELETE FROM "user" WHERE id=$1', [id]);
      expect(await rows()).toHaveLength(0);
    });
    it("password change and reset preserve pending material and never confer assurance", async () => {
      await enroll();
      const before = JSON.stringify(await rows());
      const replacement = "factor-test-only replacement password";
      expect(
        (
          await post(
            "/change-password",
            { currentPassword: password, newPassword: replacement },
            cookie,
          )
        ).status,
      ).toBe(200);
      expect(JSON.stringify(await rows()) === before).toBe(true);
      expect(
        (
          await post(
            "/request-password-reset",
            { email, redirectTo: origin },
            "",
          )
        ).status,
      ).toBe(200);
      await sender.onModuleDestroy();
      const res = await post("/reset-password", {
        token: sender.passwordResets.at(-1)!.token,
        newPassword: password,
      });
      expect(res.status).toBe(200);
      expect(JSON.stringify(await rows()) === before).toBe(true);
      expect(await sessions()).toHaveLength(0);
      expect(Boolean(await login(email))).toBe(true);
    });
    it("never logs enrollment material or supplied failed-verification secrets", async () => {
      const log = vi
        .spyOn(Logger.prototype, "log")
        .mockImplementation(() => {});
      const error = vi
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => {});
      const warn = vi
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => {});
      const material = await enroll();
      const row = (await rows())[0]!;
      const raw = await symmetricDecrypt({ key: secret, data: row.secret });
      const otp = await code();
      const res = await post("/two-factor/verify-totp", { code: otp }, cookie);
      noLeaks(await res.json(), [
        raw,
        otp,
        row.secret,
        row.backup_codes,
        material.totpURI,
        ...material.backupCodes,
      ]);
      noLeaks(
        [log.mock.calls, error.mock.calls, warn.mock.calls],
        [
          raw,
          otp,
          row.secret,
          row.backup_codes,
          material.totpURI,
          ...material.backupCodes,
        ],
      );
    });
    it("retains real native IP rate limiting on the preparation boundary", async () => {
      const ctx = await auth.$context;
      const previous = ctx.rateLimit.enabled;
      ctx.rateLimit.enabled = true;
      try {
        const statuses: number[] = [];
        for (let n = 0; n < 4; n++) {
          const res = await auth.handler(
            new Request(origin + base + "/two-factor/verify-totp", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Origin: origin,
                "x-forwarded-for": "192.0.2.71",
              },
              body: JSON.stringify({ code: "invalid" }),
            }),
          );
          statuses.push(res.status);
        }
        expect(statuses).toEqual([503, 503, 503, 429]);
      } finally {
        ctx.rateLimit.enabled = previous;
      }
    });
    it("password change preserves active native factor state and still requires a challenge on new login", async () => {
      await activate();
      const before = JSON.stringify(await rows());
      const next = "active-factor-change-only replacement password";
      expect(
        (
          await post(
            "/change-password",
            { currentPassword: password, newPassword: next },
            cookie,
          )
        ).status,
      ).toBe(200);
      expect(JSON.stringify(await rows()) === before).toBe(true);
      const res = await post("/sign-in/email", { email, password: next });
      expect(res.status).toBe(200);
      expect((await res.json()).twoFactorRedirect).toBe(true);
      expect(await current(cookies(res, "two_factor"))).toBeNull();
    });
    it("password reset preserves active native state and the subsequent login still only challenges", async () => {
      await activate();
      const before = JSON.stringify(await rows());
      expect(
        (await post("/request-password-reset", { email, redirectTo: origin }))
          .status,
      ).toBe(200);
      await sender.onModuleDestroy();
      expect(
        (
          await post("/reset-password", {
            token: sender.passwordResets.at(-1)!.token,
            newPassword: "factor-reset-only replacement password",
          })
        ).status,
      ).toBe(200);
      expect(JSON.stringify(await rows()) === before).toBe(true);
      expect(await sessions()).toHaveLength(0);
      const res = await post("/sign-in/email", {
        email,
        password: "factor-reset-only replacement password",
      });
      expect(res.status).toBe(200);
      expect((await res.json()).twoFactorRedirect).toBe(true);
      expect(await current(cookies(res, "two_factor"))).toBeNull();
    });
    it("application-owned email change preserves factor secret, unused backups and native state", async () => {
      await activate();
      const before = JSON.stringify(await rows());
      const newEmail = "changed@example.invalid";
      expect(
        (await post("/email-change/request", { newEmail }, cookie)).status,
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
      expect(JSON.stringify(await rows()) === before).toBe(true);
      const currentUser = await current(cookie);
      expect(currentUser.user.id).toBe(id);
      expect(currentUser.user.email).toBe(newEmail);
      expect(await current(await challenge(newEmail))).toBeNull();
    });
  });
}
