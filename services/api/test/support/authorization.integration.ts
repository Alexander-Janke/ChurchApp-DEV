import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { AuthorizationRepository } from "../../src/authorization/authorization.repository.js";
import { AuthorizationService } from "../../src/authorization/authorization.service.js";
import { MembershipRepository } from "../../src/membership/membership.repository.js";
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
import {
  assertNoContext,
  assertRawRead,
  assertScopeMismatch,
  assertCommitIsolation,
  assertRollbackIsolation,
  assertFailureIsolation,
  assertConcurrentIsolation,
  assertRejectedWrite,
} from "./tenant/tenant-isolation.js";

export function authorizationIntegrationTests() {
  describe("tenant authorization through restricted runtime and composite foreign keys", () => {
    const base = baseTenantFixtures();
    const A = base.tenantA.context,
      B = base.tenantB.context;
    const a = A.churchId,
      b = B.churchId;
    const ma = base.relationshipA.id,
      mb = base.relationshipB.id;
    const ra = randomUUID(),
      rb = randomUUID();
    const repository = new AuthorizationRepository();
    const memberships = new MembershipRepository();
    const tables = [
      "church",
      "church_membership",
      "church_role",
      "church_role_permission",
      "church_membership_role",
    ] as const;
    const authzTables = tables.slice(2);
    let fixture: TenantTestFixture;
    let service: AuthorizationService;
    let preserved = false;
    let preservationBefore: unknown;
    const preservationQuery =
      "select (to_jsonb(u)-'two_factor_enabled') u,row_to_json(p) p,row_to_json(e) e,row_to_json(c) c,row_to_json(m) m from \"user\" u join user_profile p on p.user_id=u.id join email_change_request e on e.user_id=u.id join church_membership m on m.user_id=u.id join church c on c.id=m.church_id";
    beforeAll(async () => {
      fixture = await createTenantTestFixture({
        protectedTables: tables,
        upgrade: {
          throughTag: "0004_tenant_membership_foundation",
          before: async (pool) => {
            await seedTenantFixtures(pool, base, { memberships: true });
            await pool.query(
              "insert into user_profile(user_id,username) values($1,'preserved')",
              [base.userA.userId],
            );
            await pool.query(
              "insert into email_change_request(id,user_id,initiating_session_id,current_email,new_email,status,expires_at,created_at,updated_at) values('preserved',$1,'snapshot','old@example.invalid','new@example.invalid','superseded',now(),now(),now())",
              [base.userA.userId],
            );
            preservationBefore = (await pool.query(preservationQuery)).rows;
          },
          after: async (pool) => {
            expect((await pool.query(preservationQuery)).rows).toEqual(
              preservationBefore,
            );
            preserved = true;
          },
        },
      });
      service = new AuthorizationService(fixture.tenantDatabase, repository);
    }, 30000);
    afterAll(async () => {
      await fixture?.dispose();
    });
    beforeEach(async () => {
      await seedTenantFixtures(fixture.fixturePool, base, {
        memberships: true,
      });
      await fixture.fixturePool.query(
        "insert into church_role(id,church_id,name) values($1,$2,'Readers'),($3,$4,'Readers')",
        [ra, a, rb, b],
      );
      await fixture.fixturePool.query(
        "insert into church_role_permission(church_id,role_id,permission) values($1,$2,'members.view'),($1,$2,'events.create'),($3,$4,'members.view'),($3,$4,'events.create')",
        [a, ra, b, rb],
      );
      await fixture.fixturePool.query(
        "insert into church_membership_role(church_id,membership_id,role_id) values($1,$2,$3),($4,$5,$6)",
        [a, ma, ra, b, mb, rb],
      );
    });
    const change = (
      context: TenantContext,
      id: string,
      expected: string,
      next: string,
    ) =>
      fixture.withTenant(context, (tx) =>
        memberships.changeRelationshipStatus(context, tx, id, expected, next),
      );
    const broad = (table: string) =>
      sql.raw('select church_id from "' + table + '" order by church_id');
    const state = async () => {
      const rows = [];
      for (const table of authzTables)
        rows.push(
          (
            await fixture.fixturePool.query(
              'select * from "' +
                table +
                '" order by church_id,role_id'.replace(
                  ",role_id",
                  table === "church_role" ? ",id" : ",role_id",
                ),
            )
          ).rows,
        );
      return rows;
    };
    it("applies 0000 through 0006, preserving auth/profile/email-change/church/membership data, and repeats safely", async () => {
      expect(preserved).toBe(true);
      const before = await state();
      await migrateFixture(fixture.fixturePool);
      expect(await state()).toEqual(before);
      expect(
        (
          await fixture.fixturePool.query(
            "select count(*)::int n from drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(7);
    });
    it("asserts all five tables against the real restricted runtime login", async () => {
      await fixture.assertRestrictedRole();
    });
    it.each([
      "church_role",
      "church_role_permission",
      "church_membership_role",
    ])(
      "enforces missing context and broad scoped RLS reads for %s",
      async (table) => {
        const copies = table === "church_role_permission" ? 2 : 1;
        await assertRawRead(
          fixture,
          A,
          broad(table),
          Array.from({ length: copies }, () => ({ church_id: a })),
        );
        await assertRawRead(
          fixture,
          B,
          broad(table),
          Array.from({ length: copies }, () => ({ church_id: b })),
        );
        const policies = (
          await fixture.fixturePool.query(
            "select cmd,qual,with_check from pg_policies where tablename=$1",
            [table],
          )
        ).rows;
        expect(policies).toHaveLength(1);
        expect(policies[0].cmd).toBe("ALL");
        expect(policies[0].qual).toContain("app.current_church_id");
        expect(policies[0].with_check).toBe(policies[0].qual);
      },
    );
    it.each([
      "church_role",
      "church_role_permission",
      "church_membership_role",
    ])("fails runtime guard if FORCE RLS is removed from %s", async (table) => {
      await fixture.fixturePool.query(
        'alter table "' + table + '" no force row level security',
      );
      try {
        await expect(
          service.hasPermission(A, ma, "members.view"),
        ).rejects.toThrow("Authorization evaluation failed");
      } finally {
        await fixture.fixturePool.query(
          'alter table "' + table + '" force row level security',
        );
      }
    });
    it("rejects privileged migration credentials at the runtime boundary", async () => {
      const unsafe = new AuthorizationService(
        new TenantDatabase(fixture.fixtureDb),
        repository,
      );
      await expect(unsafe.hasPermission(A, ma, "members.view")).rejects.toThrow(
        "Authorization evaluation failed",
      );
    });
    it("rejects forged context before querying", async () => {
      await expect(
        service.hasPermission(
          { churchId: a } as TenantContext,
          ma,
          "members.view",
        ),
      ).rejects.toThrow();
    });
    it("scopes role read, listing and rename to the tenant even with known foreign IDs", async () => {
      await fixture.withTenant(B, async (tx) => {
        expect(await repository.getRole(B, tx, ra)).toBeNull();
        expect((await repository.listRoles(B, tx)).map((r) => r.id)).toEqual([
          rb,
        ]);
        expect(await repository.renameRole(B, tx, ra, "stolen")).toBeNull();
        expect(await repository.deleteRole(B, tx, ra)).toBe(false);
      });
    });
    it("mismatched repository A / database B denies reads, writes and evaluation", async () => {
      const before = await state();
      await assertScopeMismatch(
        fixture,
        A,
        B,
        async (scope, tx) => {
          expect(await repository.getRole(scope, tx, ra)).toBeNull();
          expect(await repository.listRoles(scope, tx)).toEqual([]);
          expect(await repository.listMembershipRoles(scope, tx, ma)).toEqual(
            [],
          );
          expect(
            await repository.hasPermission(scope, tx, ma, "members.view"),
          ).toBe(false);
          expect(
            await repository.renameRole(scope, tx, ra, "mismatch"),
          ).toBeNull();
          expect(await repository.deleteRole(scope, tx, ra)).toBe(false);
          expect(
            await repository.addRolePermission(scope, tx, rb, "members.view"),
          ).toBe(false);
          expect(await repository.assignRole(scope, tx, ma, rb)).toBe(false);
          expect(await repository.removeRole(scope, tx, ma, ra)).toBe(false);
        },
        async () => {
          expect(await state()).toEqual(before);
        },
      );
    });
    it("creates custom roles only and normalizes labels without role-name privileges", async () => {
      const row = await fixture.withTenant(A, (tx) =>
        repository.createRole(A, tx, {
          name: "  Administrator  ",
          description: "label only",
        }),
      );
      expect(row.name).toBe("Administrator");
      expect(row.isSystem).toBe(false);
      await fixture.withTenant(A, (tx) =>
        repository.assignRole(A, tx, ma, row.id),
      );
      expect(await service.hasPermission(A, ma, "roles.manage")).toBe(false);
    });
    it("enforces case-insensitive name uniqueness per church, not globally", async () => {
      await expect(
        fixture.withTenant(A, (tx) =>
          repository.createRole(A, tx, { name: "READERS" }),
        ),
      ).rejects.toThrow();
      const x = await fixture.withTenant(A, (tx) =>
        repository.createRole(A, tx, { name: "Unique" }),
      );
      const y = await fixture.withTenant(B, (tx) =>
        repository.createRole(B, tx, { name: "Unique" }),
      );
      expect(x.churchId).not.toBe(y.churchId);
    });
    it("protects system role rename/delete and permission mutations through custom paths", async () => {
      await fixture.fixturePool.query(
        "update church_role set is_system=true where id=$1",
        [ra],
      );
      await fixture.withTenant(A, async (tx) => {
        expect(await repository.renameRole(A, tx, ra, "Changed")).toBeNull();
        expect(await repository.deleteRole(A, tx, ra)).toBe(false);
        expect(
          await repository.addRolePermission(A, tx, ra, "members.view"),
        ).toBe(false);
        expect(
          await repository.removeRolePermission(A, tx, ra, "members.view"),
        ).toBe(false);
      });
      expect(
        (
          await fixture.fixturePool.query(
            "select name from church_role where id=$1",
            [ra],
          )
        ).rows[0].name,
      ).toBe("Readers");
    });
    it("rejects arbitrary permission keys even when a privileged fixture inserted one", async () => {
      await fixture.fixturePool.query(
        "insert into church_role_permission(church_id,role_id,permission) values($1,$2,'roles.manage')",
        [a, ra],
      );
      expect(await service.hasPermission(A, ma, "roles.manage")).toBe(false);
      await expect(
        fixture.withTenant(A, (tx) =>
          repository.addRolePermission(A, tx, ra, "roles.manage"),
        ),
      ).rejects.toThrow("Invalid permission");
    });
    it.each(["permission-role", "assignment-role", "assignment-membership"])(
      "composite FK rejects raw cross-tenant %s even with fixture credentials that bypass RLS",
      async (kind) => {
        // This is an integrity oracle, not an RLS assertion.
        const query =
          kind === "permission-role"
            ? fixture.fixturePool.query(
                "insert into church_role_permission(church_id,role_id,permission) values($1,$2,'members.view')",
                [a, rb],
              )
            : fixture.fixturePool.query(
                "insert into church_membership_role(church_id,membership_id,role_id) values($1,$2,$3)",
                [
                  a,
                  kind === "assignment-membership" ? mb : ma,
                  kind === "assignment-role" ? rb : ra,
                ],
              );
        await expect(query).rejects.toMatchObject({ code: "23503" });
      },
    );
    it("repository rejects foreign assignment endpoints without upgrading relationship status", async () => {
      await fixture.withTenant(A, async (tx) => {
        expect(await repository.assignRole(A, tx, ma, rb)).toBe(false);
        expect(await repository.assignRole(A, tx, mb, ra)).toBe(false);
        expect(
          await repository.addRolePermission(A, tx, rb, "members.view"),
        ).toBe(false);
        expect(await repository.listMembershipRoles(A, tx, mb)).toEqual([]);
      });
      expect(
        (
          await fixture.fixturePool.query(
            "select status from church_membership where id=$1",
            [mb],
          )
        ).rows[0].status,
      ).toBe("follower");
    });
    it.each([
      "church_role",
      "church_role_permission",
      "church_membership_role",
    ])(
      "RLS rejects foreign raw INSERT and hides unscoped UPDATE/DELETE on %s",
      async (table) => {
        const before = await state();
        const insert =
          table === "church_role"
            ? sql`insert into church_role(id,church_id,name) values(${randomUUID()},${b},'Foreign')`
            : table === "church_role_permission"
              ? sql`insert into church_role_permission(church_id,role_id,permission) values(${b},${rb},'other.valid')`
              : sql`insert into church_membership_role(church_id,membership_id,role_id) values(${b},${mb},${rb})`;
        await assertRejectedWrite(
          fixture,
          A,
          (tx) => tx.execute(insert),
          async () => {
            expect(await state()).toEqual(before);
          },
        );
        expect(
          (
            await fixture.runtimeDb.db.execute(
              sql.raw('delete from "' + table + '" returning church_id'),
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await fixture.runtimeDb.db.execute(
              sql.raw(
                'update "' +
                  table +
                  '" set church_id=church_id returning church_id',
              ),
            )
          ).rows,
        ).toEqual([]);
        expect(await state()).toEqual(before);
      },
    );
    it("uniqueness rejects raw duplicate mappings", async () => {
      await expect(
        fixture.fixturePool.query(
          "insert into church_role_permission(church_id,role_id,permission) values($1,$2,'members.view')",
          [a, ra],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        fixture.fixturePool.query(
          "insert into church_membership_role(church_id,membership_id,role_id) values($1,$2,$3)",
          [a, ma, ra],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });
    it.each(["role-permission", "membership-role"])(
      "concurrent duplicate %s assignment leaves one row",
      async (kind) => {
        await fixture.withTenant(A, (tx) =>
          kind === "role-permission"
            ? repository.removeRolePermission(A, tx, ra, "members.view")
            : repository.removeRole(A, tx, ma, ra),
        );
        const run = () =>
          fixture.concurrentTenantDatabase.transaction(A, (tx) =>
            kind === "role-permission"
              ? repository.addRolePermission(A, tx, ra, "members.view")
              : repository.assignRole(A, tx, ma, ra),
          );
        expect((await Promise.all([run(), run()])).sort()).toEqual([
          false,
          true,
        ]);
        const query =
          kind === "role-permission"
            ? "select count(*)::int n from church_role_permission where church_id=$1 and role_id=$2 and permission='members.view'"
            : "select count(*)::int n from church_membership_role where church_id=$1 and role_id=$2";
        expect(
          (await fixture.fixturePool.query(query, [a, ra])).rows[0].n,
        ).toBe(1);
      },
    );
    it.each([
      ["member", "members.view", true],
      ["member", "events.create", true],
      ["inactive", "members.view", true],
      ["inactive", "events.create", false],
      ["follower", "members.view", false],
      ["follower", "events.create", false],
      ["left", "members.view", false],
      ["left", "events.create", false],
    ] as const)(
      "state %s with assigned %s evaluates to %s",
      async (status, key, allowed) => {
        if (status !== "member")
          expect(await change(A, ma, "member", status)).not.toBeNull();
        expect(await service.hasPermission(A, ma, key)).toBe(allowed);
      },
    );
    it("member -> inactive -> member changes ordinary permissions immediately without cache", async () => {
      expect(await service.hasPermission(A, ma, "events.create")).toBe(true);
      expect(await change(A, ma, "member", "inactive")).not.toBeNull();
      expect(await service.hasPermission(A, ma, "events.create")).toBe(false);
      expect(await service.hasPermission(A, ma, "members.view")).toBe(true);
      expect(await change(A, ma, "inactive", "member")).not.toBeNull();
      expect(await service.hasPermission(A, ma, "events.create")).toBe(true);
    });
    it.each(["follower", "left"])(
      "Task 1.10 compare-and-set transition member -> %s immediately revokes role permissions",
      async (next) => {
        expect(await service.hasPermission(A, ma, "members.view")).toBe(true);
        expect(await change(A, ma, "member", next)).not.toBeNull();
        expect(await service.hasPermission(A, ma, "members.view")).toBe(false);
        expect(
          (
            await fixture.fixturePool.query(
              "select * from church_membership_role where membership_id=$1",
              [ma],
            )
          ).rows,
        ).toHaveLength(1);
      },
    );
    it.each(["assignment", "permission"])(
      "removing %s revokes immediately and other tenant remains unaffected",
      async (kind) => {
        await change(B, mb, "follower", "member");
        expect(await service.hasPermission(A, ma, "members.view")).toBe(true);
        await fixture.withTenant(A, (tx) =>
          kind === "assignment"
            ? repository.removeRole(A, tx, ma, ra)
            : repository.removeRolePermission(A, tx, ra, "members.view"),
        );
        expect(await service.hasPermission(A, ma, "members.view")).toBe(false);
        expect(await service.hasPermission(B, mb, "members.view")).toBe(true);
      },
    );
    it("denies foreign and nonexistent membership IDs even if valid role assignments exist elsewhere", async () => {
      await change(B, mb, "follower", "member");
      expect(await service.hasPermission(A, mb, "members.view")).toBe(false);
      expect(await service.hasPermission(B, ma, "members.view")).toBe(false);
      expect(await service.hasPermission(A, randomUUID(), "members.view")).toBe(
        false,
      );
    });
    it("permissions are additive across roles without deny precedence or role-name authority", async () => {
      const second = await fixture.withTenant(A, (tx) =>
        repository.createRole(A, tx, { name: "Additional" }),
      );
      await fixture.withTenant(A, async (tx) => {
        await repository.addRolePermission(A, tx, second.id, "members.view");
        await repository.assignRole(A, tx, ma, second.id);
        await repository.removeRole(A, tx, ma, ra);
      });
      expect(await service.hasPermission(A, ma, "members.view")).toBe(true);
      expect(await service.hasPermission(A, ma, "events.create")).toBe(false);
    });
    it("role deletion cascades only its mappings, preserving membership/user/church and the other tenant", async () => {
      expect(
        await fixture.withTenant(A, (tx) => repository.deleteRole(A, tx, ra)),
      ).toBe(true);
      for (const table of ["church_role_permission", "church_membership_role"])
        expect(
          (
            await fixture.fixturePool.query(
              'select * from "' + table + '" where role_id=$1',
              [ra],
            )
          ).rows,
        ).toEqual([]);
      expect(
        (
          await fixture.fixturePool.query(
            "select id from church_membership where id=$1",
            [ma],
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await fixture.fixturePool.query('select id from "user" where id=$1', [
            base.userA.userId,
          ])
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await fixture.fixturePool.query("select id from church where id=$1", [
            a,
          ])
        ).rows,
      ).toHaveLength(1);
      expect(
        await fixture.withTenant(B, (tx) => repository.getRole(B, tx, rb)),
      ).not.toBeNull();
    });
    it("church deletion cascades its authorization data without deleting global users or the other tenant", async () => {
      await fixture.withTenant(A, (tx) =>
        tx.execute(sql`delete from church where id=${a}`),
      );
      for (const table of authzTables)
        expect(
          (
            await fixture.fixturePool.query(
              'select * from "' + table + '" where church_id=$1',
              [a],
            )
          ).rows,
        ).toEqual([]);
      expect(
        (
          await fixture.fixturePool.query('select id from "user" where id=$1', [
            base.userA.userId,
          ])
        ).rows,
      ).toHaveLength(1);
      expect(
        await fixture.withTenant(B, (tx) => repository.getRole(B, tx, rb)),
      ).not.toBeNull();
    });
    it("membership deletion removes assignments but preserves roles and permissions", async () => {
      await fixture.withTenant(A, (tx) =>
        tx.execute(
          sql`delete from church_membership where church_id=${a} and id=${ma}`,
        ),
      );
      expect(
        (
          await fixture.fixturePool.query(
            "select * from church_membership_role where membership_id=$1",
            [ma],
          )
        ).rows,
      ).toEqual([]);
      expect(
        await fixture.withTenant(A, (tx) => repository.getRole(A, tx, ra)),
      ).not.toBeNull();
    });
    it.each([
      "church_role",
      "church_role_permission",
      "church_membership_role",
    ])(
      "pooled commit/rollback/concurrent A-B contexts isolate %s",
      async (table) => {
        const read = broad(table);
        const n = table === "church_role_permission" ? 2 : 1;
        const ar = Array.from({ length: n }, () => ({ church_id: a })),
          br = Array.from({ length: n }, () => ({ church_id: b }));
        await assertCommitIsolation(fixture, A, read, async (tx) => {
          expect((await tx.execute(read)).rows).toEqual(ar);
        });
        await assertRollbackIsolation(fixture, A, read, ar);
        await assertConcurrentIsolation(fixture, A, B, read, ar, br);
      },
    );
    it("failed transaction rolls back authorization mutations and clears scope", async () => {
      await assertFailureIsolation(
        fixture,
        A,
        broad("church_role"),
        async (tx) => {
          await repository.renameRole(A, tx, ra, "Not committed");
          throw new Error("intentional rollback");
        },
        async () => {
          expect(
            (
              await fixture.fixturePool.query(
                "select name from church_role where id=$1",
                [ra],
              )
            ).rows[0].name,
          ).toBe("Readers");
        },
        "intentional rollback",
      );
      await assertNoContext(fixture, broad("church_role"));
    });

    it.each([
      "church_role",
      "church_role_permission",
      "church_membership_role",
    ])("fails closed if runtime gains ownership of %s", async (table) => {
      const owner = (
        await fixture.fixturePool.query(
          "select pg_get_userbyid(relowner) owner from pg_class where oid=$1::regclass",
          [table],
        )
      ).rows[0].owner as string;
      if (!/^[a-zA-Z0-9_]+$/.test(owner))
        throw new Error("Unexpected fixture owner identifier");
      await fixture.fixturePool.query(
        'alter table "' + table + '" owner to "' + fixture.roleName + '"',
      );
      try {
        await expect(fixture.assertRestrictedRole()).rejects.toThrow();
        await expect(
          service.hasPermission(A, ma, "members.view"),
        ).rejects.toThrow("Authorization evaluation failed");
      } finally {
        await fixture.fixturePool.query(
          'alter table "' + table + '" owner to "' + owner + '"',
        );
        // Owner transfer changes ACLs; restore the fixture's original CRUD grant.
        await fixture.fixturePool.query(
          'grant select, insert, update, delete on "' +
            table +
            '" to "' +
            fixture.roleName +
            '"',
        );
      }
    });
    it("rejects raw malformed permission keys and blank role labels by database constraints", async () => {
      await expect(
        fixture.fixturePool.query(
          "insert into church_role_permission(church_id,role_id,permission) values($1,$2,'*')",
          [a, ra],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        fixture.fixturePool.query(
          "insert into church_role(id,church_id,name) values($1,$2,'  ')",
          [randomUUID(), a],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("lists role and membership assignments with bounded keyset pages", async () => {
      const extra = await fixture.withTenant(A, (tx) =>
        repository.createRole(A, tx, { name: "Another" }),
      );
      await fixture.withTenant(A, (tx) =>
        repository.assignRole(A, tx, ma, extra.id),
      );
      await fixture.withTenant(A, async (tx) => {
        const first = await repository.listRoles(A, tx, 1);
        const second = await repository.listRoles(A, tx, 1, first[0]!.id);
        expect([...first, ...second].map((r) => r.id)).toEqual(
          [ra, extra.id].sort(),
        );
        const one = await repository.listMembershipRoles(A, tx, ma, 1);
        const two = await repository.listMembershipRoles(
          A,
          tx,
          ma,
          1,
          one[0]!.id,
        );
        expect([...one, ...two].map((r) => r.id)).toEqual(
          [ra, extra.id].sort(),
        );
      });
    });
    it("assigning to a follower retains follower state and grants no role-derived access", async () => {
      await fixture.withTenant(B, (tx) => repository.removeRole(B, tx, mb, rb));
      expect(
        await fixture.withTenant(B, (tx) =>
          repository.assignRole(B, tx, mb, rb),
        ),
      ).toBe(true);
      expect(
        (
          await fixture.fixturePool.query(
            "select status from church_membership where id=$1",
            [mb],
          )
        ).rows[0].status,
      ).toBe("follower");
      expect(await service.hasPermission(B, mb, "members.view")).toBe(false);
    });
  });
}
