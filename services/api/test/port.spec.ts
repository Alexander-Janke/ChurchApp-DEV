import { describe, expect, it } from "vitest";
import { getPort } from "../src/configure-app.js";

describe("PORT configuration", () => {
  it("accepts a configured port", () => {
    expect(getPort("3100")).toBe(3100);
  });

  it.each(["", "0", "-1", "65536", "3000abc", "3.5"])(
    "rejects invalid port %s",
    (value) => {
      expect(() => getPort(value)).toThrow("PORT must be an integer");
    },
  );
});
