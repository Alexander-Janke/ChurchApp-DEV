import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import type { DatabaseService } from "../../src/database/database.service.js";
import { TenantDatabase } from "../../src/database/tenant-database.js";
import { TenantContext } from "../../src/database/tenant-context.js";
import {
  createTenantTestFixture,
  type TenantTestFixture,
} from "./tenant/database-fixture.js";
import {
  baseTenantFixtures,
  seedTenantFixtures,
} from "./tenant/tenant-fixtures.js";
import { migrateFixture } from "./tenant/migration-fixture.js";
import { assertRestrictedRole } from "./tenant/runtime-role.js";
import {
  assertRawRead,
  assertScopedResult,
  assertUnscopedResult,
  assertScopeMismatch,
  assertRejectedWrite,
  assertCommitIsolation,
  assertRollbackIsolation,
  assertFailureIsolation,
  assertConcurrentIsolation,
} from "./tenant/tenant-isolation.js";
import { ChurchRepository } from "../../src/church/church.repository.js";
import { ChurchService } from "../../src/church/church.service.js";

export function churchIntegrationTests() {
  describe("church tenant isolation with a restricted PostgreSQL login", () => {
    const base = baseTenantFixtures();
    const a = base.tenantA.churchId,
      b = base.tenantB.churchId;
    const A = base.tenantA.context,
      B = base.tenantB.context;
    let fixture: TenantTestFixture;
    let fixturePool: Pool, runtimePool: Pool;
    let runtimeDb: DatabaseService,
      tenants: TenantDatabase,
      service: ChurchService;
    let fixtureDb: DatabaseService;
    let roleName: string;
    const repository = new ChurchRepository();
    beforeAll(async () => {
      fixture = await createTenantTestFixture({
        protectedTables: ["church"],
        upgrade: {
          throughTag: "0002_user_profile",
          before: async (fixturePool) => {
            await fixturePool.query(
              'INSERT INTO "user"(id,name,email) VALUES ($1,$2,$3)',
              ["existing-user", "Existing", "existing@example.invalid"],
            );
            await fixturePool.query(
              "INSERT INTO user_profile(user_id,username) VALUES ($1,$2)",
              ["existing-user", "existing-profile"],
            );
            await fixturePool.query(
              "INSERT INTO email_change_request(id,user_id,initiating_session_id,current_email,new_email,status,expires_at,created_at,updated_at) VALUES ('existing-workflow','existing-user','snapshot','existing@example.invalid','next@example.invalid','superseded',now(),now(),now())",
            );
          },
        },
      });
      fixturePool = fixture.fixturePool;
      runtimePool = fixture.runtimePool;
      runtimeDb = fixture.runtimeDb;
      tenants = fixture.tenantDatabase;
      roleName = fixture.roleName;
      fixtureDb = fixture.fixtureDb;
      service = new ChurchService(tenants, repository);
    }, 30000);
    afterAll(async () => {
      await fixture?.dispose();
    });
    beforeEach(async () => {
      await seedTenantFixtures(fixturePool, base, { memberships: false });
    });
    const details = (name = "Updated A") => ({ name, slug: "church-a" });
    async function untouched() {
      expect(
        (await fixturePool.query("select id,name from church order by id"))
          .rows,
      ).toEqual(
        [
          { id: a, name: "Church A" },
          { id: b, name: "Church B" },
        ].sort((x, y) => x.id.localeCompare(y.id)),
      );
    }
    it("applies 0000 through 0004 and repeats without altering existing identity/profile/email-change data", async () => {
      const before = (
        await fixturePool.query(
          'SELECT row_to_json(u) u, row_to_json(p) p, row_to_json(e) e FROM "user" u JOIN user_profile p ON p.user_id=u.id JOIN email_change_request e ON e.user_id=u.id',
        )
      ).rows;
      expect(before).toHaveLength(1);
      expect(before[0].p.username).toBe("existing-profile");
      await migrateFixture(fixturePool);
      expect(
        (
          await fixturePool.query(
            'SELECT row_to_json(u) u, row_to_json(p) p, row_to_json(e) e FROM "user" u JOIN user_profile p ON p.user_id=u.id JOIN email_change_request e ON e.user_id=u.id',
          )
        ).rows,
      ).toEqual(before);
      expect(
        (
          await fixturePool.query(
            "select count(*)::int n from drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(6);
    });
    it("runs protected assertions under a non-owner login without superuser, BYPASSRLS or role-creation privileges", async () => {
      await fixture.assertRestrictedRole();
      const r = (
        await runtimePool.query(
          "select current_user, session_user, rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,pg_has_role(current_user,c.relowner,'MEMBER') owns from pg_roles cross join pg_class c where rolname=current_user and c.oid='church'::regclass",
        )
      ).rows[0];
      expect(r).toEqual({
        current_user: roleName,
        session_user: roleName,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        owns: false,
      });
    });
    it("enables and forces RLS with matching USING and WITH CHECK", async () => {
      const r = (
        await runtimePool.query(
          "select relrowsecurity,relforcerowsecurity from pg_class where oid='church'::regclass",
        )
      ).rows[0];
      expect(r).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const p = (
        await runtimePool.query(
          "select cmd,qual,with_check from pg_policies where tablename='church'",
        )
      ).rows;
      expect(p).toHaveLength(1);
      expect(p[0].cmd).toBe("ALL");
      expect(p[0].qual).toContain("app.current_church_id");
      expect(p[0].with_check).toBe(p[0].qual);
    });
    it("rejects migration/superuser credentials at the tenant transaction boundary", async () => {
      await expect(
        assertRestrictedRole(fixturePool, ["church"], roleName),
      ).rejects.toThrow("restricted LOGIN");
      await expect(
        new TenantDatabase(fixtureDb).transaction(A, (tx) =>
          tx.execute(sql`select id from church`),
        ),
      ).rejects.toThrow("Restricted tenant database role");
    });
    it.each([
      [A, a],
      [B, b],
    ] as const)(
      "reads only the explicitly scoped current church (%#)",
      async (context, id) => {
        expect((await service.getCurrentChurch(context))?.id).toBe(id);
        await assertRawRead(fixture, context, sql`select id from church`, [
          { id },
        ]);
      },
    );
    it("missing or invalid raw database context reads no churches", async () => {
      expect((await runtimePool.query("select id from church")).rows).toEqual(
        [],
      );
      await runtimeDb.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.current_church_id','invalid',true)`,
        );
        expect((await tx.execute(sql`select id from church`)).rows).toEqual([]);
      });
    });
    it("missing trusted application context rejects before queries", async () => {
      await expect(
        service.getCurrentChurch({ churchId: a } as TenantContext),
      ).rejects.toThrow("Trusted tenant context");
    });
    it("repository A under RLS B reads and changes neither", async () => {
      await assertScopeMismatch(
        fixture,
        A,
        B,
        async (scope, tx) => {
          expect(await repository.getCurrentChurch(scope, tx)).toBeNull();
          expect(
            await repository.updateCurrentChurch(scope, tx, details()),
          ).toBeNull();
        },
        untouched,
      );
    });
    it.each([
      [A, b],
      [B, a],
    ] as const)(
      "cannot update the other tenant (%#)",
      async (context, other) => {
        await assertScopedResult(
          fixture,
          context,
          async (tx) =>
            (
              await tx.execute(
                sql`update church set name='Forbidden' where id=${other} returning id`,
              )
            ).rows,
          [],
        );
        await untouched();
      },
    );
    it("updates current church through explicit repository without touching B", async () => {
      const row = await service.updateCurrentChurch(A, details());
      expect(row?.name).toBe("Updated A");
      expect((await service.getCurrentChurch(B))?.name).toBe("Church B");
    });
    it("missing context cannot update or delete protected rows", async () => {
      await assertUnscopedResult(
        fixture,
        async (db) =>
          (
            await db.db.execute(
              sql`update church set name='Forbidden' returning id`,
            )
          ).rows,
        [],
      );
      await assertUnscopedResult(
        fixture,
        async (db) =>
          (await db.db.execute(sql`delete from church returning id`)).rows,
        [],
      );
      await untouched();
    });
    it("missing context rejects inserts rather than creating an unscoped root", async () => {
      await expect(
        runtimePool.query(
          "insert into church(id,name,slug) values ($1,$2,$3)",
          [randomUUID(), "Blocked", "blocked-root"],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await untouched();
    });
    it("WITH CHECK rejects insertion for another tenant", async () => {
      await expect(
        tenants.transaction(A, (tx) =>
          tx.execute(
            sql`insert into church(id,name,slug) values (${randomUUID()},'Foreign','foreign-church')`,
          ),
        ),
      ).rejects.toThrow();
      await untouched();
    });
    it("WITH CHECK rejects changing the root ID to another scope", async () => {
      await assertRejectedWrite(
        fixture,
        A,
        (tx) =>
          tx.execute(sql`update church set id=${randomUUID()} where id=${a}`),
        untouched,
      );
    });
    it("repository refuses protected ID and verification-state mutation", async () => {
      await expect(
        service.updateCurrentChurch(A, { ...details(), id: b }),
      ).rejects.toThrow("Invalid church details");
      await expect(
        service.updateCurrentChurch(A, {
          ...details(),
          verificationState: "verified",
        }),
      ).rejects.toThrow("Invalid church details");
      await untouched();
    });
    it("raw broad delete under A cannot delete B", async () => {
      await tenants.transaction(A, async (tx) => {
        expect(
          (await tx.execute(sql`delete from church returning id`)).rows,
        ).toEqual([{ id: a }]);
      });
      expect((await service.getCurrentChurch(B))?.id).toBe(b);
    });
    it("runtime has no TRUNCATE privilege (which would bypass row filtering)", async () => {
      await expect(runtimePool.query("TRUNCATE church")).rejects.toMatchObject({
        code: "42501",
      });
      await untouched();
    });
    it("runtime cannot disable RLS", async () => {
      await expect(
        runtimePool.query("ALTER TABLE church DISABLE ROW LEVEL SECURITY"),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("commit clears context on the exact same pooled connection", async () => {
      await assertCommitIsolation(
        fixture,
        A,
        sql`select id from church`,
        async (tx) => {
          expect((await tx.execute(sql`select id from church`)).rows).toEqual([
            { id: a },
          ]);
        },
      );
    });
    it("rollback clears local context on a reused connection", async () => {
      await assertRollbackIsolation(fixture, A, sql`select id from church`, [
        { id: a },
      ]);
    });
    it("thrown callback error rolls back writes and leaves no context", async () => {
      await assertFailureIsolation(
        fixture,
        A,
        sql`select id from church`,
        async (tx) => {
          await repository.updateCurrentChurch(A, tx, details());
          throw new Error("intentional tenant rollback");
        },
        untouched,
        "intentional tenant rollback",
      );
    });
    it("database error leaves no context or borrowed client", async () => {
      await assertFailureIsolation(
        fixture,
        A,
        sql`select id from church`,
        async (tx) => {
          await repository.updateCurrentChurch(A, tx, details());
          await tx.execute(sql`select 1/0`);
        },
        untouched,
      );
    });
    it("concurrent A/B transactions have separate connections and contexts", async () => {
      await assertConcurrentIsolation(
        fixture,
        A,
        B,
        sql`select id from church`,
        [{ id: a }],
        [{ id: b }],
      );
    });
    it("repository predicate independently limits reads/writes even with an owner fixture connection", async () => {
      // Explicitly NOT an RLS assertion; verifies the independent WHERE layer.
      await fixtureDb.transaction(async (tx) => {
        expect((await repository.getCurrentChurch(A, tx))?.id).toBe(a);
        await repository.updateCurrentChurch(A, tx, details());
      });
      expect(
        (await fixturePool.query("select name from church where id=$1", [b]))
          .rows[0].name,
      ).toBe("Church B");
    });
    it("canonical slug uniqueness blocks conflicting updates", async () => {
      await expect(
        service.updateCurrentChurch(B, { name: "B", slug: "CHURCH-A" }),
      ).rejects.toThrow();
      await untouched();
    });
    it.each([
      ["slug", "UPPER"],
      ["slug", "ab"],
      ["slug", "x".repeat(64)],
      ["status", "deleted"],
      ["verification_state", "approved"],
      ["country_code", "de"],
      ["name", " "],
    ])("database rejects invalid %s (%#)", async (column, value) => {
      // Column comes only from the fixed test list, not external input.
      await expect(
        fixturePool.query(`update church set "${column}"=$1 where id=$2`, [
          value,
          a,
        ]),
      ).rejects.toThrow();
    });
    it("defaults distinguish lifecycle from verification state", async () => {
      const row = await service.getCurrentChurch(A);
      expect(row?.status).toBe("active");
      expect(row?.verificationState).toBe("unverified");
      expect(row?.createdAt).toBeInstanceOf(Date);
    });
  });
}
