import "reflect-metadata";
import { randomUUID, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthorizationRepository } from "../../src/authorization/authorization.repository.js";
import { AuthorizationService } from "../../src/authorization/authorization.service.js";
import { SessionAuthorizationService } from "../../src/authorization/session-authorization.service.js";
import { StandardRoleService } from "../../src/authorization/standard-role.service.js";
import { standardRoleId } from "../../src/authorization/standard-roles.js";
import { SessionAssuranceService } from "../../src/auth/session-assurance.service.js";
import { MembershipRepository } from "../../src/membership/membership.repository.js";
import { OwnershipService } from "../../src/ownership/ownership.service.js";
import { OwnershipRepository } from "../../src/ownership/ownership.repository.js";
import {
  createTenantTestFixture,
  type TenantTestFixture,
} from "./tenant/database-fixture.js";
import {
  baseTenantFixtures,
  seedTenantFixtures,
} from "./tenant/tenant-fixtures.js";
import { issueTestAssurance } from "./assurance.integration.js";
import { migrateFixture } from "./tenant/migration-fixture.js";

export function mainChurchAdministratorIntegrationTests() {
  describe("Main Church Administrator exact bundle and session-authoritative entitlement", () => {
    const base = baseTenantFixtures(),
      A = base.tenantA.context,
      B = base.tenantB.context;
    const actor = { userId: base.userA.userId, sessionId: randomUUID() };
    const second = { userId: actor.userId, sessionId: randomUUID() };
    const foreign = { userId: base.userB.userId, sessionId: randomUUID() };
    const keys = ["members.manage", "church.settings.manage"] as const;
    const adminId = standardRoleId(A, "main_church_administrator");
    const repo = new AuthorizationRepository(),
      memberships = new MembershipRepository();
    let f: TenantTestFixture,
      roles: StandardRoleService,
      concurrent: StandardRoleService,
      service: SessionAuthorizationService,
      assurance: SessionAssuranceService,
      owner: OwnershipService;
    const check = async (allowed: boolean, subject = actor, context = A) => {
      for (const key of keys)
        expect(await service.isAuthorized(context, subject, key)).toBe(allowed);
    };
    const mappings = async (id = adminId) =>
      (
        await f.fixturePool.query(
          "select permission,created_at from church_role_permission where role_id=$1 order by permission",
          [id],
        )
      ).rows;
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
        ],
      });
      // Read only non-secret factor/session fields; ID update grants support owner row locks.
      await f.fixturePool.query(
        `GRANT SELECT(id,user_id,created_at,expires_at), UPDATE(id) ON session TO "${f.roleName}"`,
      );
      await f.fixturePool.query(
        `GRANT SELECT(id,two_factor_enabled), UPDATE(id) ON "user" TO "${f.roleName}"`,
      );
      await f.fixturePool.query(
        `GRANT SELECT(id,user_id,verified), UPDATE(id) ON two_factor TO "${f.roleName}"`,
      );
      await f.fixturePool.query(
        `GRANT SELECT, UPDATE(session_id) ON session_assurance TO "${f.roleName}"`,
      );
      assurance = new SessionAssuranceService(f.runtimeDb);
      service = new SessionAuthorizationService(
        f.tenantDatabase,
        repo,
        assurance,
      );
      roles = new StandardRoleService(f.tenantDatabase, repo);
      concurrent = new StandardRoleService(f.concurrentTenantDatabase, repo);
      owner = new OwnershipService(
        f.tenantDatabase,
        new OwnershipRepository(),
        assurance,
      );
      await f.assertRestrictedRole();
    }, 30000);
    afterAll(async () => {
      await f?.dispose();
    });
    beforeEach(async () => {
      await seedTenantFixtures(f.fixturePool, base, { memberships: true });
      for (const subject of [actor, second, foreign])
        await f.fixturePool.query(
          "insert into session(id,user_id,token,created_at,updated_at,expires_at) values($1,$2,$3,now()-interval '2 days',now(),now()+interval '1 day')",
          [subject.sessionId, subject.userId, randomBytes(32).toString("hex")],
        );
      // Fixture state only; no production assurance issuer or TOTP bypass is added.
      for (const subject of [actor, foreign]) {
        await f.fixturePool.query(
          'update "user" set two_factor_enabled=true where id=$1',
          [subject.userId],
        );
        await f.fixturePool.query(
          "insert into two_factor(id,user_id,secret,backup_codes,verified) values($1,$2,$3,$4,true)",
          [
            randomUUID(),
            subject.userId,
            randomBytes(32).toString("hex"),
            randomBytes(32).toString("hex"),
          ],
        );
        await issueTestAssurance(f.fixturePool, subject.sessionId);
      }
      await roles.ensureStandardRoles(A);
      await roles.ensureStandardRoles(B);
      // Internal assignment infrastructure, not automatic provisioning or a public admin API.
      await f.withTenant(A, (tx) =>
        repo.assignRole(A, tx, base.relationshipA.id, adminId),
      );
    });
    it("both permissions require elevation even for an enabled verified administrator", async () => {
      await f.fixturePool.query(
        "delete from session_assurance where session_id=$1",
        [actor.sessionId],
      );
      await check(false);
      await issueTestAssurance(f.fixturePool, actor.sessionId);
      await check(true);
      await check(false, second);
    });
    it("ordinary admin operations need elevation but not recent critical step-up", async () => {
      await f.fixturePool.query(
        "update session_assurance set step_up_at=null where session_id=$1",
        [actor.sessionId],
      );
      await check(true);
      await f.fixturePool.query(
        "update session_assurance set step_up_at=now()-interval '6 minutes' where session_id=$1",
        [actor.sessionId],
      );
      await check(true);
    });
    it.each(["idle", "absolute"])(
      "expired elevation (%s) denies despite current factor",
      async (kind) => {
        await check(true);
        await f.fixturePool.query(
          kind === "idle"
            ? "update session_assurance set elevated_at=now()-interval '16 minutes',last_elevated_activity_at=now()-interval '15 minutes' where session_id=$1"
            : "update session_assurance set elevated_at=now()-interval '8 hours' where session_id=$1",
          [actor.sessionId],
        );
        await check(false);
      },
    );
    it.each(["disabled", "unverified", "missing", "duplicate"])(
      "factor %s immediately denies while stored assignment and assurance remain",
      async (kind) => {
        await check(true);
        if (kind === "disabled")
          await f.fixturePool.query(
            'update "user" set two_factor_enabled=false where id=$1',
            [actor.userId],
          );
        if (kind === "unverified")
          await f.fixturePool.query(
            "update two_factor set verified=false where user_id=$1",
            [actor.userId],
          );
        if (kind === "missing")
          await f.fixturePool.query("delete from two_factor where user_id=$1", [
            actor.userId,
          ]);
        if (kind === "duplicate")
          await f.fixturePool.query(
            "insert into two_factor(id,user_id,secret,backup_codes,verified) values($1,$2,$3,$4,true)",
            [
              randomUUID(),
              actor.userId,
              randomBytes(32).toString("hex"),
              randomBytes(32).toString("hex"),
            ],
          );
        await check(false);
        expect(
          (
            await f.fixturePool.query(
              "select 1 from church_membership_role where membership_id=$1",
              [base.relationshipA.id],
            )
          ).rowCount,
        ).toBe(1);
        expect(
          (
            await f.fixturePool.query(
              "select 1 from session_assurance where session_id=$1",
              [actor.sessionId],
            )
          ).rowCount,
        ).toBe(1);
      },
    );
    it.each(["inactive", "follower", "left"] as const)(
      "membership transition to %s denies immediately and returning to member restores eligibility",
      async (status) => {
        await check(true);
        await f.withTenant(A, (tx) =>
          memberships.changeRelationshipStatus(
            A,
            tx,
            base.relationshipA.id,
            "member",
            status,
          ),
        );
        await check(false);
        await f.withTenant(A, (tx) =>
          memberships.changeRelationshipStatus(
            A,
            tx,
            base.relationshipA.id,
            status,
            "member",
          ),
        );
        await check(true);
      },
    );
    it("assignment removal denies the next evaluation without permission caching", async () => {
      await check(true);
      await f.withTenant(A, (tx) =>
        repo.removeRole(A, tx, base.relationshipA.id, adminId),
      );
      await check(false);
    });
    it("custom role permission metadata enforces the same factor/elevation rules regardless of name", async () => {
      await f.withTenant(A, async (tx) => {
        await repo.removeRole(A, tx, base.relationshipA.id, adminId);
        const custom = await repo.createRole(A, tx, {
          name: "Unprivileged-looking custom label",
        });
        for (const key of keys)
          await repo.addRolePermission(A, tx, custom.id, key);
        await repo.assignRole(A, tx, base.relationshipA.id, custom.id);
        await checkSessionless(custom.id);
      });
      await check(true);
      await check(false, second);
      await f.fixturePool.query(
        'update "user" set two_factor_enabled=false where id=$1',
        [actor.userId],
      );
      await check(false);
    });
    async function checkSessionless(_roleId: string) {
      // Repository check intentionally cannot authorize privilege without a session.
      const sessionless = new AuthorizationService(
        f.concurrentTenantDatabase,
        repo,
      );
      for (const key of keys)
        expect(
          await sessionless.hasPermission(A, base.relationshipA.id, key),
        ).toBe(false);
    }
    it("custom permission removal is immediately effective and an admin label itself grants nothing", async () => {
      let customId = "";
      await f.withTenant(A, async (tx) => {
        await repo.removeRole(A, tx, base.relationshipA.id, adminId);
        const custom = await repo.createRole(A, tx, { name: "Admin" });
        customId = custom.id;
        await repo.assignRole(A, tx, base.relationshipA.id, customId);
        await repo.addRolePermission(A, tx, customId, "members.manage");
      });
      expect(await service.isAuthorized(A, actor, "members.manage")).toBe(true);
      expect(
        await service.isAuthorized(A, actor, "church.settings.manage"),
      ).toBe(false);
      await f.withTenant(A, (tx) =>
        repo.removeRolePermission(A, tx, customId, "members.manage"),
      );
      await check(false);
    });
    it("tenant context and authenticated session ownership cannot be substituted", async () => {
      await check(true);
      await check(false, actor, B);
      await check(false, foreign, A);
      await check(false, {
        userId: actor.userId,
        sessionId: foreign.sessionId,
      });
      await f.withTenant(A, async (tx) => {
        expect(
          await repo.assignRole(
            A,
            tx,
            base.relationshipA.id,
            standardRoleId(B, "main_church_administrator"),
          ),
        ).toBe(false);
        expect(
          await repo.assignRole(A, tx, base.relationshipB.id, adminId),
        ).toBe(false);
      });
    });
    it.each(["revoked", "expired", "absolute"])(
      "%s underlying session overrides valid elevation",
      async (kind) => {
        await check(true);
        if (kind === "revoked")
          await f.fixturePool.query("delete from session where id=$1", [
            actor.sessionId,
          ]);
        else
          await f.fixturePool.query(
            kind === "expired"
              ? "update session set expires_at=now() where id=$1"
              : "update session set created_at=now()-interval '30 days' where id=$1",
            [actor.sessionId],
          );
        await check(false);
      },
    );
    it("canonical role grants no owner predicate, transfer/deletion/platform/role-management authority", async () => {
      await check(true);
      expect(await owner.isPrimaryOwner(A, actor)).toBe(false);
      for (const key of [
        "roles.manage",
        "church.owner.transfer",
        "church.owner.establish",
        "church.owner.remove",
        "church.delete",
        "platform.admin",
        "platform.*",
        "*",
      ])
        expect(await service.isAuthorized(A, actor, key)).toBe(false);
      expect(
        (await f.fixturePool.query("select * from church_primary_owner"))
          .rowCount,
      ).toBe(0);
      expect(
        (await f.fixturePool.query("select * from church_ownership_audit"))
          .rowCount,
      ).toBe(0);
    });
    it("administrator cannot transfer or replace an existing Primary Owner", async () => {
      const member = await f.withTenant(A, (tx) =>
        memberships.createRelationship(A, tx, {
          userId: foreign.userId,
          status: "member",
        }),
      );
      if (member.outcome !== "created")
        throw new Error("Fixture membership creation failed");
      expect(
        await owner.establishInitialOwner(A, foreign, member.relationship.id),
      ).toBe("changed");
      const before = (
        await f.fixturePool.query(
          "select * from church_primary_owner where church_id=$1",
          [A.churchId],
        )
      ).rows;
      await check(true);
      expect(await owner.isPrimaryOwner(A, actor)).toBe(false);
      expect(
        await owner.transferPrimaryOwner(A, actor, base.relationshipA.id),
      ).toBe("conflict");
      expect(
        await owner.establishInitialOwner(A, actor, base.relationshipA.id),
      ).toBe("conflict");
      expect(
        (
          await f.fixturePool.query(
            "select * from church_primary_owner where church_id=$1",
            [A.churchId],
          )
        ).rows,
      ).toEqual(before);
      expect(
        (
          await f.fixturePool.query(
            "select 1 from church_ownership_audit where church_id=$1",
            [A.churchId],
          )
        ).rowCount,
      ).toBe(1);
    });
    it("explicit reconciliation restores both missing keys and removes extra keys only in the target tenant", async () => {
      const otherId = standardRoleId(B, "main_church_administrator");
      await f.fixturePool.query(
        "delete from church_role_permission where role_id=$1",
        [adminId],
      );
      await f.fixturePool.query(
        "insert into church_role_permission(church_id,role_id,permission) values($1,$2,'members.view'),($1,$2,'roles.manage'),($3,$4,'events.create')",
        [A.churchId, adminId, B.churchId, otherId],
      );
      const beforeB = await mappings(otherId);
      await check(false);
      await roles.ensureStandardRoles(A);
      expect((await mappings()).map((r) => r.permission)).toEqual([
        "church.settings.manage",
        "members.manage",
      ]);
      expect(await mappings(otherId)).toEqual(beforeB);
      await check(true);
    });
    it("concurrent reconciliation is idempotent and preserves canonical IDs/timestamps and assignments", async () => {
      const before = await mappings();
      const [a, b] = await Promise.all([
        concurrent.ensureStandardRoles(A),
        concurrent.ensureStandardRoles(A),
      ]);
      expect(a).toEqual(b);
      expect(a).toHaveLength(5);
      expect(await mappings()).toEqual(before);
      expect(
        (
          await f.fixturePool.query(
            "select 1 from church_membership_role where membership_id=$1",
            [base.relationshipA.id],
          )
        ).rowCount,
      ).toBe(1);
    });
    it("generic mutations cannot rename/delete/add/remove canonical administrator permissions", async () => {
      const before = await mappings();
      await f.withTenant(A, async (tx) => {
        expect(await repo.renameRole(A, tx, adminId, "Renamed")).toBeNull();
        expect(await repo.deleteRole(A, tx, adminId)).toBe(false);
        expect(
          await repo.addRolePermission(A, tx, adminId, "members.view"),
        ).toBe(false);
        expect(
          await repo.removeRolePermission(A, tx, adminId, "members.manage"),
        ).toBe(false);
      });
      expect(await mappings()).toEqual(before);
    });
    it("existing four-role church gains the fifth only through explicit provisioning with no assignments", async () => {
      const id = standardRoleId(B, "main_church_administrator");
      await f.fixturePool.query("delete from church_role where id=$1", [id]);
      await migrateFixture(f.fixturePool); // Migrations do not seed/reconcile roles.
      expect(
        (
          await f.fixturePool.query(
            "select 1 from church_role where church_id=$1",
            [B.churchId],
          )
        ).rowCount,
      ).toBe(4);
      await roles.ensureStandardRoles(B);
      expect(
        (
          await f.fixturePool.query(
            "select 1 from church_role where church_id=$1",
            [B.churchId],
          )
        ).rowCount,
      ).toBe(5);
      expect(
        (
          await f.fixturePool.query(
            "select 1 from church_membership_role where church_id=$1",
            [B.churchId],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await f.fixturePool.query(
            "select count(*)::int n from drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(10);
    });
    it("custom collision at the fifth canonical label rolls back provisioning without adopting it", async () => {
      await f.fixturePool.query("delete from church_role where church_id=$1", [
        B.churchId,
      ]);
      const custom = await f.withTenant(B, (tx) =>
        repo.createRole(B, tx, { name: "MAIN CHURCH ADMINISTRATOR" }),
      );
      await expect(roles.ensureStandardRoles(B)).rejects.toMatchObject({
        code: "STANDARD_ROLE_CONFLICT",
      });
      expect(
        (
          await f.fixturePool.query(
            "select id,is_system from church_role where church_id=$1",
            [B.churchId],
          )
        ).rows,
      ).toEqual([{ id: custom.id, is_system: false }]);
      expect(
        (
          await f.fixturePool.query(
            "select 1 from church_role_permission where church_id=$1",
            [B.churchId],
          )
        ).rowCount,
      ).toBe(0);
    });
  });
}
