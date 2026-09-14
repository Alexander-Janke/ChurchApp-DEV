import { expect, expectTypeOf, it } from "vitest";
import type {
  SelfProfile,
  ProfileAddress,
  UpdateSelfProfileRequest,
} from "../src/index.js";
it("exports framework-independent self-profile HTTP contracts", () => {
  const patch: UpdateSelfProfileRequest = {
    username: "alex",
    address: { countryCode: "DE" },
    image: null,
  };
  expect(patch.username).toBe("alex");
  expectTypeOf<SelfProfile["dateOfBirth"]>().toEqualTypeOf<string | null>();
  expectTypeOf<SelfProfile["address"]>().toEqualTypeOf<ProfileAddress | null>();
  expectTypeOf<SelfProfile["profileUpdatedAt"]>().toEqualTypeOf<
    string | null
  >();
});
