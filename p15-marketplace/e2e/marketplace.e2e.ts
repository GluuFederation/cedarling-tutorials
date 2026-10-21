import { expect, type Page, test } from "@playwright/test";
import type { ActorId } from "../src/shared/protocol.ts";

async function signIn(page: Page, actor: ActorId) {
  await page.goto("/");
  await page.locator(`a[href="/auth/login?login_hint=${actor}"]`).click();
  await page.getByRole("textbox", { name: "Enter any login" }).fill(actor);
  await page
    .getByRole("textbox", { name: "and password" })
    .fill("cedarling-is-awesome");
  await page.getByRole("button", { name: "Sign-in", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Security bookshelf" }),
  ).toBeVisible();
}

async function changeAccount(page: Page, actor: ActorId) {
  await page.getByLabel("Open account menu").click();
  await page
    .getByRole("button", { name: "Change account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Choose an identity" }),
  ).toBeVisible();
  await expect(page.locator(".detail-rows")).toHaveCount(0);
  await signIn(page, actor);
}

async function buy(page: Page) {
  await page
    .locator(".book-card")
    .filter({
      has: page.getByRole("heading", {
        name: "OAuth 2 in Action",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Buy", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("ordered successfully");
  await expect(page.locator(".queue-view")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const orderUrl = page.url();
  await page.reload();
  await expect(page.locator(".detail-heading h2")).toHaveText(
    "OAuth 2 in Action",
  );
  await expect(page.locator(".queue-row.selected")).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page).toHaveURL(orderUrl);
  await page.getByRole("button", { name: "View refund", exact: true }).click();
  await expect(page.locator(".detail-heading .status")).toHaveText("eligible");
  const caseId = new URL(page.url()).searchParams.get("refund");
  if (!caseId) throw new Error("Purchase did not open its refund");
  return caseId;
}

async function openRefund(page: Page, caseId: string, section: string) {
  await page.goto(`/?view=refunds&refund=${caseId}&section=${section}`);
  await expect(page.locator(".section-tabs .active")).toHaveText(section);
  await expect(page.locator(".queue-view")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}

for (const outcome of ["clear", "block"] as const) {
  test(`buys a book and follows all four accounts to ${outcome}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await signIn(page, "bao");
    const caseId = await buy(page);
    await expect(
      page.getByText("Expected actor: Bao", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Reason", exact: true })
      .selectOption("damaged");
    await page
      .getByLabel("Details", { exact: false })
      .fill("The cover arrived damaged.");
    await page
      .getByRole("button", { name: "Request refund", exact: true })
      .click();
    await expect(page.locator(".detail-heading .status")).toHaveText(
      "requested",
    );

    await changeAccount(page, "sela");
    await openRefund(page, caseId, "seller");
    await expect(page.locator(".detail-rows")).toContainText("Expected seller");
    await expect(page.locator(".detail-rows")).toContainText("Sela Books");
    // The baseline shows lifecycle-legal actions even to a different actor.
    await expect(
      page.getByRole("button", { name: "Approve refund", exact: true }),
    ).toBeEnabled();

    await changeAccount(page, "diego");
    await openRefund(page, caseId, "support");
    await expect(
      page.getByText("Expected actor: Diego", { exact: true }),
    ).toBeVisible();
    const support = page.locator(".detail-rows");
    await expect(
      support
        .locator("div")
        .filter({ has: page.getByText("Reason", { exact: true }) }),
    ).toContainText("damaged");
    await expect(support).toContainText("The cover arrived damaged.");
    await expect(support).toContainText("Awaiting support approval");
    for (const field of ["Requested", "Assignment expires"]) {
      const value = support
        .locator("div")
        .filter({ has: page.getByText(field, { exact: true }) })
        .locator("dd");
      await expect(value).not.toHaveText("—");
    }
    if (outcome === "clear") {
      for (const size of [
        { width: 1366, height: 900 },
        { width: 320, height: 568 },
      ]) {
        await page.setViewportSize(size);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await testInfo.attach(`support-${size.width}`, {
          body: await page.screenshot(),
          contentType: "image/png",
        });
        if (size.width === 320) {
          const approve = page.getByRole("button", {
            name: "Approve refund",
            exact: true,
          });
          await approve.scrollIntoViewIfNeeded();
          await expect(approve).toBeInViewport({ ratio: 1 });
          await testInfo.attach("support-action-320", {
            body: await page.screenshot(),
            contentType: "image/png",
          });
        }
      }
      await page.setViewportSize({ width: 1366, height: 900 });
    }
    await page
      .getByRole("button", { name: "Approve refund", exact: true })
      .click();
    await expect(page.locator(".detail-heading .status")).toHaveText(
      "approved awaiting fraud",
    );

    await changeAccount(page, "nia");
    await openRefund(page, caseId, "fraud");
    await expect(
      page.getByText("Expected actor: Nia", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: outcome === "clear" ? "Clear and refund" : "Block",
        exact: true,
      })
      .click();
    const terminal = outcome === "clear" ? "completed" : "fraud blocked";
    await expect(page.locator(".detail-heading .status")).toHaveText(terminal);
    const effect =
      outcome === "clear"
        ? await page.locator(".effect-id").textContent()
        : null;
    await page.reload();
    await expect(page.locator(".detail-heading .status")).toHaveText(terminal);
    if (effect) await expect(page.locator(".effect-id")).toHaveText(effect);
    else await expect(page.locator(".effect-id")).toHaveCount(0);
    await expect(page.locator(".action-panel")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("reloads a confirmed refund after a failed refresh without repeating the action", async ({
  page,
}, testInfo) => {
  await signIn(page, "bao");
  await openRefund(page, "refund-approved-001", "fraud");
  // The baseline keeps this action available even though Bao is not its reviewer.
  const action = page.getByRole("button", {
    name: "Clear and refund",
    exact: true,
  });
  await expect(action).toBeEnabled();
  let submissions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/fraud-review"))
      submissions++;
  });
  await page.route("**/api/refunds", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } }),
  );
  await action.click();
  await expect(
    page.getByRole("heading", { name: "Refund update saved" }),
  ).toBeVisible();
  await expect(page.locator(".empty-detail")).toContainText(
    "Platform refund recorded once. Effect:",
  );
  await expect(page.locator(".action-panel, .detail-rows")).toHaveCount(0);
  const confirmation = await page.locator(".empty-detail p").textContent();
  await page.getByRole("button", { name: "Reload case", exact: true }).click();
  await expect(page.locator(".empty-detail p")).toHaveText(confirmation ?? "");
  await expect(
    page.getByRole("button", { name: "Reload case", exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 568 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Reload case", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await testInfo.attach("confirmed-refund-320", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.unroute("**/api/refunds");
  await page.getByRole("button", { name: "Reload case", exact: true }).click();
  await expect(page.locator(".detail-heading .status")).toHaveText("completed");
  const effect = await page.locator(".effect-id").textContent();
  expect(confirmation).toContain(effect?.split(" · ")[0]);
  expect(submissions).toBe(1);
  await page.reload();
  await expect(page.locator(".effect-id")).toHaveText(effect ?? "");
});

test("keeps the store, account menu, footer and detail navigation usable at narrow widths", async ({
  page,
}, testInfo) => {
  await signIn(page, "bao");
  await expect(page.locator(".book-card")).toHaveCount(5);
  await expect
    .poll(() =>
      page
        .locator("img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  for (const size of [
    { width: 1366, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator(".site-footer")).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const menu = page.getByLabel("Open account menu");
    await menu.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Change account" }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeInViewport();
    await menu.press("Enter");
    await testInfo.attach(`store-${size.width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  }
  await buy(page);
  await page
    .getByRole("button", { name: "Back to refunds", exact: false })
    .click();
  const selectedRow = page.locator(".queue-row:focus");
  await expect(selectedRow).toBeFocused();
  await selectedRow.press("Enter");
  await page
    .getByRole("button", { name: "Request refund", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Request refund", exact: true }),
  ).toBeInViewport();
  await page
    .getByLabel("Details", { exact: false })
    .fill("Keyboard-entered refund details.");
  await page
    .getByRole("button", { name: "Request refund", exact: true })
    .click();
  await expect(page.locator(".detail-heading .status")).toHaveText("requested");
  await expect(page.getByRole("status")).toBeInViewport();
  await expect(page.locator(".site-footer")).toBeInViewport();
  await testInfo.attach("refund-320", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.getByLabel("Open account menu").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose an identity" }),
  ).toBeVisible();
});

test("clears protected browser content on an unauthenticated response", async ({
  page,
}) => {
  await signIn(page, "bao");
  await page.route("**/api/orders", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "SESSION_EXPIRED" } },
    }),
  );
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose an identity" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Session expired");
  await expect(
    page.locator(".book-card, .queue-row, .detail-rows"),
  ).toHaveCount(0);
});
