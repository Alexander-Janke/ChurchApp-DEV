import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { MODULE_METADATA } from "@nestjs/common/constants";
import {
  PERMISSIONS,
  isPermissionKey,
  parsePermission,
  membershipAllowsPermission,
  isPermissionEligibleForInactiveMembership,
} from "../src/authorization/permission-policy.js";
import {
  parseCustomRole,
  parseRoleName,
  parseRoleId,
  parseRolePage,
} from "../src/authorization/role-policy.js";
import { AuthorizationRepository } from "../src/authorization/authorization.repository.js";
import { AuthorizationService } from "../src/authorization/authorization.service.js";
import { AuthorizationModule } from "../src/authorization/authorization.module.js";
import { AppModule } from "../src/app.module.js";
import { TenantContext } from "../src/database/tenant-context.js";
import type { TenantDatabase } from "../src/database/tenant-database.js";
import type { DatabaseTransaction } from "../src/database/database.types.js";
import {
  churchRole,
  churchRolePermission,
  churchMembershipRole,
} from "../src/database/schema/authorization.js";

describe("authorization policy and internal boundary", () => {
  it("has only the documented unique canonical keys, frozen without privileged grants", () => {
    expect(Object.keys(PERMISSIONS)).toEqual(["members.view", "events.create"]);
    expect(new Set(Object.keys(PERMISSIONS)).size).toBe(2);
    expect(Object.isFrozen(PERMISSIONS)).toBe(true);
    for (const policy of Object.values(PERMISSIONS)) {
      expect(Object.isFrozen(policy)).toBe(true);
      expect(policy.requiresPrivilegedAssurance).toBe(false);
    }
  });
  it.each([
    "roles.manage",
    "church.ownertransfer",
    "admin",
    "MEMBERS.VIEW",
    "members.view ",
    "*",
    "__proto__",
    "constructor",
    "",
    null,
    1,
  ])("rejects unregistered or malformed permission %s", (key) => {
    expect(isPermissionKey(key)).toBe(false);
    expect(() => parsePermission(key)).toThrow("Invalid permission");
    expect(membershipAllowsPermission("member", key)).toBe(false);
  });
  it("makes inactive eligibility opt-in and denies unknown permission metadata", () => {
    expect(isPermissionEligibleForInactiveMembership("members.view")).toBe(
      true,
    );
    expect(isPermissionEligibleForInactiveMembership("events.create")).toBe(
      false,
    );
    expect(isPermissionEligibleForInactiveMembership("roles.manage")).toBe(
      false,
    );
  });
  it.each([
    ["member", "members.view", true],
    ["member", "events.create", true],
    ["inactive", "members.view", true],
    ["inactive", "events.create", false],
    ["follower", "members.view", false],
    ["follower", "events.create", false],
    ["left", "members.view", false],
    ["left", "events.create", false],
    ["admin", "members.view", false],
    [null, "members.view", false],
  ])(
    "evaluates state %s and %s without role names",
    (status, key, expected) => {
      expect(membershipAllowsPermission(status, key)).toBe(expected);
    },
  );
  it("trims role labels and preserves Unicode without assigning meaning to a name", () => {
    expect(parseRoleName("  Équipe 青年  ")).toBe("Équipe 青年");
    expect(parseCustomRole({ name: "Admin" })).toEqual({
      name: "Admin",
      description: null,
    });
  });
  it.each(["", "  ", "x".repeat(101), null, 4])(
    "rejects invalid role name %s",
    (name) => {
      expect(() => parseRoleName(name)).toThrow("Invalid role name");
    },
  );
  it.each([
    { name: "Role", isSystem: true },
    { name: "Role", churchId: "foreign" },
    { name: "Role", isOwner: true },
    { name: "Role", permissions: ["roles.manage"] },
    { name: "Role", description: "x".repeat(501) },
  ])("rejects protected role creation fields", (input) => {
    expect(() => parseCustomRole(input)).toThrow();
  });
  it("validates identifiers and bounded keyset pages", () => {
    expect(() => parseRoleId(" ")).toThrow();
    expect(() => parseRolePage(101)).toThrow();
    expect(() => parseRolePage(0)).toThrow();
    expect(parseRolePage(10, "cursor")).toEqual({ limit: 10, after: "cursor" });
  });
  it("has no controllers and is not mounted in the application", () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AuthorizationModule) ??
        [],
    ).toEqual([]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule),
    ).not.toContain(AuthorizationModule);
  });
  it("requires genuine context before any database access", async () => {
    const transaction = vi.fn();
    const service = new AuthorizationService(
      { transaction } as unknown as TenantDatabase,
      new AuthorizationRepository(),
    );
    await expect(
      service.hasPermission(
        { churchId: randomUUID() } as TenantContext,
        "member",
        "members.view",
      ),
    ).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("sanitizes database failures without leaking role or connection diagnostics", async () => {
    const service = new AuthorizationService(
      {
        transaction: vi
          .fn()
          .mockRejectedValue(new Error("sensitive-driver-detail")),
      } as unknown as TenantDatabase,
      new AuthorizationRepository(),
    );
    await expect(
      service.hasPermission(
        TenantContext.fromAuthorizedScope(randomUUID()),
        "member",
        "members.view",
      ),
    ).rejects.toThrow(/^Authorization evaluation failed$/);
  });
  it("scopes system-role rename and delete guards in SQL, not only a read-time check", async () => {
    const context = TenantContext.fromAuthorizedScope(randomUUID());
    const predicates: unknown[] = [];
    const builder = {
      set: () => builder,
      where: (value: unknown) => {
        predicates.push(value);
        return builder;
      },
      returning: async () => [],
    };
    const tx = {
      update: () => builder,
      delete: () => builder,
    } as unknown as DatabaseTransaction;
    const repository = new AuthorizationRepository();
    expect(
      await repository.renameRole(context, tx, "role", "Changed"),
    ).toBeNull();
    expect(await repository.deleteRole(context, tx, "role")).toBe(false);
    for (const predicate of predicates) {
      const query = new PgDialect().sqlToQuery(
        predicate as Parameters<PgDialect["sqlToQuery"]>[0],
      );
      expect(query.params).toEqual([context.churchId, "role", false]);
      expect(query.sql).toContain('"church_role"."church_id"');
      expect(query.sql).toContain('"church_role"."is_system"');
    }
  });
  it("declares composite tenant references and constrained mapping keys", () => {
    expect(
      getTableConfig(churchRole).columns.map((column) => column.name),
    ).toEqual([
      "id",
      "church_id",
      "name",
      "description",
      "is_system",
      "created_at",
      "updated_at",
    ]);
    for (const table of [churchRolePermission, churchMembershipRole]) {
      const config = getTableConfig(table);
      expect(config.primaryKeys).toHaveLength(1);
      for (const fk of config.foreignKeys) {
        expect(fk.reference().columns[0]?.name).toBe("church_id");
        expect(fk.reference().foreignColumns[0]?.name).toBe("church_id");
        expect(fk.onDelete).toBe("cascade");
      }
    }
  });
});
