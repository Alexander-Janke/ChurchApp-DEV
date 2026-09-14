import { AppModule } from "../src/app.module.js";
import { STANDARD_ROLES } from "../src/authorization/standard-roles.js";
import "reflect-metadata";
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  eligibleOwner,
  mayTransfer,
  assertOwnershipSubject,
} from "../src/ownership/ownership-policy.js";
import { OwnershipService } from "../src/ownership/ownership.service.js";
import { OwnershipRepository } from "../src/ownership/ownership.repository.js";
import { OwnershipModule } from "../src/ownership/ownership.module.js";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { parseChurchDetails } from "../src/church/church-policy.js";

it.each(["member", "inactive", "follower", "left", "Primary Owner", null])(
  "eligibility uses membership state, not role: %s",
  (status) => {
    expect(eligibleOwner(status, true, true)).toBe(status === "member");
  },
);
it.each([
  [false, true],
  [true, false],
  [undefined, true],
  [true, undefined],
  ["true", true],
])(
  "both verified and enabled must be literal true (%#)",
  (enabled, verified) => {
    expect(eligibleOwner("member", enabled, verified)).toBe(false);
  },
);
it.each([
  [false, true, true, true, false],
  [true, false, true, true, false],
  [true, true, false, true, false],
  [true, true, true, false, false],
  [true, true, true, true, true],
])(
  "transfer requires ownership and every assurance prerequisite (%#)",
  (owner, authenticated, elevated, recentStepUp, expected) => {
    expect(
      mayTransfer(owner!, {
        authenticated: authenticated!,
        elevated: elevated!,
        recentStepUp: recentStepUp!,
      }),
    ).toBe(expected);
  },
);
it.each([
  "isOwner",
  "primaryOwner",
  "ownerMembershipId",
  "elevated",
  "stepUpAt",
])("rejects caller ownership/assurance field %s", (field) => {
  expect(() =>
    assertOwnershipSubject({
      userId: "user",
      sessionId: "session",
      [field]: true,
    }),
  ).toThrow("Server-resolved ownership actor required");
  expect(() =>
    parseChurchDetails({ name: "Church", slug: "church", [field]: true }),
  ).toThrow();
});
it("does not expose controllers, generic removal or audit rewriting", () => {
  expect(
    (Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ?? []).includes(
      OwnershipModule,
    ),
  ).toBe(false);
  expect(
    Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, OwnershipModule) ?? [],
  ).toEqual([]);
  expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, OwnershipModule)).toEqual(
    [OwnershipService],
  );
  const methods = Object.getOwnPropertyNames(OwnershipService.prototype);
  expect(methods.includes("removePrimaryOwner")).toBe(false);
  expect(
    Object.getOwnPropertyNames(OwnershipRepository.prototype).some((n) =>
      /delete|remove|updateAudit/.test(n),
    ),
  ).toBe(false);
});
it("preserves explicit accepted upstream limitation and no owner role", () => {
  const security = readFileSync(
    new URL("../../../docs/SECURITY.md", import.meta.url),
    "utf8",
  );
  expect(
    STANDARD_ROLES.some((role) =>
      /owner|main church administrator/i.test(role.name),
    ),
  ).toBe(false);
  expect(security.includes("SECURITY ACCEPTANCE — TOTP REPLAY")).toBe(true);
  expect(security.includes("better-auth/better-auth#10387")).toBe(true);
});
