import { expect, type Page, test } from "@playwright/test";
import type { WorkOrderDetail } from "../src/shared/types.ts";

const workOrderPath = "**/api/work-orders/wo-ventilation-03";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: /Elena Rossi/u }).click();
  await page.getByRole("textbox", { name: "Enter any login" }).fill("elena");
  await page
    .getByRole("textbox", { name: "and password" })
    .fill("cedarling-is-awesome");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Ventilation unit 03/u }).click();
  await expect(
    page.getByRole("textbox", { name: "Inspection notes" }),
  ).toBeVisible();
}

test("refresh renews an expired queue window, reports unchanged data and ignores duplicate clicks", async ({
  page,
}) => {
  let reads = 0;
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(workOrderPath, async (route) => {
    reads += 1;
    const response = await route.fetch();
    const record: WorkOrderDetail = await response.json();
    if (reads !== 1) await pending;
    await route.fulfill({
      response,
      json:
        reads === 1
          ? {
              ...record,
              envelope: {
                ...record.envelope,
                expiresAt: new Date(0).toISOString(),
              },
            }
          : record,
    });
  });
  await signIn(page);
  await expect(
    page.getByRole("button", { name: "Submit inspection", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Refresh work order", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  try {
    await expect(
      page.getByRole("button", { name: "Refreshing…", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("textbox", { name: "Inspection notes" }),
    ).toBeDisabled();
    await expect.poll(() => reads).toBe(2);
  } finally {
    release();
  }
  await expect(
    page.getByText("Work order is up to date.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit inspection", exact: true }),
  ).toBeEnabled();
  expect(reads).toBe(2);
  await expect(
    page.getByText("Technical details", { exact: true }),
  ).toBeHidden();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  const technical = page.locator(".technical-details");
  await expect(technical).not.toHaveAttribute("open", "");
  await technical.locator("summary").click();
  await expect(technical).toContainText("Work v1 · Assignment v1");
});

test("a failed refresh keeps unsaved notes and a canceled refresh sends no request", async ({
  page,
}) => {
  await signIn(page);
  const notes = page.getByRole("textbox", { name: "Inspection notes" });
  await notes.fill("Keep this observation");
  let attempts = 0;
  await page.route(workOrderPath, (route) => {
    attempts += 1;
    return route.fulfill({ status: 503, json: { error: "unavailable" } });
  });
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Refresh work order", exact: true })
    .click();
  expect(attempts).toBe(0);
  await expect(notes).toHaveValue("Keep this observation");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Refresh work order", exact: true })
    .click();
  await expect(
    page.getByText(/The request could not be completed/u),
  ).toBeVisible();
  await expect(notes).toHaveValue("Keep this observation");
  await expect(
    page.getByText("Work order is up to date.", { exact: true }),
  ).toHaveCount(0);
  await page.unroute(workOrderPath);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Refresh work order", exact: true })
    .click();
  await expect(
    page.getByText("Work order is up to date.", { exact: true }),
  ).toBeVisible();
  await expect(notes).toHaveValue("");
});

test("refresh shows changed server facts while retaining a saved draft's expected version", async ({
  page,
}) => {
  await signIn(page);
  const notes = page.getByRole("textbox", { name: "Inspection notes" });
  await notes.fill("Saved before the record changed");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Draft saved on this device.", { exact: true }),
  ).toBeVisible();
  await page.route(workOrderPath, async (route) => {
    const response = await route.fetch();
    const record: WorkOrderDetail = await response.json();
    await route.fulfill({
      response,
      json: {
        ...record,
        workOrderVersion: 3,
        assignmentEpoch: 2,
        assigneeId: "user-elena",
        assigneeName: "Elena Rossi",
        status: "changes_requested",
      },
    });
  });
  await page
    .getByRole("button", { name: "Refresh work order", exact: true })
    .click();
  await expect(
    page.getByText("Work order updated.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".record-context")).toContainText(
    "Assigned to Elena Rossi",
  );
  await expect(notes).toHaveValue("Saved before the record changed");
  await expect(page.locator(".version-conflict")).toContainText(
    "This draft uses work v1. The current record is v3.",
  );
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.locator(".technical-details")).toContainText(
    "Work v3 · Assignment v2",
  );
  await page.reload();
  await expect(page.locator(".version-conflict")).toContainText(
    "This draft uses work v1.",
  );
});

test("change account confirms unsaved changes and ends the session", async ({
  page,
}) => {
  await signIn(page);
  const notes = page.getByRole("textbox", { name: "Inspection notes" });
  await notes.fill("Before account change");
  await page.locator('summary[aria-label="Open account menu"]').click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Change account", exact: true })
    .click();
  await expect(notes).toHaveValue("Before account change");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Change account", exact: true })
    .click();
  await expect(page.getByRole("link", { name: /Elena Rossi/u })).toBeVisible();
  expect((await page.request.get("/api/session")).status()).toBe(401);
});
