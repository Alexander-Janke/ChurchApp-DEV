import "reflect-metadata";
import { describe, it, expect } from "vitest";
import {
  parseSettingsPatch,
  parseMemberPage,
  mapSettings,
  mapMember,
  isSlugConflict,
} from "../src/church-admin/admin-policy.js";
import { AdminMutationLimiter } from "../src/church-admin/admin-limiter.js";
import { AdminAuditRepository } from "../src/church-admin/admin-audit.repository.js";
import { ChurchAdminController } from "../src/church-admin/church-admin.controller.js";
import { parseChurchDetails } from "../src/church/church-policy.js";
describe("church administration boundary", () => {
  it("normalizes ordinary fields using the canonical church policy", () =>
    expect(
      parseSettingsPatch({
        name: "  Église  ",
        slug: "New-Church",
        locality: " Paris ",
      }),
    ).toEqual({ name: "Église", slug: "new-church", locality: "Paris" }));
  it("preserves omission and explicit nullable clearing", () =>
    expect(parseSettingsPatch({ logo: null })).toEqual({ logo: null }));
  it.each([
    {},
    null,
    [],
    { name: " " },
    { slug: "a" },
    { logo: "data:image/png,x" },
    { countryCode: "de" },
    { locality: "x".repeat(121) },
    { denomination: 123 },
    { name: undefined },
  ])("rejects invalid/empty settings %#", (v) =>
    expect(() => parseSettingsPatch(v)).toThrow("Invalid church settings"),
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
    "actorUserId",
    "sessionId",
  ])("rejects protected %s", (k) =>
    expect(() => parseSettingsPatch({ name: "Allowed", [k]: true })).toThrow(
      "Invalid church settings",
    ),
  );
  it("bounds paging with opaque membership cursor", () => {
    expect(parseMemberPage({})).toEqual({ limit: 50, after: undefined });
    expect(parseMemberPage({ limit: "100", after: "cursor" })).toEqual({
      limit: 100,
      after: "cursor",
    });
  });
  it.each([
    { limit: "0" },
    { limit: "101" },
    { limit: ["2"] },
    { after: [] },
    { userId: "foreign" },
    { limit: "1e2" },
  ])("rejects invalid paging %#", (q) =>
    expect(() => parseMemberPage(q)).toThrow("Invalid member page"),
  );
  it("explicit response mapping excludes private/auth and ownership data", () => {
    const row = {
      ...parseChurchDetails({ name: "Church", slug: "church" }),
      id: "church",
      status: "active",
      verificationState: "unverified",
      secret: "not-returned",
      owner: "not-returned",
    };
    expect(Object.keys(mapSettings(row)).sort()).toEqual(
      [
        "id",
        "name",
        "slug",
        "addressLine1",
        "addressLine2",
        "postalCode",
        "locality",
        "region",
        "countryCode",
        "denomination",
        "logo",
        "status",
        "verificationState",
      ].sort(),
    );
    expect(
      mapMember({
        id: "membership",
        userId: "user",
        status: "member",
        ...{ token: "not-returned", email: "not-returned" },
      }),
    ).toEqual({ id: "membership", userId: "user", status: "member" });
  });
  it("limits 20 mutations per user per minute without cross-user interference", () => {
    const limiter = new AdminMutationLimiter();
    for (let i = 0; i < 20; i++) limiter.consume("a", 1);
    expect(() => limiter.consume("a", 59999)).toThrow();
    expect(() => limiter.consume("b", 2)).not.toThrow();
    expect(() => limiter.consume("a", 60001)).not.toThrow();
  });
  it("fails closed at bounded limiter capacity instead of evicting live entries", () => {
    const l = new AdminMutationLimiter();
    for (let i = 0; i < 10000; i++) l.consume(String(i), 1);
    expect(() => l.consume("next", 1)).toThrow();
    expect(() => l.consume("next", 60001)).not.toThrow();
  });
  it("audit has no update/delete surface and controller has only settings/list methods", () => {
    expect(
      Object.getOwnPropertyNames(AdminAuditRepository.prototype).sort(),
    ).toEqual(["appendSettingsUpdated", "constructor", "list"]);
    expect(
      Object.getOwnPropertyNames(ChurchAdminController.prototype).sort(),
    ).toEqual(["constructor", "members", "settings"]);
  });
  it("recognizes only canonical slug uniqueness for safe conflict mapping", () => {
    expect(
      isSlugConflict({
        cause: { code: "23505", constraint: "church_slug_idx" },
      }),
    ).toBe(true);
    expect(isSlugConflict({ code: "23505", constraint: "other" })).toBe(false);
  });
});
