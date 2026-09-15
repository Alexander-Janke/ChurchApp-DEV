import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AuthService } from "@thallesp/nestjs-better-auth";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { symmetricDecrypt } from "better-auth/crypto";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sql } from "drizzle-orm";
import request from "supertest";
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { AuthEmailSender } from "../../src/auth/auth-email.js";
import type { createBetterAuth } from "../../src/auth/auth.config.js";
import { DatabaseService } from "../../src/database/database.service.js";
import { DATABASE_POOL } from "../../src/database/database.constants.js";
import { TenantContext } from "../../src/database/tenant-context.js";
import * as schema from "../../src/database/schema/auth.js";
import { OnboardingLimiter } from "../../src/onboarding/onboarding-limiter.js";
import { OwnershipService } from "../../src/ownership/ownership.service.js";
import {
  STANDARD_ROLES,
  standardRoleId,
} from "../../src/authorization/standard-roles.js";
import {
  createTenantTestFixture,
  type TenantTestFixture,
} from "./tenant/database-fixture.js";
import { migrateFixture } from "./tenant/migration-fixture.js";
import { TestAuthEmailSender } from "./auth-email.js";

export function onboardingHttpIntegrationTests() {
  describe("public onboarding HTTP with real auth and restricted PostgreSQL", () => {
    const tables = [
      "church",
      "church_membership",
      "church_role",
      "church_role_permission",
      "church_membership_role",
      "church_primary_owner",
      "church_ownership_audit",
    ];
    const origin = "http://localhost:3001",
      password = "onboarding-test-only password phrase";
    const secret = randomBytes(48).toString("hex"),
      sender = new TestAuthEmailSender();
    let f: TenantTestFixture, app: NestExpressApplication;
    let auth: ReturnType<typeof createBetterAuth>,
      native: ReturnType<typeof codeGenerator>;
    let userId: string, cookie: string, limiter: OnboardingLimiter;
    // Isolated pinned native generator only; real enrollment confirmation runs through AppModule.
    function codeGenerator() {
      return betterAuth({
        baseURL: origin,
        secret,
        database: drizzleAdapter(f.fixtureDb.db, { provider: "pg", schema }),
        plugins: [twoFactor({ issuer: "Church Platform" })],
        logger: { disabled: true },
      });
    }
    beforeAll(async () => {
      f = await createTenantTestFixture({ protectedTables: tables });
      // AuthModule uses the same restricted runtime login for its account-scoped data.
      // Explicit named-table DML only; no tenant bypass/ownership/DDL permissions.
      await f.fixturePool.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON "user",account,session,verification,two_factor,two_factor_enrollment,session_assurance,email_change_request,user_profile TO "${f.roleName}"`,
      );
      await f.fixturePool.query(
        `GRANT INSERT ON auth_security_event TO "${f.roleName}"`,
      );
      vi.stubEnv("BETTER_AUTH_SECRET", secret);
      vi.stubEnv("BETTER_AUTH_URL", origin);
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DATABASE_POOL)
        .useValue(f.concurrentPool)
        .overrideProvider(DatabaseService)
        .useValue(f.concurrentDb)
        .overrideProvider(AuthEmailSender)
        .useValue(sender)
        .overrideProvider(OnboardingLimiter)
        .useValue({ consume: (id: string) => limiter.consume(id) })
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
      native = codeGenerator();
    }, 30000);
    afterAll(async () => {
      try {
        await app?.close();
      } finally {
        await f?.dispose();
        vi.unstubAllEnvs();
      }
    });
    beforeEach(async () => {
      limiter = new OnboardingLimiter();
      sender.reset();
      await f.fixturePool.query('TRUNCATE church, "user" CASCADE');
      ({ userId, cookie } = await register());
    });
    afterEach(async () => {
      await sender.onModuleDestroy();
      sender.reset();
      vi.restoreAllMocks();
    });
    const http = () => request(app.getHttpServer());
    async function authPost(path: string, body: object, c = "") {
      const res = await http()
        .post("/api/v1/auth" + path)
        .set("Origin", origin)
        .set("Cookie", c)
        .send(body);
      expect(res.status).toBe(200);
      return res;
    }
    function credential(res: request.Response): string {
      const all = res.headers["set-cookie"] as unknown;
      const value = (Array.isArray(all) ? all : [])
        .find(
          (v: string) =>
            v.startsWith("better-auth.session_token=") &&
            !v.includes("Max-Age=0"),
        )
        ?.split(";")[0];
      if (!value) throw new Error("Expected test session cookie");
      return value;
    }
    async function register() {
      const email = randomUUID() + "@example.invalid";
      const signup = await authPost("/sign-up/email", {
        name: "Onboarding test",
        email,
        password,
      });
      const link = new URL(sender.messages.at(-1)!.url);
      const verified = await http().get(link.pathname + link.search);
      expect([200, 302]).toContain(verified.status);
      const logged = await authPost("/sign-in/email", { email, password });
      return {
        userId: signup.body.user.id as string,
        cookie: credential(logged),
      };
    }
    async function activate(c = cookie) {
      const setup = await authPost("/two-factor/enable", { password }, c);
      const current = await auth.api.getSession({
        headers: new Headers({ cookie: c }),
      });
      const stored = (
        await f.fixturePool.query(
          "select secret from two_factor where user_id=$1",
          [current!.user.id],
        )
      ).rows[0].secret as string;
      const raw = await symmetricDecrypt({ key: secret, data: stored });
      const code = (await native.api.generateTOTP({ body: { secret: raw } }))
        .code;
      const confirmed = await authPost(
        "/two-factor/enrollment/confirm",
        { enrollmentId: setup.body.enrollmentId, code },
        c,
      );
      return credential(confirmed);
    }
    const post = (
      body: object = { name: "New Church", slug: "new-church" },
      c = cookie,
    ) =>
      http()
        .post("/api/v1/churches")
        .set("Origin", origin)
        .set("Cookie", c)
        .send(body);
    async function counts() {
      return Promise.all(
        tables.map(
          async (table) =>
            (
              await f.fixturePool.query(
                'SELECT count(*)::int n FROM "' + table + '"',
              )
            ).rows[0].n,
        ),
      );
    }
    const none = async () =>
      expect(await counts()).toEqual([0, 0, 0, 0, 0, 0, 0]);
    async function complete(id: string, actorId = userId) {
      const scope = TenantContext.fromAuthorizedScope(id);
      await f.withTenant(scope, async (tx) => {
        const c = (
          await tx.execute(
            sql`select id,status,verification_state from church where id=${id}`,
          )
        ).rows;
        expect(c).toEqual([
          { id, status: "active", verification_state: "unverified" },
        ]);
        const m = (
          await tx.execute(
            sql`select id,user_id,status from church_membership where church_id=${id}`,
          )
        ).rows;
        expect(m).toHaveLength(1);
        expect(m[0]).toMatchObject({ user_id: actorId, status: "member" });
        expect(
          (
            await tx.execute(
              sql`select membership_id from church_primary_owner where church_id=${id}`,
            )
          ).rows,
        ).toEqual([{ membership_id: m[0]!.id }]);
        expect(
          (
            await tx.execute(
              sql`select event_type,actor_user_id from church_ownership_audit where church_id=${id}`,
            )
          ).rows,
        ).toEqual([
          { event_type: "initial_owner_established", actor_user_id: actorId },
        ]);
        const roles = (
          await tx.execute(
            sql`select id,name,is_system from church_role where church_id=${id}`,
          )
        ).rows;
        expect(roles).toHaveLength(5);
        expect(STANDARD_ROLES.map((role) => role.key)).toEqual([
          "group_leader",
          "area_leader",
          "event_administrator",
          "childrens_worker",
          "main_church_administrator",
        ]);

        for (const d of STANDARD_ROLES) {
          expect(roles).toContainEqual({
            id: standardRoleId(scope, d.key),
            name: d.name,
            is_system: true,
          });
          expect(d).toMatchObject(
            d.key === "main_church_administrator"
              ? {
                  privileged: true,
                  permissions: ["members.manage", "church.settings.manage"],
                }
              : { privileged: false, permissions: [] },
          );
        }
        expect(
          (
            await tx.execute(
              sql`select role_id,permission from church_role_permission where church_id=${id} order by permission`,
            )
          ).rows,
        ).toEqual(
          ["church.settings.manage", "members.manage"].map((permission) => ({
            role_id: standardRoleId(scope, "main_church_administrator"),
            permission,
          })),
        );
        expect(
          (
            await tx.execute(
              sql`select * from church_membership_role where church_id=${id}`,
            )
          ).rows,
        ).toEqual([]);
      });
      const current = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      expect(
        await app.get(OwnershipService).isPrimaryOwner(scope, {
          userId: actorId,
          sessionId: current!.session.id,
        }),
      ).toBe(true);
    }
    async function securityState() {
      return {
        sessions: (
          await f.fixturePool.query(
            "select id,user_id,created_at from session order by id",
          )
        ).rows,
        assurance: (
          await f.fixturePool.query(
            "select * from session_assurance order by session_id",
          )
        ).rows,
      };
    }
    it("real enrollment plus authenticated HTTP creates the complete active/unverified result without elevation or new sessions", async () => {
      cookie = await activate();
      const before = await securityState();
      expect(before.assurance).toEqual([]);
      const res = await post().expect(201);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(Object.keys(res.body).sort()).toEqual([
        "church",
        "membership",
        "ownership",
      ]);
      expect(Object.keys(res.body.church).sort()).toEqual([
        "id",
        "name",
        "slug",
        "status",
        "verificationState",
      ]);
      expect(res.body.membership).toEqual({
        id: expect.any(String),
        status: "member",
      });
      expect(res.body.ownership).toEqual({ isPrimaryOwner: true });
      expect(JSON.stringify(res.body).includes(cookie)).toBe(false);
      expect(await counts()).toEqual([1, 1, 5, 2, 0, 1, 1]);
      await complete(res.body.church.id);
      expect(await securityState()).toEqual(before);
    });
    it("unauthenticated request returns 401 and leaves no artifacts", async () => {
      await post(undefined, "").expect(401);
      await none();
    });
    it.each(["revoked", "expired", "absolute"])(
      "%s session returns 401 without writes",
      async (mode) => {
        if (mode === "revoked")
          await f.fixturePool.query("delete from session where user_id=$1", [
            userId,
          ]);
        else if (mode === "expired")
          await f.fixturePool.query(
            "update session set expires_at=now()-interval '1 second' where user_id=$1",
            [userId],
          );
        else
          await f.fixturePool.query(
            "update session set created_at=now()-interval '31 days' where user_id=$1",
            [userId],
          );
        await post().expect(401);
        await none();
      },
    );
    it("authenticated account without factor is denied with zero artifacts", async () => {
      await post().expect(403);
      await none();
    });
    it("pending enrollment is insufficient for ownership creation", async () => {
      await authPost("/two-factor/enable", { password }, cookie);
      await post().expect(403);
      await none();
    });
    it.each([undefined, "https://attacker.invalid", "null"])(
      "missing/untrusted Origin %# leaves zero artifacts",
      async (value) => {
        const r = http().post("/api/v1/churches").set("Cookie", cookie);
        if (value) r.set("Origin", value);
        await r.send({ name: "Church", slug: "church" }).expect(403);
        await none();
      },
    );
    it.each([
      "id",
      "status",
      "verificationState",
      "creatorUserId",
      "ownerUserId",
      "ownerMembershipId",
      "primaryOwner",
      "isPrimaryOwner",
      "roles",
      "permissions",
      "membershipStatus",
      "twoFactorEnabled",
      "unknown",
    ])("rejects protected field %s without artifacts", async (field) => {
      await post({ name: "Church", slug: "church", [field]: "foreign" }).expect(
        400,
      );
      await none();
    });
    it.each([
      { name: " " },
      { slug: "bad slug" },
      { addressLine1: "x".repeat(201) },
      { countryCode: "de" },
      { denomination: "x".repeat(121) },
      { logo: "javascript:alert(1)" },
    ])("invalid input %# leaves no artifacts", async (invalid) => {
      await post({ name: "Church", slug: "church", ...invalid }).expect(400);
      await none();
    });
    it("rejects query owner selectors", async () => {
      await http()
        .post("/api/v1/churches?ownerUserId=other")
        .set("Cookie", cookie)
        .set("Origin", origin)
        .send({ name: "Church", slug: "church" })
        .expect(400);
      await none();
    });
    it("duplicate canonical slug is a safe 409 and preserves the complete original", async () => {
      cookie = await activate();
      const first = await post().expect(201);
      const duplicate = await post({
        name: "Another",
        slug: "NEW-CHURCH",
      }).expect(409);
      expect(duplicate.body.message).toBe("Church slug is unavailable");
      expect(await counts()).toEqual([1, 1, 5, 2, 0, 1, 1]);
      await complete(first.body.church.id);
    });
    it("concurrent same-slug HTTP requests yield one complete 201 and one 409, no loser artifacts", async () => {
      cookie = await activate();
      const responses = await Promise.all([post(), post()]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await counts()).toEqual([1, 1, 5, 2, 0, 1, 1]);
      await complete(responses.find((r) => r.status === 201)!.body.church.id);
    });
    it("rate limit counts denied attempts and prevents a fourth orchestration", async () => {
      for (let n = 0; n < 3; n++) await post().expect(403);
      const r = await post().expect(429);
      expect(r.headers["cache-control"]).toBe("no-store");
      await none();
      const other = await register();
      await post(undefined, other.cookie).expect(403);
    });
    it("HTTP-created tenants remain isolated with real restricted runtime and no wildcard owner grant", async () => {
      cookie = await activate();
      const a = await post().expect(201);
      const other = await register();
      const otherCookie = await activate(other.cookie);
      const b = await post(
        {
          name: "Other Church",
          slug: "other-church",
        },
        otherCookie,
      ).expect(201);
      const actor = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      expect(
        await app
          .get(OwnershipService)
          .isPrimaryOwner(TenantContext.fromAuthorizedScope(b.body.church.id), {
            userId,
            sessionId: actor!.session.id,
          }),
      ).toBe(false);
      await complete(a.body.church.id);
      await f.assertRestrictedRole();
      await f.withTenant(
        TenantContext.fromAuthorizedScope(a.body.church.id),
        async (tx) => {
          for (const table of tables.slice(1))
            expect(
              (
                await tx.execute(
                  sql`select * from ${sql.identifier(table)} where church_id=${b.body.church.id}`,
                )
              ).rows,
            ).toEqual([]);
          expect((await tx.execute(sql`select id from church`)).rows).toEqual([
            { id: a.body.church.id },
          ]);
        },
      );
      expect(await counts()).toEqual([2, 2, 10, 4, 0, 2, 2]);
    });
    it.each([
      "church_membership",
      "church_primary_owner",
      "church_ownership_audit",
      "church_role",
    ])(
      "HTTP sanitizes %s failure and rolls back every artifact",
      async (table) => {
        cookie = await activate();
        await f.fixturePool.query(
          `CREATE FUNCTION fail_http_onboarding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private database cause'; END $$`,
        );
        await f.fixturePool.query(
          `CREATE TRIGGER fail_http BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION fail_http_onboarding()`,
        );
        try {
          const res = await post().expect(503);
          expect(res.body.message).toBe("Church onboarding unavailable");
          expect(res.headers["cache-control"]).toBe("no-store");
          await none();
        } finally {
          await f.fixturePool.query(`DROP TRIGGER fail_http ON "${table}"`);
          await f.fixturePool.query("DROP FUNCTION fail_http_onboarding()");
        }
      },
    );
    it("clean chain through 0010 repeats without mutating HTTP-created onboarding", async () => {
      cookie = await activate();
      const res = await post().expect(201);
      expect(
        (
          await f.fixturePool.query(
            "select count(*)::int n from drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(12);
      await migrateFixture(f.fixturePool);
      expect(
        (
          await f.fixturePool.query(
            "select count(*)::int n from drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(12);
      expect(await counts()).toEqual([1, 1, 5, 2, 0, 1, 1]);
      await complete(res.body.church.id);
    });
    it("AppModule exposes no general church, owner-transfer, role, member or review routes", async () => {
      for (const path of [
        "/churches/other",
        "/churches/other/roles",
        "/churches/other/members",
        "/churches/other/owner/transfer",
        "/churches/other/verification",
      ])
        await http()
          .post("/api/v1" + path)
          .set("Origin", origin)
          .set("Cookie", cookie)
          .send({})
          .expect(404);
      await http().get("/api/v1/churches").expect(404);
      await none();
    });
  });
}
