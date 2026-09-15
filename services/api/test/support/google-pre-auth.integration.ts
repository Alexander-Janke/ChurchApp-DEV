import request from "supertest";
import { Test } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
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
import { AuthTransaction } from "../../src/auth/auth-transaction.js";
import { GooglePreAuth } from "../../src/auth/google-pre-auth.js";
import {
  challengeKey,
  newSocialChallenge,
  SOCIAL_PRE_AUTH_LIFETIME_MS,
} from "../../src/auth/google-pre-auth-policy.js";
import * as schema from "../../src/database/schema/auth.js";
import * as applicationSchema from "../../src/database/schema/index.js";
import { TestAuthEmailSender } from "./auth-email.js";

type Target = ReturnType<typeof createBetterAuth>;
export function googlePreAuthIntegrationTests() {
  describe("server-only Google pre-authentication bridge", () => {
    const name = `google_bridge_${randomUUID().replaceAll("-", "")}`;
    const origin = "http://localhost:3001",
      base = "/api/v1/auth";
    const secret = randomBytes(48).toString("hex"),
      sender = new TestAuthEmailSender();
    const folder = fileURLToPath(new URL("../../migrations", import.meta.url));
    let maintenance: Pool,
      pool: Pool,
      app: NestExpressApplication,
      auth: Target,
      created = false;
    let userId: string, providerId: string, providerEmail: string;
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
      vi.stubEnv("GOOGLE_CLIENT_ID", "isolated-placeholder");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "isolated-placeholder");
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
      auth = app.get<AuthService<Target>>(AuthService).instance;
    }, 30000);
    beforeEach(async () => {
      await pool.query('TRUNCATE "user", verification CASCADE');
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
          randomBytes(32).toString("hex"),
          "unused-encrypted-fixture",
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
    it("suppresses session insertion, returns only pre-authentication and persists a hashed event-bound challenge", async () => {
      const response = await callback(await begin());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ secondFactorRequired: true });
      expect(response.headers.get("cache-control")).toBe("no-store");
      const raw = token(response)!;
      expect(typeof raw).toBe("string");
      const attributes = response.headers
        .getSetCookie()
        .find((c) => c.startsWith("better-auth.social_pre_auth="))!;
      expect(attributes).toContain("HttpOnly");
      expect(attributes).toContain("SameSite=Lax");
      expect(attributes).toContain("Path=/");
      expect(attributes).toContain("Max-Age=600");
      const r = await pool.query("SELECT * FROM verification WHERE id=$1", [
        challengeKey(raw),
      ]);
      expect(r.rowCount).toBe(1);
      expect(JSON.stringify(r.rows).includes(raw)).toBe(false);
      expect(
        JSON.stringify(r.rows).includes("provider-fixture-not-a-real-token"),
      ).toBe(false);
      const v = JSON.parse(r.rows[0].value) as Record<string, unknown>;
      expect(Object.keys(v).sort()).toEqual([
        "accountFingerprint",
        "accountId",
        "eventId",
        "factorFingerprint",
        "provider",
        "userId",
      ]);
      expect(v.userId === userId && v.provider === "google").toBe(true);
      expect(
        r.rows[0].expires_at.getTime() - r.rows[0].created_at.getTime(),
      ).toBe(SOCIAL_PRE_AUTH_LIFETIME_MS);
      expect(await counts()).toEqual({
        sessions: 0,
        assurance: 0,
        churches: 0,
        memberships: 0,
        roles: 0,
        owners: 0,
      });
      expect(
        response.headers
          .getSetCookie()
          .some((c) => c.includes("session_token=")),
      ).toBe(false);
      expect((await pending(raw)).userId === userId).toBe(true);
    });
    it("profile, onboarding, tenant members and admin settings reject the pre-auth cookie", async () => {
      const response = await callback(await begin());
      const c = cookies(response),
        id = randomUUID();
      for (const [method, path] of [
        ["get", "/api/v1/profile/me"],
        ["post", "/api/v1/churches"],
        ["get", `/api/v1/churches/${id}/members`],
        ["patch", `/api/v1/churches/${id}/settings`],
      ] as const) {
        const r = await request(app.getHttpServer())
          [method](path)
          .set("Cookie", c)
          .set("Origin", origin)
          .send({});
        expect(r.status).toBe(401);
      }
      const current = await auth.handler(
        new Request(origin + base + "/get-session", { headers: { cookie: c } }),
      );
      expect(await current.json()).toBeNull();
      expect((await counts()).sessions).toBe(0);
    });
    it("already-linked no-factor social-only account receives only an ordinary revocable session", async () => {
      // Native createdAt/expiresAt sample Date independently; keep the exact
      // seven-day assertion deterministic without broadening session policy.
      const now = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      await pool.query(
        'UPDATE "user" SET two_factor_enabled=false WHERE id=$1',
        [userId],
      );
      await pool.query("DELETE FROM two_factor");
      const response = await callback(await begin());
      expect(response.status).toBe(302);
      const c = cookies(response);
      expect(token(response)).toBeUndefined();
      const r = await auth.handler(
        new Request(origin + base + "/get-session", { headers: { cookie: c } }),
      );
      const current = await r.json();
      expect(current?.user?.id === userId).toBe(true);
      expect((await counts()).assurance).toBe(0);
      const rows = await pool.query(
        "SELECT created_at,expires_at FROM session",
      );
      expect(rows.rowCount).toBe(1);
      expect(
        rows.rows[0].expires_at.getTime() - rows.rows[0].created_at.getTime(),
      ).toBe(604800000);
      const credential = await pool.query(
        "SELECT count(*)::int count FROM account WHERE provider_id='credential'",
      );
      expect(credential.rows[0].count).toBe(0);
      const bad = await auth.handler(
        new Request(origin + base + "/sign-in/email", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({
            email: providerEmail,
            password: "random-password-is-not-created",
          }),
        }),
      );
      expect(bad.status).toBe(401);
      const logout = await auth.handler(
        new Request(origin + base + "/sign-out", {
          method: "POST",
          headers: { origin, cookie: c, "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(logout.status).toBe(200);
      expect((await counts()).sessions).toBe(0);
    });
    it("rejects wrong-user, malformed and missing challenge references", async () => {
      const raw = token(await callback(await begin()))!;
      await expect(pending(raw, randomUUID())).rejects.toThrow(
        "Invalid social challenge",
      );
      await expect(pending("bad")).rejects.toThrow("Invalid social challenge");
      await expect(pending(newSocialChallenge())).rejects.toThrow(
        "Invalid social challenge",
      );
    });
    it("expires exactly at its ten-minute boundary", async () => {
      const raw = token(await callback(await begin()))!;
      const r = await pool.query(
        "SELECT (extract(epoch from expires_at)*1000)::float8 AS expiry FROM verification WHERE id=$1",
        [challengeKey(raw)],
      );
      const expiry = r.rows[0].expiry;
      expect((await pending(raw, userId, expiry - 1)).userId === userId).toBe(
        true,
      );
      await expect(pending(raw, userId, expiry)).rejects.toThrow(
        "Invalid social challenge",
      );
      await expect(pending(raw, userId, expiry + 1)).rejects.toThrow(
        "Invalid social challenge",
      );
    });
    it("deleted/consumed challenge cannot be used again", async () => {
      const raw = token(await callback(await begin()))!;
      await pool.query("DELETE FROM verification WHERE id=$1", [
        challengeKey(raw),
      ]);
      await expect(pending(raw)).rejects.toThrow("Invalid social challenge");
    });
    it("deleting the user disables an orphan pending challenge", async () => {
      const raw = token(await callback(await begin()))!;
      await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
      await expect(pending(raw)).rejects.toThrow("Invalid social challenge");
      expect((await counts()).sessions).toBe(0);
    });
    it("factor replacement and provider unlink invalidate pending state", async () => {
      const raw = token(await callback(await begin()))!;
      await pool.query("UPDATE two_factor SET secret=$1", [
        randomBytes(32).toString("hex"),
      ]);
      await expect(pending(raw)).rejects.toThrow("Invalid social challenge");
      const another = token(await callback(await begin()))!;
      await pool.query("DELETE FROM account");
      await expect(pending(another)).rejects.toThrow(
        "Invalid social challenge",
      );
    });
    it("concurrent independent callbacks leave only distinct pending challenges", async () => {
      const a = await begin(),
        b = await begin();
      const r = await Promise.all([callback(a), callback(b)]);
      expect(r.map((x) => x.status)).toEqual([200, 200]);
      expect(token(r[0]!) === token(r[1]!)).toBe(false);
      expect((await counts()).sessions).toBe(0);
    });
    it("same callback cannot be redeemed twice sequentially or concurrently", async () => {
      const s = await begin();
      const r = await Promise.all([callback(s), callback(s)]);
      expect(r.filter((x) => x.status === 200)).toHaveLength(1);
      expect((await callback(s)).status).not.toBe(200);
      expect((await counts()).sessions).toBe(0);
    });
    it("same-email unlinked identity never merges and first-user signup remains deferred", async () => {
      const before = await pool.query(
        "SELECT id,user_id,account_id FROM account",
      );
      providerId = randomUUID();
      expect((await callback(await begin())).status).toBe(401);
      expect(
        (await pool.query("SELECT id,user_id,account_id FROM account")).rows,
      ).toEqual(before.rows);
      providerEmail = "new@example.invalid";
      expect((await callback(await begin())).status).toBe(401);
      expect((await pool.query('SELECT id FROM "user"')).rowCount).toBe(1);
    });
    it("stable provider identity wins over a changed email claim without changing the canonical email", async () => {
      providerEmail = "changed@example.invalid";
      const raw = token(await callback(await begin()))!;
      expect((await pending(raw)).userId === userId).toBe(true);
      const r = await pool.query('SELECT email FROM "user" WHERE id=$1', [
        userId,
      ]);
      expect(r.rows[0].email).toBe("linked@example.invalid");
    });
    it("ambiguous provider ownership cannot authenticate either identity", async () => {
      const other = randomUUID();
      await pool.query(
        'INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$2,$3,true,now(),now())',
        [other, "Other", "other@example.invalid"],
      );
      await pool.query(
        "INSERT INTO account(id,user_id,account_id,provider_id,created_at,updated_at) VALUES($1,$2,$3,$4,now(),now())",
        [randomUUID(), other, providerId, "google"],
      );
      expect((await callback(await begin())).status).not.toBe(200);
      expect((await counts()).sessions).toBe(0);
    });
    it("invalid state and untrusted origin cannot create pending state or session", async () => {
      expect((await callback({ state: "invalid", cookie: "" })).status).toBe(
        401,
      );
      const r = await auth.api.signInSocial({
        headers: new Headers({ origin: "https://attacker.invalid" }),
        body: {},
        asResponse: true,
      });
      expect(r.status).toBe(403);
      expect((await counts()).sessions).toBe(0);
    });
    it("public initiation/callback/linking/token routes are unavailable even with configured credentials", async () => {
      for (const path of [
        "/sign-in/social",
        "/callback/google",
        "/link-social",
        "/unlink-account",
        "/get-access-token",
        "/refresh-token",
        "/account-info",
        "/list-accounts",
      ]) {
        const r = await auth.handler(
          new Request(origin + base + path, {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: "{}",
          }),
        );
        expect(r.status).toBe(404);
      }
      const get = await auth.handler(
        new Request(
          origin + base + "/callback/google?code=fixture&state=fixture",
        ),
      );
      expect(get.status).toBe(404);
    });
    it("cannot inherit an already authenticated session during another Google attempt", async () => {
      await pool.query('UPDATE "user" SET two_factor_enabled=false');
      await pool.query("DELETE FROM two_factor");
      const logged = await callback(await begin());
      const c = cookies(logged);
      const r = await auth.api.signInSocial({
        headers: new Headers({ origin, cookie: c }),
        body: {},
        asResponse: true,
      });
      expect(r.status).toBe(409);
    });
    it("does not log provider values, OAuth code, pre-auth credential or session secrets", async () => {
      const logs: unknown[] = [];
      const spies = (["log", "warn", "error", "debug", "verbose"] as const).map(
        (level) =>
          vi
            .spyOn(Logger.prototype, level)
            .mockImplementation((...a: unknown[]) => {
              logs.push(a);
            }),
      );
      const response = await callback(await begin());
      const raw = token(response)!;
      const serialized = JSON.stringify(logs);
      expect(serialized.includes(raw)).toBe(false);
      expect(serialized.includes("provider-fixture-not-a-real-token")).toBe(
        false,
      );
      expect(serialized.includes("isolated-authorization-code")).toBe(false);
      spies.forEach((spy) => spy.mockRestore());
    });
    it("KNOWN UPSTREAM/NATIVE LIMITATION — Google social callback bypasses Better Auth two-factor enforcement in pinned 1.7.4", async () => {
      const native = betterAuth({
        baseURL: origin,
        basePath: base,
        secret,
        database: drizzleAdapter(drizzle(pool, { schema }), {
          provider: "pg",
          schema,
        }),
        plugins: [twoFactor()],
        socialProviders: {
          google: {
            clientId: "isolated-placeholder",
            clientSecret: "isolated-placeholder",
          },
        },
        account: { accountLinking: { enabled: false } },
        session: { cookieCache: { enabled: false } },
        logger: { disabled: true },
      });
      await stubProvider(native as unknown as Target);
      const init = await native.api.signInSocial({
        body: {
          provider: "google",
          callbackURL: origin + "/done",
          disableRedirect: true,
        },
        headers: new Headers({ origin }),
        asResponse: true,
      });
      const data = (await init.json()) as { url: string };
      const state = new URL(data.url).searchParams.get("state")!;
      const result = await native.handler(
        new Request(
          origin +
            base +
            "/callback/google?code=fixture&state=" +
            encodeURIComponent(state),
          { headers: { cookie: cookies(init) } },
        ),
      );
      expect(result.status).toBe(302);
      const current = await native.api.getSession({
        headers: new Headers({ cookie: cookies(result) }),
      });
      expect(current?.user.id === userId).toBe(true);
      expect((await counts()).sessions).toBe(1);
    });
    it("never inserts even a transient session for a factor-enabled callback", async () => {
      await pool.query(
        `CREATE FUNCTION prohibit_social_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'session insert forbidden in probe'; END $$; CREATE TRIGGER prohibit_social_session BEFORE INSERT ON session FOR EACH ROW EXECUTE FUNCTION prohibit_social_session()`,
      );
      try {
        expect((await callback(await begin())).status).toBe(200);
        expect((await counts()).sessions).toBe(0);
      } finally {
        await pool.query(
          "DROP TRIGGER prohibit_social_session ON session; DROP FUNCTION prohibit_social_session()",
        );
      }
    });
    it("independent connections observe no authenticated window before callback commit", async () => {
      let reached!: () => void, release!: () => void;
      const ready = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = GooglePreAuth.prototype.beforeSession;
      vi.spyOn(GooglePreAuth.prototype, "beforeSession").mockImplementation(
        async function (
          this: GooglePreAuth,
          ...args: Parameters<GooglePreAuth["beforeSession"]>
        ) {
          const result = await original.apply(this, args);
          reached();
          await wait;
          return result;
        },
      );
      const start = await begin();
      const running = callback(start);
      try {
        await ready;
        expect((await counts()).sessions).toBe(0);
        const stored = await pool.query(
          "SELECT count(*)::int count FROM verification WHERE id LIKE 'social-pre-auth:%'",
        );
        expect(stored.rows[0].count).toBe(1);
        const response = await request(app.getHttpServer()).get(
          "/api/v1/profile/me",
        );
        expect(response.status).toBe(401);
      } finally {
        release();
      }
      expect((await running).status).toBe(200);
      expect((await counts()).sessions).toBe(0);
    });
    it("challenge persistence failure rolls back callback processing and leaves no hidden session", async () => {
      await pool.query(
        `ALTER TABLE verification ADD CONSTRAINT reject_social_probe CHECK (id NOT LIKE 'social-pre-auth:%')`,
      );
      try {
        expect((await callback(await begin())).status).not.toBe(200);
        expect((await counts()).sessions).toBe(0);
      } finally {
        await pool.query(
          "ALTER TABLE verification DROP CONSTRAINT reject_social_probe",
        );
      }
      const stored = await pool.query(
        "SELECT count(*)::int count FROM verification WHERE id LIKE 'social-pre-auth:%'",
      );
      expect(stored.rows[0].count).toBe(0);
    });
    it("pending login cannot inherit another session's existing elevation", async () => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO session(id,user_id,token,created_at,updated_at,expires_at) VALUES($1,$2,$3,now(),now(),now()+interval '1 day')",
        [id, userId, randomBytes(32).toString("hex")],
      );
      await pool.query(
        "INSERT INTO session_assurance(session_id,elevated_at,last_elevated_activity_at,step_up_at) VALUES($1,now(),now(),now())",
        [id],
      );
      const response = await callback(await begin());
      const c = cookies(response);
      const denied = await request(app.getHttpServer())
        .get(`/api/v1/churches/${randomUUID()}/members`)
        .set("Cookie", c);
      expect(denied.status).toBe(401);
      expect((await counts()).sessions).toBe(1);
      expect((await counts()).assurance).toBe(1);
      const read = await auth.handler(
        new Request(origin + base + "/get-session", { headers: { cookie: c } }),
      );
      expect(await read.json()).toBeNull();
    });
    it("single-use challenge consumption serializes concurrent callers without creating authentication", async () => {
      const raw = token(await callback(await begin()))!;
      const transactions = new AuthTransaction(
        drizzle(pool, { schema: applicationSchema }),
      );
      const bridge = new GooglePreAuth(transactions);
      const consume = () =>
        transactions.run((tx) => bridge.consumePending(tx, raw, userId));
      const results = await Promise.allSettled([consume(), consume()]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      await expect(consume()).rejects.toThrow("Invalid social challenge");
      expect((await counts()).sessions).toBe(0);
    });
    it("provider subject reassignment and disabled factor invalidate existing challenge", async () => {
      const raw = token(await callback(await begin()))!;
      await pool.query("UPDATE account SET account_id=$1", [randomUUID()]);
      await expect(pending(raw)).rejects.toThrow("Invalid social challenge");
      await pool.query("UPDATE account SET account_id=$1", [providerId]);
      await pool.query('UPDATE "user" SET two_factor_enabled=false');
      await expect(pending(raw)).rejects.toThrow("Invalid social challenge");
    });
    it("social credential cannot be redeemed by the native credential-factor completion route", async () => {
      const response = await callback(await begin());
      const result = await auth.handler(
        new Request(origin + base + "/two-factor/verify-totp", {
          method: "POST",
          headers: {
            origin,
            cookie: cookies(response),
            "content-type": "application/json",
          },
          body: JSON.stringify({ code: "123456" }),
        }),
      );
      expect(result.status).toBe(401);
      expect((await counts()).sessions).toBe(0);
    });
    it("clean/repeated migration chain stays through 0010 and preserves bridge records", async () => {
      const raw = token(await callback(await begin()))!;
      await migrate(drizzle(pool), { migrationsFolder: folder });
      const history = await pool.query(
        "SELECT count(*)::int count FROM drizzle.__drizzle_migrations",
      );
      expect(history.rows[0].count).toBe(12);
      expect((await pending(raw)).userId === userId).toBe(true);
    });
  });
}
