import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  parseChurchDetails,
  churchStatuses,
  churchVerificationStates,
} from "../src/church/church-policy.js";
import { TenantContext } from "../src/database/tenant-context.js";
import { TenantDatabase } from "../src/database/tenant-database.js";
import { DatabaseService } from "../src/database/database.service.js";
import { ChurchRepository } from "../src/church/church.repository.js";

describe("church policy and trusted scope", () => {
  it("normalizes slug casing and trims Unicode church names", () => {
    const d = parseChurchDetails({ name: "  Église 東京  ", slug: "CHURCH-1" });
    expect(d.name).toBe("Église 東京");
    expect(d.slug).toBe("church-1");
    expect(d.logo).toBeNull();
    expect(d.addressLine1).toBeNull();
  });
  it.each(["ab", "-abc", "abc-", "a b", "église", "a".repeat(64)])(
    "rejects invalid slug %s",
    (slug) => {
      expect(() => parseChurchDetails({ name: "Church", slug })).toThrow(
        "Invalid church details",
      );
    },
  );
  it("accepts exact slug and Unicode name limits", () => {
    expect(
      parseChurchDetails({ name: "界".repeat(200), slug: "a".repeat(63) }).name,
    ).toHaveLength(200);
  });
  it.each([" ", "x".repeat(201)])(
    "rejects empty/oversized name (%#)",
    (name) => {
      expect(() => parseChurchDetails({ name, slug: "church" })).toThrow(
        "Invalid church details",
      );
    },
  );
  it("validates structured address and nullable denomination", () => {
    const d = parseChurchDetails({
      name: "Church",
      slug: "church",
      countryCode: "DE",
      locality: " Köln ",
      denomination: "  Protestant ",
    });
    expect(d.locality).toBe("Köln");
    expect(d.denomination).toBe("Protestant");
  });
  it.each([
    { countryCode: "de" },
    { countryCode: "DEU" },
    { locality: "x".repeat(121) },
    { denomination: "x".repeat(121) },
    { addressLine1: "x".repeat(201) },
  ])("rejects invalid address/denomination (%#)", (extra) => {
    expect(() =>
      parseChurchDetails({ name: "Church", slug: "church", ...extra }),
    ).toThrow("Invalid church details");
  });
  it("accepts only HTTPS references without credentials", () => {
    expect(
      parseChurchDetails({
        name: "Church",
        slug: "church",
        logo: "https://example.invalid/logo.png",
      }).logo,
    ).toBe("https://example.invalid/logo.png");
  });
  it.each([
    "http://example.invalid/a",
    "https://u:p@example.invalid/a",
    "javascript:alert(1)",
    "data:image/png;base64,a",
    "file:///a",
    "C:/a",
  ])("rejects unsafe logo (%#)", (logo) => {
    expect(() =>
      parseChurchDetails({ name: "Church", slug: "church", logo }),
    ).toThrow("Invalid church details");
  });
  it("rejects ownership and lifecycle fields in ordinary details updates", () => {
    for (const field of [
      "id",
      "churchId",
      "primaryOwnerId",
      "status",
      "verificationState",
      "role",
    ])
      expect(() =>
        parseChurchDetails({
          name: "Church",
          slug: "church",
          [field]: "value",
        }),
      ).toThrow("Invalid church details");
  });
  it("defines separate minimal lifecycle and verification states", () => {
    expect(churchStatuses).toEqual(["active", "inactive"]);
    expect(churchVerificationStates).toEqual([
      "unverified",
      "pending",
      "verified",
      "rejected",
      "revoked",
    ]);
  });
  it("trusted server construction is immutable and cannot be replaced by JSON or prototype forgery", () => {
    const id = randomUUID();
    const context = TenantContext.fromAuthorizedScope(id);
    expect(context.churchId).toBe(id);
    expect(Object.isFrozen(context)).toBe(true);
    expect(() => TenantContext.assert(context)).not.toThrow();
    expect(() => TenantContext.assert({ churchId: id })).toThrow(
      "Trusted tenant context",
    );
    expect(() =>
      TenantContext.assert(Object.create(TenantContext.prototype)),
    ).toThrow("Trusted tenant context");
  });
  it("rejects malformed scope without reflecting input in diagnostics", () => {
    const diagnostic = "private-invalid-value";
    let message = "";
    try {
      TenantContext.fromAuthorizedScope(diagnostic);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("Invalid tenant scope");
    expect(message).not.toContain(diagnostic);
  });
  it("missing trusted context fails before acquiring a transaction", async () => {
    const database = Object.create(
      DatabaseService.prototype,
    ) as DatabaseService;
    const spy = vi.spyOn(database, "transaction");
    await expect(
      new TenantDatabase(database).transaction(
        { churchId: randomUUID() } as TenantContext,
        async () => null,
      ),
    ).rejects.toThrow("Trusted tenant context");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("repository exposes only scoped details and specialized request operations", () => {
    expect(
      Object.getOwnPropertyNames(ChurchRepository.prototype).sort(),
    ).toEqual(
      [
        "constructor",
        "getCurrentChurch",
        "updateCurrentChurch",
        "requestVerification",
      ].sort(),
    );
  });
});
