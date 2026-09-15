import { SessionAuthorizationService } from "../../src/authorization/session-authorization.service.js";
import "reflect-metadata";
import { randomUUID, randomBytes } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AuthService } from "@thallesp/nestjs-better-auth";
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
import request from "supertest";
import { sql } from "drizzle-orm";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { AuthEmailSender } from "../../src/auth/auth-email.js";
import type { createBetterAuth } from "../../src/auth/auth.config.js";
import { DatabaseService } from "../../src/database/database.service.js";
import { DATABASE_POOL } from "../../src/database/database.constants.js";
import { TenantContext } from "../../src/database/tenant-context.js";
import { SessionAssuranceService } from "../../src/auth/session-assurance.service.js";
import {
  AssurancePolicy,
  ELEVATION_IDLE_MS,
  ELEVATION_MAX_MS,
} from "../../src/auth/assurance-policy.js";
import { AdminMutationLimiter } from "../../src/church-admin/admin-limiter.js";
import { AdminAuditRepository } from "../../src/church-admin/admin-audit.repository.js";
import { AuthorizationRepository } from "../../src/authorization/authorization.repository.js";
import { StandardRoleService } from "../../src/authorization/standard-role.service.js";
import { standardRoleId } from "../../src/authorization/standard-roles.js";
import {
  createTenantTestFixture,
  type TenantTestFixture,
} from "./tenant/database-fixture.js";
import {
  baseTenantFixtures,
  seedTenantFixtures,
} from "./tenant/tenant-fixtures.js";
import { migrateFixture } from "./tenant/migration-fixture.js";
import { TestAuthEmailSender } from "./auth-email.js";
import { issueTestAssurance } from "./assurance.integration.js";

export function churchAdminIntegrationTests() {
  describe("Task 1.20 administration HTTP and audit", () => {
    const origin = "http://localhost:3001",
      password = "admin-test-only long password",
      sender = new TestAuthEmailSender();
    const A = TenantContext.fromAuthorizedScope(randomUUID()),
      B = TenantContext.fromAuthorizedScope(randomUUID());
    const memberId = randomUUID(),
      otherId = randomUUID(),
      otherMember = randomUUID(),
      roleId = standardRoleId(A, "main_church_administrator");
    const tables = [
      "church",
      "church_membership",
      "church_role",
      "church_role_permission",
      "church_membership_role",
      "church_primary_owner",
      "church_ownership_audit",
      "church_admin_audit",
    ];
    let f: TenantTestFixture,
      app: NestExpressApplication,
      auth: ReturnType<typeof createBetterAuth>,
      cookie: string,
      second: string,
      userId: string,
      sessionId: string,
      now: number,
      limiter: AdminMutationLimiter;
    let migratedPreservation = false;
    beforeAll(async () => {
      const preserved = baseTenantFixtures();
      let snapshot = "";
      const preservedTables = [
        "user",
        "account",
        "session",
        "church",
        "church_membership",
        "church_role",
        "church_role_permission",
        "church_membership_role",
        "church_primary_owner",
        "church_ownership_audit",
      ];
      const snap = async (pool: TenantTestFixture["fixturePool"]) =>
        JSON.stringify(
          await Promise.all(
            preservedTables.map(
              async (t) => (await pool.query('SELECT * FROM "' + t + '"')).rows,
            ),
          ),
        );
      f = await createTenantTestFixture({
        protectedTables: tables,
        upgrade: {
          throughTag: "0009_primary_owner_foundation",
          before: async (pool) => {
            await seedTenantFixtures(pool, preserved, { memberships: true });
            const u = preserved.userA.userId,
              c = preserved.tenantA.churchId,
              m = preserved.relationshipA.id;
            await pool.query(
              "insert into account(id,account_id,provider_id,user_id,created_at,updated_at) values('preserved-account',$1,'credential',$1,now(),now())",
              [u],
            );
            await pool.query(
              "insert into session(id,user_id,token,expires_at,updated_at) values('preserved-session',$1,$2,now()+interval '1 day',now())",
              [u, randomBytes(32).toString("hex")],
            );
            await pool.query(
              "insert into church_role(id,church_id,name) values('preserved-role',$1,'Preserved')",
              [c],
            );
            await pool.query(
              "insert into church_role_permission(church_id,role_id,permission) values($1,'preserved-role','members.manage')",
              [c],
            );
            await pool.query(
              "insert into church_membership_role(church_id,role_id,membership_id) values($1,'preserved-role',$2)",
              [c, m],
            );
            await pool.query(
              "insert into church_primary_owner(church_id,membership_id) values($1,$2)",
              [c, m],
            );
            await pool.query(
              "insert into church_ownership_audit(id,church_id,event_type,new_owner_membership_id,actor_user_id,actor_session_id) values('preserved-audit',$1,'initial_owner_established',$2,$3,'preserved-session')",
              [c, m, u],
            );
            snapshot = await snap(pool);
          },
          after: async (pool) => {
            migratedPreservation = snapshot === (await snap(pool));
          },
        },
      });
      await f.fixturePool.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON "user",account,session,verification,two_factor,two_factor_enrollment,session_assurance,email_change_request,user_profile TO "${f.roleName}"`,
      );
      await f.fixturePool.query(
        `GRANT INSERT ON auth_security_event TO "${f.roleName}"`,
      );
      vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("hex"));
      vi.stubEnv("BETTER_AUTH_URL", origin);
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DATABASE_POOL)
        .useValue(f.concurrentPool)
        .overrideProvider(DatabaseService)
        .useValue(f.concurrentDb)
        .overrideProvider(AuthEmailSender)
        .useValue(sender)
        .overrideProvider(SessionAssuranceService)
        .useValue(
          new SessionAssuranceService(
            f.concurrentDb,
            new AssurancePolicy(() => now),
          ),
        )
        .overrideProvider(AdminMutationLimiter)
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
    }, 30000);
    afterAll(async () => {
      try {
        await app?.close();
      } finally {
        await f?.dispose();
        vi.unstubAllEnvs();
      }
    });
    const http = () => request(app.getHttpServer());
    function credential(res: request.Response) {
      const all = res.headers["set-cookie"] as unknown;
      const c = (Array.isArray(all) ? all : [])
        .find(
          (v: string) =>
            v.startsWith("better-auth.session_token=") &&
            !v.includes("Max-Age=0"),
        )
        ?.split(";")[0];
      if (!c) throw new Error("Expected test session");
      return c as string;
    }
    beforeEach(async () => {
      limiter = new AdminMutationLimiter();
      sender.reset();
      await f.fixturePool.query('TRUNCATE church,"user" CASCADE');
      const email = randomUUID() + "@example.invalid";
      const signup = await http()
        .post("/api/v1/auth/sign-up/email")
        .set("Origin", origin)
        .send({ name: "Admin fixture", email, password });
      expect(signup.status).toBe(200);
      userId = signup.body.user.id;
      const url = new URL(sender.messages.at(-1)!.url);
      expect([200, 302]).toContain(
        (await http().get(url.pathname + url.search)).status,
      );
      const login = async () =>
        http()
          .post("/api/v1/auth/sign-in/email")
          .set("Origin", origin)
          .send({ email, password });
      cookie = credential(await login());
      second = credential(await login());
      const current = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      sessionId = current!.session.id;
      // Explicit disposable test fixtures only. Native factor/proof routes retain their existing regression suites.
      await f.fixturePool.query(
        'UPDATE "user" SET two_factor_enabled=true WHERE id=$1',
        [userId],
      );
      await f.fixturePool.query(
        "insert into two_factor(id,user_id,secret,backup_codes,verified) values($1,$2,$3,$4,true)",
        [
          randomUUID(),
          userId,
          randomBytes(32).toString("hex"),
          randomBytes(32).toString("hex"),
        ],
      );
      now = Date.now();
      await f.fixturePool.query(
        "update session set created_at=$2 where user_id=$1",
        [userId, new Date(now - 2 * 86400000)],
      );
      await issueTestAssurance(f.fixturePool, sessionId, new Date(now - 60000));
      await f.fixturePool.query(
        `insert into "user"(id,name,email) values($1,'Other','other@example.invalid')`,
        [otherId],
      );
      await f.fixturePool.query(
        "insert into church(id,name,slug) values($1,'Church A','church-a'),($2,'Church B','church-b')",
        [A.churchId, B.churchId],
      );
      await f.fixturePool.query(
        "insert into church_membership(id,church_id,user_id,status) values($1,$2,$3,'member'),($4,$5,$6,'member')",
        [memberId, A.churchId, userId, otherMember, B.churchId, otherId],
      );
      const repo = new AuthorizationRepository();
      await new StandardRoleService(f.tenantDatabase, repo).ensureStandardRoles(
        A,
      );
      await f.withTenant(A, (tx) => repo.assignRole(A, tx, memberId, roleId));
    });
    afterEach(async () => {
      await sender.onModuleDestroy();
      vi.restoreAllMocks();
    });
    const patch = (
      body: object = { name: "Changed" },
      c = cookie,
      churchId = A.churchId,
    ) =>
      http()
        .patch(`/api/v1/churches/${churchId}/settings`)
        .set("Origin", origin)
        .set("Cookie", c)
        .send(body);
    const get = (c = cookie, churchId = A.churchId) =>
      http().get(`/api/v1/churches/${churchId}/members`).set("Cookie", c);
    const audit = async () =>
      (
        await f.fixturePool.query(
          "select * from church_admin_audit order by id",
        )
      ).rows;
    const settings = async () =>
      (
        await f.fixturePool.query("select * from church where id=$1", [
          A.churchId,
        ])
      ).rows[0];
    const activity = async () =>
      (
        await f.fixturePool.query(
          "select last_elevated_activity_at,elevated_at,step_up_at from session_assurance where session_id=$1",
          [sessionId],
        )
      ).rows[0];
    const both = async (status: number, c = cookie) => {
      expect((await patch({}, c)).status).toBe(status === 200 ? 400 : status);
      expect((await get(c)).status).toBe(status);
    };
    it("clean migration through 0010 and upgrade preserve auth/tenant/owner evidence; repeat is idempotent", async () => {
      expect(migratedPreservation).toBe(true);
      const before = (
        await f.fixturePool.query(
          "select * from drizzle.__drizzle_migrations order by id",
        )
      ).rows;
      expect(before).toHaveLength(12);
      await patch().expect(200);
      const old = JSON.stringify([await settings(), await audit()]);
      await migrateFixture(f.fixturePool);
      expect(
        (
          await f.fixturePool.query(
            "select * from drizzle.__drizzle_migrations order by id",
          )
        ).rows,
      ).toEqual(before);
      expect(JSON.stringify([await settings(), await audit()]) === old).toBe(
        true,
      );
    });
    it("valid PATCH atomically records one value-free audit and elevation activity, preserving proof/session", async () => {
      const before = await activity();
      const sessions = (
        await f.fixturePool.query(
          "select id,created_at from session order by id",
        )
      ).rows;
      const r = await patch({
        name: " New name ",
        locality: " Berlin ",
      }).expect(200);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.body).toMatchObject({
        id: A.churchId,
        name: "New name",
        locality: "Berlin",
        status: "active",
        verificationState: "unverified",
      });
      const rows = await audit();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        church_id: A.churchId,
        event_type: "church_settings_updated",
        actor_user_id: userId,
        actor_session_id: sessionId,
        changed_fields: ["locality", "name"],
      });
      expect(Object.keys(rows[0]).sort()).toEqual(
        [
          "id",
          "church_id",
          "event_type",
          "actor_user_id",
          "actor_session_id",
          "changed_fields",
          "created_at",
        ].sort(),
      );
      expect(await activity()).toEqual({
        ...before,
        last_elevated_activity_at: new Date(now),
      });
      expect(
        (
          await f.fixturePool.query(
            "select id,created_at from session order by id",
          )
        ).rows,
      ).toEqual(sessions);
    });
    it("read-only list is minimal, bounded, no private joins and no elevation refresh", async () => {
      const old = await activity();
      const r = await get().expect(200);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.body).toEqual({
        items: [{ id: memberId, userId, status: "member" }],
        nextCursor: null,
      });
      expect(await activity()).toEqual(old);
      expect(await audit()).toHaveLength(0);
      const first = await get().query({ limit: "1" }).expect(200);
      expect(first.body.nextCursor).toBe(memberId);
      expect(
        (await get().query({ after: memberId }).expect(200)).body.items,
      ).toEqual([]);
    });
    it.each(["missing", "revoked", "expired", "absolute"])(
      "%s session returns 401 on both routes",
      async (kind) => {
        if (kind === "revoked")
          await f.fixturePool.query("delete from session where id=$1", [
            sessionId,
          ]);
        if (kind === "expired")
          await f.fixturePool.query(
            "update session set expires_at=now()-interval '1 second' where id=$1",
            [sessionId],
          );
        if (kind === "absolute")
          await f.fixturePool.query(
            "update session set created_at=now()-interval '30 days' where id=$1",
            [sessionId],
          );
        await both(401, kind === "missing" ? "" : cookie);
      },
    );
    it.each([
      "permission",
      "factor",
      "factorUnverified",
      "elevation",
      "second",
      "inactive",
      "follower",
      "left",
    ])("%s denied on both routes without audit or activity", async (kind) => {
      if (kind === "permission")
        await f.fixturePool.query(
          "delete from church_membership_role where membership_id=$1",
          [memberId],
        );
      if (kind === "factor")
        await f.fixturePool.query(
          'update "user" set two_factor_enabled=false where id=$1',
          [userId],
        );
      if (kind === "factorUnverified")
        await f.fixturePool.query(
          "update two_factor set verified=false where user_id=$1",
          [userId],
        );
      if (kind === "elevation")
        await f.fixturePool.query(
          "delete from session_assurance where session_id=$1",
          [sessionId],
        );
      if (["inactive", "follower", "left"].includes(kind))
        await f.fixturePool.query(
          "update church_membership set status=$2 where id=$1",
          [memberId, kind],
        );
      const old = await activity();
      expect(
        (await patch({ name: "Denied" }, kind === "second" ? second : cookie))
          .status,
      ).toBe(403);
      expect((await get(kind === "second" ? second : cookie)).status).toBe(403);
      expect(await activity()).toEqual(old);
      expect(await audit()).toHaveLength(0);
    });
    it.each([
      "idle-before",
      "idle-exact",
      "idle-after",
      "absolute-before",
      "absolute-exact",
      "absolute-after",
    ])("deterministic %s elevation boundary on both routes", async (kind) => {
      const absolute = kind.startsWith("absolute"),
        age =
          (absolute ? ELEVATION_MAX_MS : ELEVATION_IDLE_MS) +
          (kind.endsWith("before") ? -1 : kind.endsWith("after") ? 1 : 0);
      await f.fixturePool.query(
        "update session_assurance set elevated_at=$2,last_elevated_activity_at=$3,step_up_at=null where session_id=$1",
        [
          sessionId,
          new Date(now - age),
          new Date(absolute ? now - 60000 : now - age),
        ],
      );
      const expected = kind.endsWith("before") ? 200 : 403;
      expect((await get()).status).toBe(expected);
      expect((await patch()).status).toBe(expected);
    });
    it("no recent step-up required; custom role uses identical permission checks", async () => {
      await f.fixturePool.query(
        "update session_assurance set step_up_at=null where session_id=$1",
        [sessionId],
      );
      const repo = new AuthorizationRepository();
      await f.withTenant(A, async (tx) => {
        await repo.removeRole(A, tx, memberId, roleId);
        await tx.execute(
          sql`insert into church_role(id,church_id,name) values('custom',${A.churchId},'Custom')`,
        );
        await tx.execute(
          sql`insert into church_role_permission(church_id,role_id,permission) values(${A.churchId},'custom','members.manage'),(${A.churchId},'custom','church.settings.manage')`,
        );
        await repo.assignRole(A, tx, memberId, "custom");
      });
      await get().expect(200);
      await patch().expect(200);
    });
    it("permission keys are independent, not role-name authorization", async () => {
      await f.fixturePool.query(
        "delete from church_role_permission where permission='church.settings.manage'",
      );
      await get().expect(200);
      await patch().expect(403);
      await f.fixturePool.query(
        "update church_role_permission set permission='church.settings.manage'",
      );
      await get().expect(403);
      await patch().expect(200);
    });
    it("Primary Owner alone grants neither permission", async () => {
      await f.fixturePool.query(
        "insert into church_primary_owner(church_id,membership_id) values($1,$2)",
        [A.churchId, memberId],
      );
      await f.fixturePool.query("delete from church_membership_role");
      await get().expect(403);
      await patch().expect(403);
    });
    it("foreign and nonexistent tenant IDs have indistinguishable denial", async () => {
      const before = (
        await f.fixturePool.query("select * from church where id=$1", [
          B.churchId,
        ])
      ).rows;
      const responses = await Promise.all([
        get(cookie, B.churchId),
        get(cookie, randomUUID()),
        patch({ name: "Attack" }, cookie, B.churchId),
        patch({ name: "Attack" }, cookie, randomUUID()),
      ]);
      for (const r of responses) {
        expect(r.status).toBe(403);
        expect(r.body).toEqual(responses[0]!.body);
      }
      expect(
        (
          await f.fixturePool.query("select * from church where id=$1", [
            B.churchId,
          ])
        ).rows,
      ).toEqual(before);
      expect(await audit()).toHaveLength(0);
    });
    it.each([undefined, "https://attacker.invalid", origin + "/"])(
      "PATCH rejects non-exact Origin %#",
      async (o) => {
        const before = await activity();
        let r = http()
          .patch(`/api/v1/churches/${A.churchId}/settings`)
          .set("Cookie", cookie);
        if (o) r = r.set("Origin", o);
        expect((await r.send({ name: "Denied" })).status).toBe(403);
        expect(await activity()).toEqual(before);
        expect(await audit()).toHaveLength(0);
      },
    );
    it.each([
      "id",
      "status",
      "verificationState",
      "owner",
      "ownerMembershipId",
      "primaryOwner",
      "roles",
      "permissions",
      "security",
      "twoFactorEnabled",
      "userId",
      "sessionId",
    ])("rejects protected settings %s", async (key) => {
      const before = await activity();
      await patch({ name: "Attempt", [key]: "injected" }).expect(400);
      expect(await activity()).toEqual(before);
      expect(await audit()).toHaveLength(0);
    });
    it.each([
      {},
      { name: " " },
      { slug: "!!" },
      { countryCode: "de" },
      { logo: "https://user:password@example.invalid/logo" },
      { addressLine1: 123 },
    ])("invalid PATCH %# leaves no audit/activity", async (input) => {
      const before = await activity();
      await patch(input).expect(400);
      expect(await activity()).toEqual(before);
      expect(await audit()).toHaveLength(0);
    });
    it("slug conflict safely rolls back and does not refresh activity or leak SQL", async () => {
      const before = await activity();
      const r = await patch({ slug: "CHURCH-B" }).expect(409);
      expect(r.body.message).toBe("Church slug is unavailable");
      expect((await settings()).slug).toBe("church-a");
      expect(await activity()).toEqual(before);
      expect(await audit()).toHaveLength(0);
    });
    it("partial/concurrent updates preserve omitted fields and null clears explicitly", async () => {
      const res = await Promise.all([
        patch({ name: "New" }),
        patch({ locality: "Town", logo: "https://example.invalid/logo" }),
      ]);
      expect(res.map((r) => r.status)).toEqual([200, 200]);
      expect(await settings()).toMatchObject({
        name: "New",
        locality: "Town",
        logo: "https://example.invalid/logo",
      });
      await patch({ logo: null }).expect(200);
      expect(await settings()).toMatchObject({
        name: "New",
        locality: "Town",
        logo: null,
      });
      expect(await audit()).toHaveLength(3);
    });
    it("no-op PATCH changes no timestamp, audit or assurance", async () => {
      const before = await settings(),
        old = await activity();
      await patch({ name: "Church A" }).expect(200);
      expect(await settings()).toEqual(before);
      expect(await activity()).toEqual(old);
      expect(await audit()).toHaveLength(0);
    });
    it("forced PostgreSQL audit insert failure rolls back settings and activity", async () => {
      const before = await settings(),
        old = await activity();
      await f.fixturePool.query(
        `ALTER TABLE church_admin_audit ADD CONSTRAINT admin_test_failure CHECK(false)`,
      );
      try {
        const r = await patch().expect(503);
        expect(r.body.message).toBe("Church administration unavailable");
        expect(await settings()).toEqual(before);
        expect(await activity()).toEqual(old);
        expect(await audit()).toHaveLength(0);
      } finally {
        await f.fixturePool.query(
          "ALTER TABLE church_admin_audit DROP CONSTRAINT admin_test_failure",
        );
      }
    });
    it("assurance activity failure after audit insertion rolls back both business writes", async () => {
      const before = await settings(),
        old = await activity();
      vi.spyOn(
        app.get(SessionAssuranceService),
        "recordSuccessfulPrivilegedActivityInTransaction",
      ).mockRejectedValueOnce(new Error("simulated private failure"));
      await patch().expect(503);
      expect(await settings()).toEqual(before);
      expect(await audit()).toHaveLength(0);
      expect(await activity()).toEqual(old);
    });
    it("rate limits mutations conservatively without affecting member reads", async () => {
      for (let i = 0; i < 20; i++)
        await patch({ name: "Church A" }).expect(200);
      await patch().expect(429);
      await get().expect(200);
      expect(await audit()).toHaveLength(0);
    });
    it("query injection/pagination rejects unknown selectors and invalid bounds", async () => {
      await get().query({ userId: otherId }).expect(400);
      await get().query({ limit: 101 }).expect(400);
      await patch().query({ userId: otherId }).expect(400);
      await get(cookie, "bad-id").expect(400);
    });
    it.each([
      "patch-members",
      "post-members",
      "delete-member",
      "role",
      "owner",
      "delete-church",
    ])("unsupported %s mutation has no route", async (kind) => {
      const base = `/api/v1/churches/${A.churchId}`;
      const r =
        kind === "patch-members"
          ? http().patch(base + "/members/" + memberId)
          : kind === "post-members"
            ? http().post(base + "/members")
            : kind === "delete-member"
              ? http().delete(base + "/members/" + memberId)
              : kind === "role"
                ? http().post(base + "/members/" + memberId + "/roles")
                : kind === "owner"
                  ? http().post(base + "/owner")
                  : http().delete(base);
      await r
        .set("Cookie", cookie)
        .set("Origin", origin)
        .send({ status: "left" })
        .expect(404);
      expect(
        (
          await f.fixturePool.query(
            "select status from church_membership where id=$1",
            [memberId],
          )
        ).rows[0].status,
      ).toBe("member");
    });
    it("admin audit uses restricted runtime RLS, no-context and mismatched scopes deny", async () => {
      await patch().expect(200);
      await f.assertRestrictedRole();
      const repo = new AdminAuditRepository();
      expect(
        (await f.runtimePool.query("select * from church_admin_audit")).rows,
      ).toEqual([]);
      expect(await f.withTenant(B, (tx) => repo.list(A, tx))).toEqual([]);
      expect(await f.withTenant(B, (tx) => repo.list(B, tx))).toEqual([]);
      await expect(
        f.withTenant(B, (tx) =>
          repo.appendSettingsUpdated(A, tx, { userId, sessionId }, ["name"]),
        ),
      ).rejects.toThrow();
      expect(await audit()).toHaveLength(1);
      await expect(
        f.runtimePool.query(
          "insert into church_admin_audit(id,church_id,event_type,actor_user_id,actor_session_id,changed_fields) values($1,$2,'church_settings_updated',$3,$4,ARRAY['name'])",
          [randomUUID(), A.churchId, userId, sessionId],
        ),
      ).rejects.toThrow();
    });
    it.each(["revoked-permission", "expired-elevation"])(
      "rechecks %s after waiting for church lock",
      async (kind) => {
        const blocker = await f.fixturePool.connect();
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM church WHERE id=$1 FOR UPDATE", [
          A.churchId,
        ]);
        let release!: () => void;
        const preliminary = new Promise<void>((resolve) => {
          release = resolve;
        });
        const evaluator = app.get(SessionAuthorizationService);
        const original = evaluator.isAuthorizedInTransaction.bind(evaluator);
        vi.spyOn(evaluator, "isAuthorizedInTransaction").mockImplementation(
          async (...args) => {
            const result = await original(...args);
            if (!args[4]) release();
            return result;
          },
        );
        const old = await activity();
        const response = patch().then((r) => r);
        try {
          await preliminary;
          if (kind === "revoked-permission")
            await f.fixturePool.query(
              "DELETE FROM church_role_permission WHERE church_id=$1 AND permission='church.settings.manage'",
              [A.churchId],
            );
          else now += ELEVATION_IDLE_MS;
          await blocker.query("COMMIT");
          expect((await response).status).toBe(403);
          expect((await settings()).name).toBe("Church A");
          expect(await audit()).toHaveLength(0);
          expect(await activity()).toEqual(old);
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
          await response;
        }
      },
    );
    it("a locked foreign church is still an indistinguishable 403", async () => {
      const blocker = await f.fixturePool.connect();
      await blocker.query("BEGIN");
      try {
        await blocker.query("SELECT id FROM church WHERE id=$1 FOR UPDATE", [
          B.churchId,
        ]);
        await patch({ name: "Denied" }, cookie, B.churchId).expect(403);
        await get(cookie, B.churchId).expect(403);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
    });
    it("audit is append-only even with runtime table CRUD grants", async () => {
      await patch().expect(200);
      const before = await audit();
      await f.withTenant(A, async (tx) => {
        expect(
          (
            await tx.execute(
              sql`update church_admin_audit set event_type='church_settings_updated' returning id`,
            )
          ).rows,
        ).toEqual([]);
        expect(
          (await tx.execute(sql`delete from church_admin_audit returning id`))
            .rows,
        ).toEqual([]);
      });
      expect(await audit()).toEqual(before);
    });
    it("audit survives actor membership, session and user deletion", async () => {
      await patch().expect(200);
      const before = await audit();
      await f.fixturePool.query("delete from church_membership where id=$1", [
        memberId,
      ]);
      expect(await audit()).toEqual(before);
      await f.fixturePool.query('delete from "user" where id=$1', [userId]);
      expect(await audit()).toEqual(before);
    });
  });
}
