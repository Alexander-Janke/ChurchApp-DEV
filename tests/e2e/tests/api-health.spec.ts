import { expect, test } from "@playwright/test";

test("API health endpoint returns the stable response", async ({ request }) => {
  const response = await request.get("http://localhost:3001/api/v1/health");

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
