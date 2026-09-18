import { type BrowserContext, expect, type Page, test } from "@playwright/test";

async function signIn(
  page: Page,
  name: string,
  subject: string,
): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: new RegExp(name, "u") }).click();
  await page.getByRole("textbox", { name: "Enter any login" }).fill(subject);
  await page.getByRole("textbox", { name: "and password" }).fill("tutorial");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/p6\.localhost:3006/u);
}

async function signInProfile(
  context: BrowserContext,
  name: string,
  subject: string,
): Promise<Page> {
  const page = await context.newPage();
  await signIn(page, name, subject);
  return page;
}

test("reauthorizes Elena's queued inspection after Rowan reassigns it", async ({
  browser,
  page,
}) => {
  await signIn(page, "Elena Rossi", "elena");
  await page.getByRole("button", { name: /Cooling pump 17/u }).click();
  await expect(
    page.getByRole("heading", { name: "Cooling pump 17" }),
  ).toBeVisible();

  await page.context().setOffline(true);
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Safety guard secured" }).check();
  await page.getByRole("checkbox", { name: "Fluid level checked" }).check();
  await page
    .getByRole("checkbox", { name: "Operating temperature recorded" })
    .check();
  await page
    .getByRole("textbox", { name: "Inspection notes" })
    .fill("Offline pump inspection");
  await page.getByRole("button", { name: "Queue inspection" }).click();
  await expect(
    page.getByText("Inspection queued until reconnect."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry synchronization" }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const request = indexedDB.open("p6-field-inspection", 1);
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction("drafts", "readonly");
        const draftRequest = transaction
          .objectStore("drafts")
          .get("user-elena:wo-pump-17");
        const draft = await new Promise<{ status?: string } | undefined>(
          (resolve, reject) => {
            draftRequest.onsuccess = () => resolve(draftRequest.result);
            draftRequest.onerror = () => reject(draftRequest.error);
          },
        );
        database.close();
        return draft?.status;
      }),
    )
    .toBe("queued");

  const supervisorContext = await browser.newContext();
  try {
    const supervisor = await signInProfile(
      supervisorContext,
      "Rowan Lee",
      "rowan",
    );
    await supervisor.getByRole("button", { name: /Cooling pump 17/u }).click();
    await expect(
      supervisor.getByRole("heading", { name: "Cooling pump 17" }),
    ).toBeVisible();
    await expect(
      supervisor.getByRole("button", { name: "Reassign" }),
    ).toBeEnabled();
    await supervisor.getByRole("button", { name: "Reassign" }).click();
    await expect(supervisor.getByText("Work order reassigned.")).toBeVisible();
  } finally {
    await supervisorContext.close();
  }

  await page.context().setOffline(false);
  await expect(
    page.getByText("Inspection synchronized and work order completed."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cooling pump 17" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Submit inspection" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: /Cooling pump 17.*completed/u }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Cooling pump 17/u }).click();
  await expect(page.getByText("Inspection completed")).toBeVisible();
  await expect(page.getByText(/This work order is read-only/u)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit inspection" }),
  ).toHaveCount(0);
});

test("preserves an offline draft when its work order was deleted", async ({
  browser,
  page,
}) => {
  await signIn(page, "Elena Rossi", "elena");
  await page.getByRole("button", { name: /Air compressor 09/u }).click();
  await page.context().setOffline(true);
  await page.getByRole("checkbox", { name: "Safety guard secured" }).check();
  await page
    .getByRole("textbox", { name: "Inspection notes" })
    .fill("Preserve these offline observations");
  await page.getByRole("button", { name: "Queue inspection" }).click();

  const supervisorContext = await browser.newContext();
  try {
    const supervisor = await signInProfile(
      supervisorContext,
      "Rowan Lee",
      "rowan",
    );
    await supervisor
      .getByRole("button", { name: /Air compressor 09/u })
      .click();
    await supervisor.getByRole("button", { name: "Delete order" }).click();
    await supervisor.getByRole("button", { name: "Confirm delete" }).click();
    await expect(
      supervisor.getByRole("button", { name: /Air compressor 09/u }),
    ).toHaveCount(0);
  } finally {
    await supervisorContext.close();
  }

  await page.context().setOffline(false);
  await expect(
    page.getByRole("heading", { name: "Preserved inspection draft" }),
  ).toBeVisible();
  await expect(
    page.getByText("Preserve these offline observations"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Preserved inspection draft" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Preserved inspection draft" }),
  ).toHaveCount(0);
});

test("distinguishes session-service failure from signed out", async ({
  page,
}) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "service_unavailable" }),
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Application unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Choose a tutorial identity" }),
  ).toHaveCount(0);
});

test("adds and deletes an open work order", async ({ page }) => {
  await signIn(page, "Rowan Lee", "rowan");
  await page.getByRole("button", { name: "Add work order" }).click();
  await page
    .getByRole("textbox", { name: "Equipment" })
    .fill("Hydraulic press 05");
  await page.getByRole("textbox", { name: "Site" }).fill("Machine Hall");
  await page
    .getByRole("combobox", { name: "Initial technician" })
    .selectOption("user-malik");
  await page.getByRole("button", { name: "Add to queue" }).click();

  await expect(
    page.getByRole("heading", { name: "Hydraulic press 05" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete order" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(
    page.getByRole("button", { name: /Hydraulic press 05/u }),
  ).toHaveCount(0);
});
