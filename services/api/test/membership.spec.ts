import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import {
  parseRelationshipCreation,
  parseRelationshipStatus,
  parseRelationshipTransition,
  parseRelationshipPage,
  relationshipStatuses,
} from "../src/membership/membership-policy.js";
import { MembershipRepository } from "../src/membership/membership.repository.js";
import { MembershipService } from "../src/membership/membership.service.js";
import { churchMembership } from "../src/database/schema/church-membership.js";
import { TenantContext } from "../src/database/tenant-context.js";
import type { TenantDatabase } from "../src/database/tenant-database.js";
import type { DatabaseTransaction } from "../src/database/database.types.js";
import type { SQL } from "drizzle-orm";

describe("membership structural policy", () => {
  it.each(["follower", "member", "inactive", "left"])(
    "accepts relationship state %s",
    (s) => expect(parseRelationshipStatus(s)).toBe(s),
  );
  it.each(["admin", "owner", "pending", "Member", "", null, 0])(
    "rejects invalid state (%#)",
    (s) =>
      expect(() => parseRelationshipStatus(s)).toThrow(
        "Invalid relationship status",
      ),
  );
  it("keeps all structural transitions available without pretending to authorize workflows", () => {
    for (const from of relationshipStatuses)
      for (const to of relationshipStatuses)
        expect(parseRelationshipTransition(from, to)).toEqual({
          expected: from,
          next: to,
        });
    expect(() => parseRelationshipTransition("member", "admin")).toThrow();
  });
  it.each(["churchId", "id", "role", "permissions", "isOwner"])(
    "rejects protected creation field %s",
    (field) => {
      expect(() =>
        parseRelationshipCreation({
          userId: "user-a",
          status: "member",
          [field]: "foreign",
        }),
      ).toThrow("Invalid relationship input");
    },
  );
  it("requires an explicit user and state without reflecting invalid values", () => {
    expect(() => parseRelationshipCreation({ status: "member" })).toThrow(
      "Invalid relationship selector",
    );
    expect(() => parseRelationshipCreation({ userId: "user-a" })).toThrow(
      "Invalid relationship status",
    );
    expect(() =>
      parseRelationshipCreation({
        userId: "secret-value",
        status: "secret-value",
      }),
    ).toThrow(/^Invalid relationship status$/);
  });
  it("bounds tenant-local pagination and validates cursor", () => {
    expect(parseRelationshipPage(100, "cursor")).toEqual({
      limit: 100,
      after: "cursor",
    });
    for (const limit of [0, 101, 1.5])
      expect(() => parseRelationshipPage(limit)).toThrow();
    expect(() => parseRelationshipPage(1, "")).toThrow();
  });
  it("uses opaque distinct IDs and only the six relationship fields", () => {
    const factory = churchMembership.id.defaultFn!;
    const one = factory(),
      two = factory();
    expect(one).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(two).not.toBe(one);
    expect(getTableConfig(churchMembership).columns.map((c) => c.name)).toEqual(
      ["id", "church_id", "user_id", "status", "created_at", "updated_at"],
    );
  });
  it("has only scoped methods and no raw update/delete/global listing API", () => {
    expect(
      Object.getOwnPropertyNames(MembershipRepository.prototype)
        .filter((k) => k !== "constructor")
        .sort(),
    ).toEqual(
      [
        "getRelationshipById",
        "getRelationshipForUser",
        "listRelationships",
        "createRelationship",
        "changeRelationshipStatus",
      ].sort(),
    );
  });
  it("rejects forged context before database access", async () => {
    const tx = {} as DatabaseTransaction;
    await expect(
      new MembershipRepository().getRelationshipById(
        { churchId: randomUUID() } as TenantContext,
        tx,
        "foreign",
      ),
    ).rejects.toThrow("Trusted tenant context");
  });
  it("uses explicit tenant and ID predicates independently of RLS", async () => {
    const context = TenantContext.fromAuthorizedScope(randomUUID());
    const where = vi.fn().mockResolvedValue([]);
    const tx = {
      select: () => ({ from: () => ({ where }) }),
    } as unknown as DatabaseTransaction;
    await new MembershipRepository().getRelationshipById(
      context,
      tx,
      "foreign-id",
    );
    const query = new PgDialect().sqlToQuery(where.mock.calls[0]![0] as SQL);
    expect(query.sql).toContain('"church_membership"."church_id" =');
    expect(query.sql).toContain('"church_membership"."id" =');
    expect(query.params).toEqual([context.churchId, "foreign-id"]);
  });
  it("derives insert ownership from context and returns a safe duplicate result", async () => {
    const context = TenantContext.fromAuthorizedScope(randomUUID());
    const conflict = vi.fn().mockReturnValue({ returning: async () => [] });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing: conflict });
    const tx = { insert: () => ({ values }) } as unknown as DatabaseTransaction;
    expect(
      await new MembershipRepository().createRelationship(context, tx, {
        userId: "user-a",
        status: "follower",
      }),
    ).toEqual({ outcome: "already_exists" });
    expect(values.mock.calls[0]![0]).toEqual({
      churchId: context.churchId,
      userId: "user-a",
      status: "follower",
    });
    expect(conflict.mock.calls[0]![0].target).toEqual([
      churchMembership.churchId,
      churchMembership.userId,
    ]);
  });
  it("changes only status/timestamp with tenant, ID and expected-state predicates", async () => {
    const context = TenantContext.fromAuthorizedScope(randomUUID());
    const row = { id: "stable-id", status: "left" };
    const where = vi.fn().mockReturnValue({ returning: async () => [row] });
    const set = vi.fn().mockReturnValue({ where });
    const tx = { update: () => ({ set }) } as unknown as DatabaseTransaction;
    expect(
      await new MembershipRepository().changeRelationshipStatus(
        context,
        tx,
        "stable-id",
        "member",
        "left",
      ),
    ).toEqual(row);
    expect(Object.keys(set.mock.calls[0]![0]).sort()).toEqual([
      "status",
      "updatedAt",
    ]);
    expect(
      new PgDialect().sqlToQuery(where.mock.calls[0]![0] as SQL).params,
    ).toEqual([context.churchId, "stable-id", "member"]);
  });
  it("sanitizes database errors without leaking input or SQL diagnostics", async () => {
    const tenants = {
      transaction: vi
        .fn()
        .mockRejectedValue(new Error("sensitive database details")),
    } as unknown as TenantDatabase;
    const service = new MembershipService(tenants, new MembershipRepository());
    await expect(
      service.getRelationshipById(
        TenantContext.fromAuthorizedScope(randomUUID()),
        "id",
      ),
    ).rejects.toThrow(/^Membership operation failed$/);
  });
});
