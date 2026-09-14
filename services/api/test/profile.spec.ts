import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { parseProfilePatch } from "../src/profile/profile.dto.js";
import { mapSelfProfile } from "../src/profile/profile.mapper.js";

describe("self-profile validation and mapping", () => {
  it.each(["Alex", "alex", "ALEx"])("canonicalizes username %s", (username) => {
    expect(parseProfilePatch({ username })).toEqual({ username: "alex" });
  });
  it.each(["ab", ".abc", "abc-", "a b", "älex", "x".repeat(31)])(
    "rejects invalid username %s",
    (username) => {
      expect(() => parseProfilePatch({ username })).toThrow(
        "Invalid profile update",
      );
    },
  );
  it("trims Unicode names without folding or truncation", () => {
    expect(
      parseProfilePatch({ firstName: "  Élodie 林  ", lastName: "  Müller  " }),
    ).toEqual({ firstName: "Élodie 林", lastName: "Müller" });
    expect(() => parseProfilePatch({ firstName: " ".repeat(5) })).toThrow();
    expect(() => parseProfilePatch({ lastName: "x".repeat(101) })).toThrow();
    expect(
      parseProfilePatch({ firstName: "𠮷".repeat(100) }).firstName,
    ).toHaveLength(200);
  });
  it("uses calendar date-only validation and an explicit today boundary", () => {
    expect(
      parseProfilePatch({ dateOfBirth: "2000-02-29" }, "2026-09-14")
        .dateOfBirth,
    ).toBe("2000-02-29");
    expect(
      parseProfilePatch({ dateOfBirth: "2026-09-14" }, "2026-09-14")
        .dateOfBirth,
    ).toBe("2026-09-14");
    for (const v of [
      "2001-02-29",
      "2026-09-15",
      "2020-02-30",
      "0000-01-01",
      "2020-01-01T00:00:00Z",
    ])
      expect(() =>
        parseProfilePatch({ dateOfBirth: v }, "2026-09-14"),
      ).toThrow();
  });
  it("accepts canonical E.164 only", () => {
    expect(parseProfilePatch({ phoneNumber: "+49123456789" }).phoneNumber).toBe(
      "+49123456789",
    );
    for (const v of [
      "0049123456789",
      "+0123456789",
      "+49 12345678",
      "12345678",
    ])
      expect(() => parseProfilePatch({ phoneNumber: v })).toThrow();
  });
  it("treats an address object as a complete replacement", () => {
    expect(
      parseProfilePatch({
        address: { locality: " Berlin ", countryCode: "DE" },
      }).address,
    ).toEqual({
      line1: null,
      line2: null,
      postalCode: null,
      locality: "Berlin",
      region: null,
      countryCode: "DE",
    });
    expect(parseProfilePatch({ address: null })).toEqual({ address: null });
    expect(() =>
      parseProfilePatch({ address: { countryCode: "de" } }),
    ).toThrow();
    expect(() => parseProfilePatch({ address: { role: "admin" } })).toThrow();
  });
  it("preserves plain text and counts Unicode code points for biography", () => {
    const biography = "<plain text>\n" + "𠮷".repeat(1987);
    expect(parseProfilePatch({ biography }).biography).toBe(biography);
    expect(() => parseProfilePatch({ biography: "𠮷".repeat(2001) })).toThrow();
  });
  it.each([
    "javascript:alert(1)",
    "data:image/png;base64,x",
    "file:///tmp/x",
    "C:/image.png",
    "http://localhost/x",
    "https://name:password@example.test/x",
  ])("rejects unsafe image reference %s", (image) => {
    expect(() => parseProfilePatch({ image })).toThrow();
  });
  it("supports HTTPS references and explicit nullable removal", () => {
    expect(
      parseProfilePatch({
        image: "https://example.test/a.png",
        username: null,
        firstName: null,
        lastName: null,
        phoneNumber: null,
        dateOfBirth: null,
        biography: null,
      }),
    ).toEqual({
      image: "https://example.test/a.png",
      username: null,
      firstName: null,
      lastName: null,
      phoneNumber: null,
      dateOfBirth: null,
      biography: null,
    });
    expect(parseProfilePatch({ image: null })).toEqual({ image: null });
  });
  it("rejects empty, non-object and protected fields with no value diagnostics", () => {
    for (const body of [
      {},
      null,
      [],
      { firstName: 1 },
      { email: "private-value" },
      { name: "private-value" },
      { userId: "private-value" },
    ]) {
      expect(() => parseProfilePatch(body)).toThrow("Invalid profile update");
    }
  });
  it("maps an explicit safe response without guessing names or exposing extra fields", () => {
    const identity = {
      id: "u",
      email: "self@example.invalid",
      emailVerified: true,
      image: null,
      createdAt: new Date("2020-01-01"),
      password: "private",
      token: "private",
      name: "Not a structured name",
    };
    const result = mapSelfProfile(identity, null);
    expect(Object.keys(result).sort()).toEqual(
      [
        "id",
        "email",
        "emailVerified",
        "image",
        "username",
        "firstName",
        "lastName",
        "dateOfBirth",
        "phoneNumber",
        "address",
        "biography",
        "identityCreatedAt",
        "profileCreatedAt",
        "profileUpdatedAt",
      ].sort(),
    );
    expect(result.firstName).toBeNull();
    expect(result.profileUpdatedAt).toBeNull();
    expect(JSON.stringify(result).includes("private")).toBe(false);
  });
});
