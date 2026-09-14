import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  assertDisposableNames,
  assertRoleFlags,
  tableIdentifiers,
  type RuntimeRole,
} from "./support/tenant/runtime-role.js";
import { baseTenantFixtures } from "./support/tenant/tenant-fixtures.js";
import { TenantContext } from "../src/database/tenant-context.js";

describe("tenant harness safety guards", () => {
  const suffix = "a".repeat(32);
  it("accepts only matching generated database/role pairs", () => {
    expect(() =>
      assertDisposableNames(
        "tenant_test_" + suffix,
        "tenant_runtime_" + suffix,
      ),
    ).not.toThrow();
  });
  it.each([
    "church_platform_dev",
    "postgres",
    "template0",
    "tenant_test_",
    "tenant_test_" + suffix + '"',
  ])("rejects unsafe cleanup target %s", (name) => {
    expect(() =>
      assertDisposableNames(name, "tenant_runtime_" + suffix),
    ).toThrow("Refusing non-disposable");
  });
  it("rejects a role from another fixture", () => {
    expect(() =>
      assertDisposableNames(
        "tenant_test_" + suffix,
        "tenant_runtime_" + "b".repeat(32),
      ),
    ).toThrow("Refusing non-disposable");
  });
  it("quotes explicit table names only", () => {
    expect(tableIdentifiers(["church", "church_membership"])).toEqual([
      '"church"',
      '"church_membership"',
    ]);
  });
  it.each([
    [],
    ["church", "church"],
    ["*"],
    ["public.church"],
    ['church";drop table x'],
    ["church;"],
  ])("rejects unsafe table grant configuration %#", (...tables) => {
    expect(() => tableIdentifiers(tables)).toThrow("distinct plain");
  });
  const role: RuntimeRole = {
    current_user: "runtime",
    session_user: "runtime",
    rolsuper: false,
    rolbypassrls: false,
    rolcreatedb: false,
    rolcreaterole: false,
  };
  it("accepts the restricted login flags", () =>
    expect(() => assertRoleFlags(role, "runtime")).not.toThrow());
  it.each([
    "rolsuper",
    "rolbypassrls",
    "rolcreatedb",
    "rolcreaterole",
  ] as const)(
    "identifies the unsafe %s flag without dumping driver data",
    (flag) => {
      expect(() =>
        assertRoleFlags({ ...role, [flag]: true }, "runtime"),
      ).toThrow("Tenant runtime must have " + flag + " = false");
    },
  );
  it("rejects SET ROLE or a privileged fixture connection with sanitized diagnostics", () => {
    const unexpected = { ...role, session_user: "sensitive-connection-value" };
    let message = "";
    try {
      assertRoleFlags(unexpected, "runtime");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(
      "Tenant runtime must use its own restricted LOGIN role",
    );
    expect(message).not.toContain(unexpected.session_user);
  });
  it("creates distinct opaque fixture IDs with real trusted contexts", () => {
    const first = baseTenantFixtures(),
      second = baseTenantFixtures();
    const ids = [
      first.tenantA.churchId,
      first.tenantB.churchId,
      first.userA.userId,
      first.userB.userId,
      first.relationshipA.id,
      first.relationshipB.id,
      second.tenantA.churchId,
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(first.tenantA.context.churchId).toBe(first.tenantA.churchId);
    expect(() => TenantContext.assert(first.tenantA.context)).not.toThrow();
  });
});
