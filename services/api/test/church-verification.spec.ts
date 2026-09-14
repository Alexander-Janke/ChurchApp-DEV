import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  churchVerificationStates,
  parseChurchDetails,
} from "../src/church/church-policy.js";
import {
  evaluateChurchVerificationTransition,
  parseChurchVerificationState,
} from "../src/church/church-verification-policy.js";
import { ChurchVerificationService } from "../src/church/church-verification.service.js";
import { ChurchRepository } from "../src/church/church.repository.js";
import { ChurchModule } from "../src/church/church.module.js";
import { AppModule } from "../src/app.module.js";

// Independent expected matrix: every one of the 25 state pairs is exercised.
const states = [
  "unverified",
  "pending",
  "verified",
  "rejected",
  "revoked",
] as const;
const expected = new Map([
  ["unverified:pending", "request"],
  ["pending:verified", "review"],
  ["pending:rejected", "review"],
  ["rejected:pending", "request"],
  ["verified:revoked", "review"],
  ["revoked:pending", "request"],
]);
describe("church verification domain policy", () => {
  it("reuses the existing five-state model", () => {
    expect(churchVerificationStates).toEqual(states);
  });
  it.each(states)("parses %s", (state) => {
    expect(parseChurchVerificationState(state)).toBe(state);
  });
  it.each([
    null,
    undefined,
    "",
    "Verified",
    " pending ",
    "administrator",
    true,
    {},
    [],
  ])("rejects invalid state without reflecting input (%#)", (value) => {
    expect(() => parseChurchVerificationState(value)).toThrow(
      "Invalid church verification state",
    );
    expect(() =>
      evaluateChurchVerificationTransition(value, "pending"),
    ).toThrow("Invalid church verification state");
    expect(() =>
      evaluateChurchVerificationTransition("pending", value),
    ).toThrow("Invalid church verification state");
  });
  it.each(states.flatMap((from) => states.map((to) => ({ from, to }))))(
    "$from -> $to follows the complete approved matrix",
    ({ from, to }) => {
      const authority = expected.get(`${from}:${to}`);
      const result = evaluateChurchVerificationTransition(from, to);
      if (from === to)
        expect(result).toEqual({ outcome: "unchanged", from, to });
      else if (authority)
        expect(result).toEqual({ outcome: "transition", from, to, authority });
      else expect(result).toEqual({ outcome: "invalid_transition", from, to });
    },
  );
  it("exposes only a request operation, with no arbitrary setter or review persistence service", () => {
    expect(
      Object.getOwnPropertyNames(ChurchVerificationService.prototype),
    ).toEqual(["constructor", "requestVerification"]);
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
    expect(Reflect.getMetadata("controllers", ChurchModule) ?? []).toEqual([]);
    expect(Reflect.getMetadata("imports", AppModule)).not.toContain(
      ChurchModule,
    );
  });
  it.each(states)(
    "ordinary profile/details updates cannot set verificationState=%s",
    (verificationState) => {
      expect(() =>
        parseChurchDetails({
          name: "Church",
          slug: "church",
          verificationState,
        }),
      ).toThrow("Invalid church details");
    },
  );
});
