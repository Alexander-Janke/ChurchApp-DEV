import { describe, expect, it } from "vitest";
import {
  GOOGLE_AUTHENTICATION_ENABLED,
  SOCIAL_PRE_AUTH_LIFETIME_MS,
  challengeHash,
  challengeKey,
  googleCredentials,
  googleInput,
  newSocialChallenge,
} from "../src/auth/google-pre-auth-policy.js";
import { twoFactor } from "better-auth/plugins";

describe("Google pre-authentication policy", () => {
  it("keeps production Google disabled and uses the reviewed ten-minute lifetime", () => {
    expect(GOOGLE_AUTHENTICATION_ENABLED).toBe(false);
    expect(SOCIAL_PRE_AUTH_LIFETIME_MS).toBe(600000);
  });
  it("permits absent optional configuration", () =>
    expect(googleCredentials({})).toBeUndefined());
  it.each([
    { GOOGLE_CLIENT_ID: "placeholder" },
    { GOOGLE_CLIENT_SECRET: "placeholder" },
    { GOOGLE_CLIENT_ID: " ", GOOGLE_CLIENT_SECRET: "placeholder" },
  ])("rejects incomplete configuration without disclosing values", (env) => {
    expect(() => googleCredentials(env)).toThrow(
      "Both Google configuration variables must be nonempty",
    );
  });
  it("keeps account creation and provider profile overwrite disabled in this existing-account foundation", () => {
    const config = googleCredentials({
      GOOGLE_CLIENT_ID: "placeholder",
      GOOGLE_CLIENT_SECRET: "placeholder",
    });
    expect(config?.disableSignUp).toBe(true);
    expect(config?.overrideUserInfoOnSignIn).toBe(false);
  });
  it("generates high-entropy independent challenges and stores only hashed references", () => {
    const a = newSocialChallenge(),
      b = newSocialChallenge();
    expect(a.length).toBe(64);
    expect(a === b).toBe(false);
    expect(challengeKey(a).includes(a)).toBe(false);
    expect(challengeHash(a) === challengeHash(a)).toBe(true);
    expect(challengeHash(a) === challengeHash(b)).toBe(false);
  });
  it.each([null, "", "not-a-token", "A".repeat(64), 1])(
    "rejects malformed challenge reference %#",
    (token) => {
      expect(() => challengeKey(token)).toThrow("Invalid social challenge");
    },
  );
  it("accepts only empty initiation input and code/state callback input", () => {
    expect(googleInput({}, false)).toEqual({});
    expect(
      Object.keys(googleInput({ code: "fixture", state: "fixture" }, true)),
    ).toEqual(["code", "state"]);
  });
  it.each([
    "callbackURL",
    "userId",
    "provider",
    "idToken",
    "trustDevice",
    "elevatedAt",
    "stepUpAt",
    "role",
    "churchId",
  ])("rejects injected %s", (key) => {
    expect(() => googleInput({ [key]: "injected" }, false)).toThrow(
      "Invalid Google request",
    );
    expect(() =>
      googleInput(
        { code: "fixture", state: "fixture", [key]: "injected" },
        true,
      ),
    ).toThrow("Invalid Google request");
  });
  it("KNOWN UPSTREAM/NATIVE LIMITATION — Google social callback bypasses Better Auth two-factor enforcement in pinned 1.7.4", () => {
    const hook = twoFactor().hooks.after[0]!;
    expect(hook.matcher({ path: "/callback/google" } as never)).toBe(false);
    expect(hook.matcher({ path: "/sign-in/social" } as never)).toBe(false);
    expect(hook.matcher({ path: "/sign-in/email" } as never)).toBe(true);
  });
});
