import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  STANDARD_ROLES,
  standardRoleId,
  StandardRoleConflictError,
} from "../src/authorization/standard-roles.js";
import { TenantContext } from "../src/database/tenant-context.js";
import { parseRoleId } from "../src/authorization/role-policy.js";

const A = TenantContext.fromAuthorizedScope(
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
);
const B = TenantContext.fromAuthorizedScope(
  "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
);
describe("canonical standard role registry", () => {
  it("contains only the five approved stable keys and display labels", () => {
    expect(STANDARD_ROLES.map(({ key, name }) => [key, name])).toEqual([
      ["group_leader", "Group Leader"],
      ["area_leader", "Area Leader"],
      ["event_administrator", "Event Administrator"],
      ["childrens_worker", "Children’s Worker"],
      ["main_church_administrator", "Main Church Administrator"],
    ]);
  });
  it.each(STANDARD_ROLES.slice(0, 4))(
    "$key deliberately has no tenant-wide entitlement",
    (role) => {
      expect(role.permissions).toEqual([]);
      expect(role.privileged).toBe(false);
      expect(role.isSystem).toBe(true);
      expect(role.description.length).toBeGreaterThan(0);
      expect(role.description.length).toBeLessThanOrEqual(500);
      expect(Object.isFrozen(role)).toBe(true);
      expect(Object.isFrozen(role.permissions)).toBe(true);
    },
  );
  it("adds exactly the approved privileged admin bundle", () => {
    expect(STANDARD_ROLES[4]).toMatchObject({
      key: "main_church_administrator",
      name: "Main Church Administrator",
      isSystem: true,
      privileged: true,
      permissions: ["members.manage", "church.settings.manage"],
    });
    expect(Object.isFrozen(STANDARD_ROLES[4])).toBe(true);
    expect(Object.isFrozen(STANDARD_ROLES[4]!.permissions)).toBe(true);
  });
  it("has immutable unique definitions and no ownership/platform role", () => {
    expect(Object.isFrozen(STANDARD_ROLES)).toBe(true);
    expect(new Set(STANDARD_ROLES.map((r) => r.key)).size).toBe(5);
    expect(new Set(STANDARD_ROLES.map((r) => r.name.toLowerCase())).size).toBe(
      5,
    );
    expect(STANDARD_ROLES.some((r) => /owner|superadmin/i.test(r.name))).toBe(
      false,
    );
  });
  it("uses stable tenant-qualified IDs rather than display-name identity", () => {
    expect(standardRoleId(A, "group_leader")).toBe(
      `system-role:${A.churchId}:group_leader`,
    );
    const ids = [A, B].flatMap((c) =>
      STANDARD_ROLES.map((r) => standardRoleId(c, r.key)),
    );
    expect(new Set(ids).size).toBe(10);
    for (const id of ids) expect(parseRoleId(id)).toBe(id);
  });
  it("rejects forged scope and unknown runtime keys", () => {
    expect(() =>
      // @ts-expect-error deliberately untrusted input
      standardRoleId({ churchId: A.churchId }, "group_leader"),
    ).toThrow();
    // @ts-expect-error deliberately unregistered input
    expect(() => standardRoleId(A, "primary_owner")).toThrow(
      "Invalid standard role key",
    );
  });
  it("reports collisions without revealing the colliding role or tenant", () => {
    const error = new StandardRoleConflictError();
    expect(error.code).toBe("STANDARD_ROLE_CONFLICT");
    expect(error.message).toBe(
      "Standard role provisioning conflicts with an existing role",
    );
    expect(error.cause).toBeUndefined();
  });
});
