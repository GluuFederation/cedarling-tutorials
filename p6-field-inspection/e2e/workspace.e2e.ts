import { expect, type Page, test } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: /Elena Rossi/u }).click();
  await page.getByRole("textbox", { name: "Enter any login" }).fill("elena");
  await page.getByRole("textbox", { name: "and password" }).fill("tutorial");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Ventilation unit 03/u }).click();
}

test("keeps a denied submission recoverable after read access is lost and the page reloads", async ({
  page,
}) => {
  await signIn(page);
  let denied = false;
  await page.route("**/api/work-orders**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST" && path.endsWith("/inspections")) {
      denied = true;
      await route.fulfill({ status: 403, json: { error: "forbidden" } });
    } else if (denied && path === "/api/work-orders") {
      await route.fulfill({
        json: { workOrders: [], createAllowed: true, nextOffset: null },
      });
    } else if (denied) {
      await route.fulfill({ status: 404, json: { error: "not_found" } });
    } else await route.continue();
  });
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
    .fill("Recover my denied inspection");
  await page
    .getByRole("button", { name: "Submit inspection", exact: true })
    .click();
  await expect.poll(() => denied).toBe(true);
  await expect(
    page.getByText("Your account cannot perform this action."),
  ).toBeVisible();
  await page.reload();
  await page
    .getByText(/Saved drafts on this device/u)
    .first()
    .click();
  await expect(
    page.getByText("Recover my denied inspection").first(),
  ).toBeVisible();
});

test("keeps inspection inputs through tabs, filters, and keyboard navigation", async ({
  page,
}) => {
  await signIn(page);
  const notes = page.getByRole("textbox", { name: "Inspection notes" });
  await notes.fill("Check the mounting after lunch");
  await page
    .getByRole("group", { name: "Safety checks", exact: true })
    .getByRole("radio", { name: "Fail", exact: true })
    .check();
  await expect(page.getByText("1 of 3 checks answered")).toBeVisible();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Manage order" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Manage order" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Home");
  await expect(notes).toHaveValue("Check the mounting after lunch");
  await page
    .getByRole("searchbox", { name: "Search work orders" })
    .fill("not-a-matching-order");
  await expect(page.getByText(/No matching work orders/u)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ventilation unit 03" }),
  ).toBeVisible();
  await expect(notes).toHaveValue("Check the mounting after lunch");
  await page.getByRole("searchbox").clear();
  await page
    .getByRole("combobox", { name: "Technician", exact: true })
    .selectOption("user-malik");
  await expect(notes).toHaveValue("Check the mounting after lunch");
  await page
    .getByRole("combobox", { name: "Technician", exact: true })
    .selectOption("");
  await expect(
    page.getByRole("button", { name: /Ventilation unit 03/u }),
  ).toHaveAttribute("aria-current", "true");
});

test("creation dialog contains focus, confirms discard, and leaves the inspection untouched", async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByRole("textbox", { name: "Inspection notes" })
    .fill("Unsaved site observation");
  const opener = page.getByRole("button", { name: "Add work order" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "New work order" });
  await expect(
    dialog.getByRole("textbox", { name: "Equipment", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await dialog
    .getByRole("textbox", { name: "Equipment", exact: true })
    .fill("Unfinished order");
  page.once("dialog", (prompt) => prompt.dismiss());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  page.once("dialog", (prompt) => prompt.accept());
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Inspection notes" }),
  ).toHaveValue("Unsaved site observation");
});

test("creation errors keep entries and a double click creates only one work order", async ({
  page,
}) => {
  await signIn(page);
  let attempts = 0;
  await page.route("**/api/work-orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts += 1;
    if (attempts === 1)
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Add work order" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Equipment", exact: true })
    .fill("Dialog test fan");
  await dialog
    .getByRole("textbox", { name: "Site", exact: true })
    .fill("Test bay");
  await dialog.getByRole("button", { name: "Add to queue" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "could not be completed",
  );
  await expect(
    dialog.getByRole("textbox", { name: "Equipment", exact: true }),
  ).toHaveValue("Dialog test fan");
  await dialog.getByRole("button", { name: "Add to queue" }).dblclick();
  await expect(
    page.getByRole("heading", { name: "Dialog test fan" }),
  ).toBeFocused();
  expect(attempts).toBe(2);
  await expect(
    page.getByRole("button", { name: /Dialog test fan/u }),
  ).toHaveCount(1);
});

test("storage failure preserves unsaved inputs and does not claim a successful save", async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByRole("textbox", { name: "Inspection notes" })
    .fill("Keep this observation");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.assign(window, {
      restoreDraftStorage: () => {
        IDBObjectStore.prototype.put = original;
      },
    });
    IDBObjectStore.prototype.put = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText(/Browser storage could not be accessed/u),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Inspection notes" }),
  ).toHaveValue("Keep this observation");
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Draft saved on this device.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    (
      window as Window & { restoreDraftStorage: () => void }
    ).restoreDraftStorage();
  });
  await page.getByRole("button", { name: "Retry storage" }).click();
  await expect(
    page.getByRole("textbox", { name: "Inspection notes" }),
  ).toHaveValue("Keep this observation");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Draft saved on this device.", { exact: true }),
  ).toBeVisible();
});

test("bounds multibyte inspection notes without truncating the text", async ({
  page,
}) => {
  await signIn(page);
  const notes = page.getByRole("textbox", { name: "Inspection notes" });
  await notes.fill("é".repeat(501));
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText(/Notes must fit within 1,000 UTF-8 bytes/u),
  ).toBeVisible();
  await expect(notes).toHaveValue("é".repeat(501));
  await expect(notes).toHaveAttribute("aria-invalid", "true");
  await notes.fill("é".repeat(500));
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Draft saved on this device.", { exact: true }),
  ).toBeVisible();
});

test("review notes survive tab changes and use the same byte limit", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Add work order" }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Equipment", exact: true })
    .fill("Review test fan");
  await page
    .getByRole("textbox", { name: "Site", exact: true })
    .fill("Test bay");
  await page.getByRole("button", { name: "Add to queue" }).click();
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
    .getByRole("button", { name: "Submit inspection", exact: true })
    .click();
  const notes = page.getByRole("textbox", { name: "Review notes" });
  await notes.fill("🛠".repeat(251));
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await page.getByRole("tab", { name: "Manage order" }).click();
  await page.getByRole("tab", { name: "Inspection", exact: true }).click();
  await expect(notes).toHaveValue("🛠".repeat(251));
  await page.getByRole("button", { name: "Complete work order" }).click();
  await expect(
    page.getByText(/Notes must fit within 1,000 UTF-8 bytes/u),
  ).toBeVisible();
  await notes.fill("Reviewed the inspection\nReady for service.");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Refresh work order", exact: true })
    .click();
  await expect(notes).toHaveValue(
    "Reviewed the inspection\nReady for service.",
  );
  await page.getByRole("button", { name: "Complete work order" }).click();
  await expect(
    page.getByText("Review recorded. Work order completed."),
  ).toBeVisible();
  const history = page.getByRole("region", { name: "Inspection history" });
  await expect(
    history
      .getByRole("list", { name: "Inspection results" })
      .getByRole("listitem"),
  ).toHaveText([
    "Equipment conditionPass",
    "Safety checksPass",
    "Functional checkPass",
  ]);
  await expect(history.locator("em")).toHaveText(
    "Reviewed the inspection\nReady for service.",
  );
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.locator(".technical-details")).toContainText(
    "inspection.review",
  );
  await expect(
    page.locator(".technical-details").getByText("FAKE ALLOW", { exact: true }),
  ).toHaveCount(2);
  await expect(page.locator(".technical-details")).toContainText("HTTP 200");
});
