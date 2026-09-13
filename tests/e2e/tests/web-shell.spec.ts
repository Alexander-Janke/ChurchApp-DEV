import { expect, test } from "@playwright/test";

test("main web shell is available", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Church Platform", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("In development", { exact: true })).toBeVisible();
});
