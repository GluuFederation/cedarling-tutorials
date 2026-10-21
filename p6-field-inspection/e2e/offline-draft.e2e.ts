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
  await expect(page).toHaveURL("http://localhost:17006/");
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

test("baseline accepts Elena's queued inspection after Rowan reassigns it", async ({
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
  await page
    .getByRole("group", { name: "Equipment condition", exact: true })
    .getByRole("radio", { name: "Pass", exact: true })
    .check();
  await page
    .getByRole("group", { name: "Safety checks", exact: true })
    .getByRole("radio", { name: "Pass", exact: true })
    .check();
  await page
    .getByRole("group", { name: "Functional check", exact: true })
    .getByRole("radio", { name: "Pass", exact: true })
    .check();
  await page
    .getByRole("textbox", { name: "Inspection notes" })
    .fill("Offline pump inspection");
  await page.getByRole("button", { name: "Queue inspection" }).click();
  await expect(
    page.getByText("Inspection queued until reconnect."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry sending" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Inspection notes" }),
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
    await supervisor.getByRole("tab", { name: "Manage order" }).click();
    await expect(
      supervisor.getByRole("button", { name: "Reassign" }),
    ).toBeEnabled();
    await supervisor.getByRole("button", { name: "Reassign" }).click();
    await expect(supervisor.getByText("Work order reassigned.")).toBeVisible();
    await supervisor.getByRole("tab", { name: "Activity" }).click();
    await expect(
      supervisor
        .getByRole("region", { name: "Assignment history" })
        .getByText("Elena Rossi → Malik Johnson"),
    ).toBeVisible();
  } finally {
    await supervisorContext.close();
  }

  await page.context().setOffline(false);
  await expect(
    page.getByText("Inspection submitted. It is awaiting supervisor review."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cooling pump 17" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit inspection" }),
  ).toHaveCount(0);
  const reviewerContext = await browser.newContext();
  try {
    const reviewer = await signInProfile(reviewerContext, "Rowan Lee", "rowan");
    await reviewer.getByRole("button", { name: /Cooling pump 17/u }).click();
    await expect(reviewer.getByText("Offline pump inspection")).toBeVisible();
    await reviewer.getByRole("button", { name: "Complete work order" }).click();
    await expect(
      reviewer.getByText("Review recorded. Work order completed."),
    ).toBeVisible();
  } finally {
    await reviewerContext.close();
  }

  await page.reload();
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
  await expect(
    page.getByRole("heading", { name: "Air compressor 09" }),
  ).toBeVisible();
  await page.context().setOffline(true);
  for (const name of [
    "Equipment condition",
    "Safety checks",
    "Functional check",
  ])
    await page
      .getByRole("group", { name, exact: true })
      .getByRole("radio", { name: "Pass", exact: true })
      .check();
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
    await supervisor.getByRole("tab", { name: "Manage order" }).click();
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

test("explains expiry while keeping an offline draft editable", async ({
  page,
}) => {
  await signIn(page, "Elena Rossi", "elena");
  await page
    .getByRole("button", { name: /Fire suppression panel 12/u })
    .click();
  await expect(
    page.getByRole("heading", { name: "Fire suppression panel 12" }),
  ).toBeVisible();
  const notes = page.getByRole("textbox", { name: "Inspection notes" });
  for (const name of [
    "Equipment condition",
    "Safety checks",
    "Functional check",
  ])
    await page
      .getByRole("group", { name, exact: true })
      .getByRole("radio", { name: "Pass", exact: true })
      .check();
  await notes.fill("Keep this local observation");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Draft saved on this device.", { exact: true }),
  ).toBeVisible();
  await page.clock.install();
  await page.context().setOffline(true);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  // Simulate expiry while the display timer is paused (for example, a sleeping tab).
  await page.clock.setSystemTime(new Date(Date.now() + 301_000));
  await expect(
    page.getByRole("button", { name: "Queue inspection" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Queue inspection" }).click();
  await expect(
    page.getByText("Refresh the work order before queuing this inspection.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/Offline queue permission expired. Reconnect/u),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Queue inspection" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Refresh work order" }),
  ).toBeDisabled();
  await expect(notes).toHaveValue("Keep this local observation");
  await notes.fill("Edited after expiry");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Draft saved on this device.", { exact: true }),
  ).toBeVisible();
  await expect(notes).toHaveValue("Edited after expiry");
  await expect(page.getByRole("button", { name: "Retry sending" })).toHaveCount(
    0,
  );
});

test("retains a failed queued request and sends it after envelope expiry", async ({
  page,
}) => {
  await signIn(page, "Elena Rossi", "elena");
  await page.getByRole("button", { name: /Conveyor motor 08/u }).click();
  for (const name of [
    "Equipment condition",
    "Safety checks",
    "Functional check",
  ])
    await page
      .getByRole("group", { name, exact: true })
      .getByRole("radio", { name: "Pass", exact: true })
      .check();
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Queue inspection" }).click();
  await expect(
    page.getByText("Inspection queued until reconnect."),
  ).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(301_000);
  await page.route("**/api/work-orders/wo-conveyor-08/inspections", (route) =>
    route.abort(),
  );
  await page.context().setOffline(false);
  await expect(
    page.getByText(/The request could not be completed/u),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(
    page.getByText("Connection failed; outcome unknown"),
  ).toBeVisible();
  await expect(page.getByText("No decision received")).toBeVisible();
  await page.getByRole("tab", { name: "Inspection", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry sending" }),
  ).toBeEnabled();
  await page.unroute("**/api/work-orders/wo-conveyor-08/inspections");
  await page.getByRole("button", { name: "Retry sending" }).click();
  await expect(
    page.getByText("Inspection submitted. It is awaiting supervisor review."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(
    page.locator(".technical-details").getByText("FAKE ALLOW", { exact: true }),
  ).toHaveCount(2);
  await expect(page.getByText("HTTP 200", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Ventilation unit 03/u }).click();
  await expect(
    page.getByRole("heading", { name: "Last action", exact: true }),
  ).toHaveCount(0);
});

test("shows an empty queue on mobile and translates an unavailable work order", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "Elena Rossi", "elena");
  await page.route("**/api/work-orders/wo-ventilation-03", (route) =>
    route.fulfill({ status: 404, json: { error: "not_found" } }),
  );
  await page.getByRole("button", { name: /Ventilation unit 03/u }).click();
  await page.getByRole("button", { name: "Back to work orders" }).click();
  await expect(page.getByText("This work order is unavailable.")).toBeVisible();
  await page.route("**/api/work-orders", (route) =>
    route.fulfill({
      json: { workOrders: [], createAllowed: true, nextOffset: null },
    }),
  );
  await page.reload();
  await expect(
    page.getByText(
      "No work orders in the queue. Add one to begin an inspection.",
    ),
  ).toBeVisible();
});

test("requires explicit removal of incompatible drafts and confirms unsaved sign out", async ({
  page,
}) => {
  await signIn(page, "Elena Rossi", "elena");
  await expect(page.locator(".detail-heading")).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open("p6-field-inspection", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("drafts", "readwrite");
    tx.objectStore("drafts").put({
      key: "user-elena:wo-ventilation-03",
      principalId: "user-elena",
      workOrderId: "wo-ventilation-03",
      formatVersion: 2,
      checklist: { safetyGuardSecured: true },
      notes: "Notes from the earlier checklist",
      status: "queued",
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.getByRole("button", { name: /Ventilation unit 03/u }).click();
  await expect(
    page.getByText("Notes from the earlier checklist"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit inspection", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Discard old draft" }).click();
  await expect(
    page.getByText("Notes from the earlier checklist"),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Discard old draft" }).click();
  await expect(
    page.getByRole("button", { name: "Submit inspection", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Inspection notes" })
    .fill("Unsaved observation");
  await page.locator('summary[aria-label="Open account menu"]').click();
  await expect(
    page.getByRole("button", { name: "Change account" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Inspection notes" }),
  ).toHaveValue("Unsaved observation");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("link", { name: /Elena Rossi/u })).toBeVisible();
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
  await page.getByRole("tab", { name: "Manage order" }).click();
  await page.getByRole("button", { name: "Delete order" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(
    page.getByRole("button", { name: /Hydraulic press 05/u }),
  ).toHaveCount(0);
});

test("requires explicit checks, corrections, and review before completing a work order", async ({
  page,
}) => {
  await signIn(page, "Malik Johnson", "malik");
  await page.getByRole("button", { name: /Backup generator 04/u }).click();
  await page.getByRole("button", { name: "Submit inspection" }).click();
  await expect(
    page.getByText("Choose Pass or Fail for every check."),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Equipment condition", exact: true })
    .getByRole("radio", { name: "Fail", exact: true })
    .check();
  for (const name of ["Safety checks", "Functional check"])
    await page
      .getByRole("group", { name, exact: true })
      .getByRole("radio", { name: "Pass", exact: true })
      .check();
  await page.getByRole("button", { name: "Submit inspection" }).click();
  await expect(
    page.getByText("Describe the failed checks in the inspection notes."),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Inspection notes" })
    .fill("Guard needs fastening.");
  await page.getByRole("button", { name: "Submit inspection" }).dblclick();
  await expect(
    page.getByRole("button", { name: "Complete work order" }),
  ).toBeDisabled();
  // The baseline permits this role gap, but still enforces the review lifecycle.
  await page
    .getByRole("textbox", { name: "Review notes" })
    .fill("Fasten the guard and recheck it.");
  await page.getByRole("button", { name: "Request corrections" }).click();
  for (const name of [
    "Equipment condition",
    "Safety checks",
    "Functional check",
  ])
    await page
      .getByRole("group", { name, exact: true })
      .getByRole("radio", { name: "Pass", exact: true })
      .check();
  await page
    .getByRole("textbox", { name: "Inspection notes" })
    .fill("Fastening complete, all checks passed.");
  await page.getByRole("button", { name: "Submit inspection" }).click();
  await page.getByRole("button", { name: "Complete work order" }).click();
  await page.reload();
  await expect(
    page.getByText("Inspection completed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Fastening complete, all checks passed."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(
    page.locator("#panel-activity .inspection-history details"),
  ).toHaveCount(2);
});

test("keeps mobile navigation and scrolling inside the application", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "Elena Rossi", "elena");
  await page.getByRole("button", { name: /Ventilation unit 03/u }).click();
  await expect(
    page.getByRole("heading", { name: "Ventilation unit 03" }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Work orders", exact: true }),
  ).toBeHidden();
  const dimensions = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    width: document.documentElement.scrollWidth,
    footer: document.querySelector("footer")?.getBoundingClientRect().bottom,
  }));
  expect(dimensions).toEqual({ height: 844, width: 390, footer: 844 });
  await page.getByRole("button", { name: "Back to work orders" }).click();
  await expect(
    page.getByRole("heading", { name: "Work orders", exact: true }),
  ).toBeFocused();
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 844, height: 390 },
]) {
  test(`keeps inspection controls reachable on small screens ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await signIn(page, "Elena Rossi", "elena");
    await page.getByRole("button", { name: /Ventilation unit 03/u }).click();
    await expect
      .poll(() =>
        page
          .locator(".brand-lockup img")
          .evaluate((image) => (image as HTMLImageElement).currentSrc),
      )
      .toContain("cedarling-mark");
    await expect(
      page.getByRole("heading", { name: "Ventilation unit 03" }),
    ).toBeFocused();
    for (const control of [
      page
        .getByRole("group", { name: "Equipment condition", exact: true })
        .getByText("Pass", { exact: true }),
      page.getByRole("button", { name: "Submit inspection", exact: true }),
      page.getByRole("button", { name: "Refresh work order", exact: true }),
    ]) {
      await expect(async () => {
        await control.scrollIntoViewIfNeeded();
        const bounds = await control.boundingBox();
        if (!bounds)
          throw new Error("Inspection control has no visible bounds");
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        const footer = await page.locator("footer").boundingBox();
        if (!footer) throw new Error("Footer has no visible bounds");
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(footer.y);
      }).toPass({ timeout: 5_000 });
      await control.click({ trial: true });
    }
    await page.getByRole("tab", { name: "Manage order" }).click();
    await page
      .getByRole("button", { name: "Delete order", exact: true })
      .click({ trial: true });
    expect(
      await page
        .locator(".workspace")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBe(0);
    await page.getByRole("button", { name: "Back to work orders" }).click();
    await expect(
      page.getByRole("heading", { name: "Work orders", exact: true }),
    ).toBeFocused();
    await page.locator('summary[aria-label="Open account menu"]').click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("link", { name: /Elena Rossi/u }),
    ).toBeVisible();
  });
}
