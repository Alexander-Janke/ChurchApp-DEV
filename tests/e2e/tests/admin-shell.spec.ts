import { expect, test } from "@playwright/test";

test("platform admin shell is available", async ({ page }) => {
  await page.goto("http://localhost:3002/");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Platform Administration",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("In development", { exact: true })).toBeVisible();
});
