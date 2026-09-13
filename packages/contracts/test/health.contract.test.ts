import { describe, expect, it } from "vitest";
import { HEALTH_RESPONSE, type HealthResponse } from "../src/index.js";

describe("health contract", () => {
  it("exports the stable health response", () => {
    const response: HealthResponse = HEALTH_RESPONSE;

    expect(response).toEqual({ status: "ok" });
  });
});
