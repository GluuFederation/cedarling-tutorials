import { expect, test } from "@playwright/test";

test("reproduces the three workload authorization gaps", async ({ page }) => {
  const missing = await page.request.get("/missing");
  expect(missing.status()).toBe(404);
  await expect(missing.json()).resolves.toEqual({
    error: "not_found",
    requestId: expect.any(String),
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Plan stock transfer" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Try as Auditor" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Auditor created the transfer",
  );
  await expect(page.getByText("planned", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Release as South" }).click();
  await expect(page.getByRole("status")).toContainText(
    "South released the transfer",
  );
  await expect(page.getByText("in transit", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Receive as North" }).click();
  await expect(page.getByRole("status")).toContainText(
    "North received the transfer",
  );
  await expect(page.getByText("received", { exact: true })).toBeVisible();
});
