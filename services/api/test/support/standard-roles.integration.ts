import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthorizationRepository } from "../../src/authorization/authorization.repository.js";
import { AuthorizationService } from "../../src/authorization/authorization.service.js";
import { StandardRoleService } from "../../src/authorization/standard-role.service.js";
import {
  STANDARD_ROLES,
  standardRoleId,
} from "../../src/authorization/standard-roles.js";
import { MembershipRepository } from "../../src/membership/membership.repository.js";
import { TenantContext } from "../../src/database/tenant-context.js";
import {
  createTenantTestFixture,
  type TenantTestFixture,
} from "./tenant/database-fixture.js";
import {
  baseTenantFixtures,
  seedTenantFixtures,
} from "./tenant/tenant-fixtures.js";
import { assertNoContext } from "./tenant/tenant-isolation.js";
import { migrateFixture } from "./tenant/migration-fixture.js";

export function standardRolesIntegrationTests() {
  describe("explicit standard roles using restricted tenant runtime", () => {
    const base = baseTenantFixtures();
    const A = base.tenantA.context,
      B = base.tenantB.context;
    const ma = base.relationshipA.id,
      mb = base.relationshipB.id;
    const repository = new AuthorizationRepository();
    const memberships = new MembershipRepository();
    let fixture: TenantTestFixture,
      service: StandardRoleService,
      concurrent: StandardRoleService,
      authorization: AuthorizationService;
    const roles = (context: TenantContext) =>
      fixture.withTenant(context, (tx) => repository.listRoles(context, tx));
    const mappings = (context: TenantContext) =>
      fixture.withTenant(
        context,
        async (tx) =>
          (
            await tx.execute(
              sql`select * from church_role_permission order by role_id,permission`,
            )
          ).rows,
      );
    beforeAll(async () => {
      fixture = await createTenantTestFixture({
        protectedTables: [
          "church",
          "church_membership",
          "church_role",
          "church_role_permission",
          "church_membership_role",
        ],
      });
      service = new StandardRoleService(fixture.tenantDatabase, repository);
      concurrent = new StandardRoleService(
        fixture.concurrentTenantDatabase,
        repository,
      );
      authorization = new AuthorizationService(
        fixture.tenantDatabase,
        repository,
      );
      await fixture.assertRestrictedRole();
    }, 30000);
    afterAll(async () => {
      await fixture?.dispose();
    });
    beforeEach(async () => {
      await seedTenantFixtures(fixture.fixturePool, base, {
        memberships: true,
      });
    });

    it("creates exactly four system identities with empty bundles and no assignments in A only", async () => {
      const result = await service.ensureStandardRoles(A);
      expect(result.map((r) => [r.key, r.name, r.isSystem])).toEqual(
        STANDARD_ROLES.map((r) => [r.key, r.name, true]),
      );
      expect(result.map((r) => r.id)).toEqual(
        STANDARD_ROLES.map((r) => standardRoleId(A, r.key)),
      );
      expect(await roles(A)).toHaveLength(4);
      expect(await roles(B)).toEqual([]);
      expect(await mappings(A)).toEqual([]);
      expect(
        await fixture.withTenant(A, (tx) =>
          repository.listMembershipRoles(A, tx, ma),
        ),
      ).toEqual([]);
      await assertNoContext(fixture, sql`select * from church_role`);
    });
    it("repeated provisioning preserves IDs and timestamps without duplicate rows", async () => {
      const first = await service.ensureStandardRoles(A);
      expect(await service.ensureStandardRoles(A)).toEqual(first);
      expect(await roles(A)).toHaveLength(4);
    });
    it("serializes simultaneous provisioning on separate pooled connections", async () => {
      const [first, second] = await Promise.all([
        concurrent.ensureStandardRoles(A),
        concurrent.ensureStandardRoles(A),
      ]);
      expect(second).toEqual(first);
      expect(await roles(A)).toHaveLength(4);
      expect(await mappings(A)).toEqual([]);
    });
    it("concurrent tenants get separate identities and no cross-tenant visibility", async () => {
      const [first, second] = await Promise.all([
        concurrent.ensureStandardRoles(A),
        concurrent.ensureStandardRoles(B),
      ]);
      expect(first.every((r) => r.churchId === A.churchId)).toBe(true);
      expect(second.every((r) => r.churchId === B.churchId)).toBe(true);
      expect(new Set([...first, ...second].map((r) => r.id)).size).toBe(8);
      expect(
        await fixture.withTenant(A, (tx) =>
          repository.getRole(A, tx, second[0]!.id),
        ),
      ).toBeNull();
      await assertNoContext(fixture, sql`select * from church_role`);
    });
    it("preserves unrelated custom roles, grants and assignments", async () => {
      const custom = await fixture.withTenant(A, (tx) =>
        repository.createRole(A, tx, { name: "Custom readers" }),
      );
      await fixture.withTenant(A, async (tx) => {
        await repository.addRolePermission(A, tx, custom.id, "members.view");
        await repository.assignRole(A, tx, ma, custom.id);
      });
      await service.ensureStandardRoles(A);
      expect(
        await fixture.withTenant(A, (tx) =>
          repository.getRole(A, tx, custom.id),
        ),
      ).toEqual(custom);
      expect(await authorization.hasPermission(A, ma, "members.view")).toBe(
        true,
      );
      expect(await mappings(A)).toHaveLength(1);
      expect(
        await fixture.withTenant(A, (tx) =>
          repository.listMembershipRoles(A, tx, ma),
        ),
      ).toHaveLength(1);
    });
    it("rolls back the whole batch on a case-insensitive custom display-name collision", async () => {
      const custom = await fixture.withTenant(A, (tx) =>
        repository.createRole(A, tx, { name: "CHILDREN’S WORKER" }),
      );
      await expect(service.ensureStandardRoles(A)).rejects.toMatchObject({
        code: "STANDARD_ROLE_CONFLICT",
      });
      expect(await roles(A)).toEqual([custom]);
      expect(await mappings(A)).toEqual([]);
      await assertNoContext(fixture, sql`select * from church_role`);
    });
    it("does not adopt a custom row occupying a reserved canonical ID", async () => {
      // Administrative corruption fixture only; operation/assertions use restricted runtime.
      await fixture.fixturePool.query(
        "insert into church_role(id,church_id,name) values($1,$2,'Custom collision')",
        [standardRoleId(A, "group_leader"), A.churchId],
      );
      await expect(service.ensureStandardRoles(A)).rejects.toMatchObject({
        code: "STANDARD_ROLE_CONFLICT",
      });
      expect((await roles(A))[0]!.isSystem).toBe(false);
      expect(await roles(A)).toHaveLength(1);
    });
    it("does not adopt a differently identified system row merely matching a label", async () => {
      await fixture.fixturePool.query(
        "insert into church_role(id,church_id,name,is_system) values($1,$2,'Group Leader',true)",
        [randomUUID(), A.churchId],
      );
      const before = await roles(A);
      await expect(service.ensureStandardRoles(A)).rejects.toMatchObject({
        code: "STANDARD_ROLE_CONFLICT",
      });
      expect(await roles(A)).toEqual(before);
    });
    it("reconciles renamed metadata by stable ID", async () => {
      const original = await service.ensureStandardRoles(A);
      await fixture.fixturePool.query(
        "update church_role set name='Drifted label',description='Drifted description' where id=$1",
        [original[0]!.id],
      );
      const result = await service.ensureStandardRoles(A);
      expect(result[0]).toMatchObject({
        id: original[0]!.id,
        name: "Group Leader",
        description: STANDARD_ROLES[0]!.description,
        createdAt: original[0]!.createdAt,
      });
    });
    it("metadata collision fails safely and preserves all previous rows", async () => {
      const original = await service.ensureStandardRoles(A);
      await fixture.fixturePool.query(
        "update church_role set name='Drifted' where id=$1",
        [original[0]!.id],
      );
      await fixture.withTenant(A, (tx) =>
        repository.createRole(A, tx, { name: "Group Leader" }),
      );
      const before = await roles(A);
      await expect(service.ensureStandardRoles(A)).rejects.toMatchObject({
        code: "STANDARD_ROLE_CONFLICT",
      });
      expect(await roles(A)).toEqual(before);
    });
    it("removes permission drift exactly and the next evaluation sees revocation", async () => {
      const [first] = await service.ensureStandardRoles(A);
      await fixture.withTenant(A, (tx) =>
        repository.assignRole(A, tx, ma, first!.id),
      );
      await fixture.fixturePool.query(
        "insert into church_role_permission(church_id,role_id,permission) values($1,$2,'members.view'),($1,$2,'events.create'),($1,$2,'roles.manage')",
        [A.churchId, first!.id],
      );
      expect(await authorization.hasPermission(A, ma, "members.view")).toBe(
        true,
      );
      await service.ensureStandardRoles(A);
      expect(await mappings(A)).toEqual([]);
      expect(await authorization.hasPermission(A, ma, "members.view")).toBe(
        false,
      );
      expect(await authorization.hasPermission(A, ma, "events.create")).toBe(
        false,
      );
    });
    it("generic role mutation cannot rename/delete/edit bundles of system roles", async () => {
      const [first] = await service.ensureStandardRoles(A);
      await fixture.withTenant(A, async (tx) => {
        expect(
          await repository.renameRole(A, tx, first!.id, "Rename"),
        ).toBeNull();
        expect(await repository.deleteRole(A, tx, first!.id)).toBe(false);
        expect(
          await repository.addRolePermission(A, tx, first!.id, "members.view"),
        ).toBe(false);
        expect(
          await repository.removeRolePermission(
            A,
            tx,
            first!.id,
            "members.view",
          ),
        ).toBe(false);
        const custom = await repository.createRole(A, tx, {
          name: "Editable custom",
        });
        expect(
          await repository.renameRole(A, tx, custom.id, "Renamed custom"),
        ).not.toBeNull();
        expect(await repository.deleteRole(A, tx, custom.id)).toBe(true);
      });
      expect(await roles(A)).toHaveLength(4);
    });
    it.each(["member", "inactive", "follower", "left"] as const)(
      "assigned empty standard roles grant nothing to %s relationships",
      async (status) => {
        const all = await service.ensureStandardRoles(A);
        await fixture.withTenant(A, async (tx) => {
          if (status !== "member")
            await memberships.changeRelationshipStatus(
              A,
              tx,
              ma,
              "member",
              status,
            );
          for (const role of all)
            await repository.assignRole(A, tx, ma, role.id);
        });
        expect(await authorization.hasPermission(A, ma, "members.view")).toBe(
          false,
        );
        expect(await authorization.hasPermission(A, ma, "events.create")).toBe(
          false,
        );
        expect(
          await fixture.withTenant(A, (tx) =>
            repository.listMembershipRoles(A, tx, ma),
          ),
        ).toHaveLength(4);
      },
    );
    it("assignment and removal never change relationship state or infer a member baseline", async () => {
      const [first] = await service.ensureStandardRoles(B);
      await fixture.withTenant(B, async (tx) => {
        await repository.assignRole(B, tx, mb, first!.id);
        expect(
          (
            await tx.execute(
              sql`select status from church_membership where id=${mb}`,
            )
          ).rows[0],
        ).toMatchObject({ status: "follower" });
        expect(await repository.removeRole(B, tx, mb, first!.id)).toBe(true);
      });
      expect(await authorization.hasPermission(B, mb, "members.view")).toBe(
        false,
      );
    });
    it("rejects foreign membership/role assignment at repository and composite-FK boundaries", async () => {
      const [ar] = await service.ensureStandardRoles(A),
        [br] = await service.ensureStandardRoles(B);
      await fixture.withTenant(A, async (tx) => {
        expect(await repository.assignRole(A, tx, ma, br!.id)).toBe(false);
        expect(await repository.assignRole(A, tx, mb, ar!.id)).toBe(false);
      });
      for (const [membershipId, roleId] of [
        [ma, br!.id],
        [mb, ar!.id],
      ]) {
        await expect(
          fixture.withTenant(A, (tx) =>
            tx.execute(
              sql`insert into church_membership_role(church_id,membership_id,role_id) values(${A.churchId},${membershipId},${roleId})`,
            ),
          ),
        ).rejects.toThrow();
      }
      expect(
        await fixture.withTenant(A, (tx) =>
          repository.listMembershipRoles(A, tx, ma),
        ),
      ).toEqual([]);
    });
    it("missing database context cannot provision protected rows", async () => {
      await expect(
        fixture.runtimeDb.transaction((tx) =>
          repository.ensureStandardRoles(A, tx),
        ),
      ).rejects.toThrow();
      expect(await roles(A)).toEqual([]);
      await assertNoContext(fixture, sql`select * from church_role`);
    });
    it("mismatched repository/database scope cannot provision either tenant", async () => {
      await expect(
        fixture.withTenant(B, (tx) => repository.ensureStandardRoles(A, tx)),
      ).rejects.toThrow();
      expect(await roles(A)).toEqual([]);
      expect(await roles(B)).toEqual([]);
    });
    it("rejects a forged context without changing data", async () => {
      await expect(
        // @ts-expect-error deliberately untrusted input
        service.ensureStandardRoles({ churchId: A.churchId }),
      ).rejects.toThrow();
      expect(await roles(A)).toEqual([]);
    });
    it("sanitizes missing-tenant failure without a driver cause", async () => {
      const unknown = TenantContext.fromAuthorizedScope(randomUUID());
      const error = await service
        .ensureStandardRoles(unknown)
        .catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        message: "Standard role provisioning failed",
      });
      expect(error).not.toHaveProperty("cause");
    });
    it("repeated migration runner preserves provisioned roles and grants", async () => {
      await service.ensureStandardRoles(A);
      const before = await roles(A);
      await migrateFixture(fixture.fixturePool);
      expect(await roles(A)).toEqual(before);
      expect(await mappings(A)).toEqual([]);
    });
  });
}
