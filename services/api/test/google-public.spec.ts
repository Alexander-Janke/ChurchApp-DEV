import { describe, expect, it } from "vitest";
import {
  GOOGLE_PUBLIC_CALLBACK_LIMIT,
  GOOGLE_PUBLIC_INITIATION_LIMIT,
  GOOGLE_PUBLIC_LIMIT_WINDOW_MS,
  GooglePublicLimiter,
} from "../src/auth/google-public-policy.js";

describe("public Google source throttling", () => {
  it("limits initiation and callback independently within one minute", () => {
    const limiter = new GooglePublicLimiter();
    for (let i = 0; i < GOOGLE_PUBLIC_INITIATION_LIMIT; i++)
      limiter.consume("initiation", "socket-a", 1_000);
    expect(() => limiter.consume("initiation", "socket-a", 1_000)).toThrow();
    for (let i = 0; i < GOOGLE_PUBLIC_CALLBACK_LIMIT; i++)
      limiter.consume("callback", "socket-a", 1_000);
    expect(() => limiter.consume("callback", "socket-a", 1_000)).toThrow();
    expect(() =>
      limiter.consume(
        "initiation",
        "socket-a",
        1_000 + GOOGLE_PUBLIC_LIMIT_WINDOW_MS,
      ),
    ).not.toThrow();
  });

  it("fails closed at bounded capacity without evicting active keys", () => {
    const limiter = new GooglePublicLimiter();
    for (let i = 0; i < 10_000; i++)
      limiter.consume("callback", `socket-${i}`, 1_000);
    expect(() => limiter.consume("callback", "new-socket", 1_000)).toThrow();
    expect(limiter.size).toBe(10_000);
    expect(() =>
      limiter.consume(
        "callback",
        "new-socket",
        1_000 + GOOGLE_PUBLIC_LIMIT_WINDOW_MS,
      ),
    ).not.toThrow();
  });
});
