import { expect, type Locator, test } from "@playwright/test";
import type { WorkloadCommand, Workspace } from "../src/shared/types.ts";

test("retries an uncertain creation and release without repeating either effect", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".transfer-item").first()).toBeVisible();
  const before = (await (
    await page.request.get("/api/workspace")
  ).json()) as Workspace;
  const commands: WorkloadCommand[] = [];
  const interrupted = new Set<string>();
  await page.route("**/api/workloads/*/commands", async (route) => {
    const command = route.request().postDataJSON() as WorkloadCommand;
    commands.push(command);
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (!interrupted.has(command.type)) {
      interrupted.add(command.type);
      await route.abort("failed");
    } else {
      await route.fulfill({ response });
    }
  });
  await page.getByRole("button", { name: "New transfer" }).click();
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("1");
  const create = page.getByRole("button", { name: "Create as Planner" });
  await create.click();
  await expect(page.getByRole("alert")).toContainText("could not be completed");
  await create.click();
  await expect(page.getByRole("status")).toContainText("created the transfer");
  expect(commands[1]).toEqual(commands[0]);
  const release = page.getByRole("button", { name: "Release as North" });
  await release.click();
  await expect(page.getByRole("alert")).toContainText("could not be completed");
  await release.click();
  await expect(page.locator(".detail-card .status")).toHaveText("in transit");
  expect(commands[3]).toEqual(commands[2]);
  const after = (await (
    await page.request.get("/api/workspace")
  ).json()) as Workspace;
  expect(after.transfers).toHaveLength(before.transfers.length + 1);
  const stock = (workspace: Workspace) =>
    workspace.inventory.find(
      (row) => row.warehouseId === "north" && row.skuId === "bearing-kit",
    )?.quantity;
  expect(stock(after)).toBe((stock(before) ?? 0) - 1);
});

test("recovers a failed refresh after a committed command without resending it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".transfer-item").first()).toBeVisible();
  let unavailable = true;
  let commandCount = 0;
  await page.route("**/api/workspace", async (route) => {
    if (unavailable)
      await route.fulfill({
        status: 503,
        json: { error: "service_unavailable" },
      });
    else await route.continue();
  });
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/commands"))
      commandCount += 1;
  });
  await page.getByRole("button", { name: "New transfer" }).click();
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("1");
  await page.getByRole("button", { name: "Create as Planner" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "created the transfer. Refresh",
  );
  await expect(
    page.getByRole("button", { name: "Release as North" }),
  ).toBeDisabled();
  unavailable = false;
  await page.getByRole("button", { name: "Refresh workspace" }).click();
  await expect(page.getByRole("status")).toHaveText("Workspace refreshed.");
  await expect(
    page.getByRole("button", { name: "Release as North" }),
  ).toBeEnabled();
  expect(commandCount).toBe(1);
});

test("scrolls the transfer list independently and opens one task at a time", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/workspace", async (route) => {
    const response = await route.fetch();
    const workspace = await response.json();
    const original = workspace.transfers[0];
    workspace.transfers = Array.from({ length: 40 }, (_, index) => ({
      ...original,
      id: `scroll-test-${index}`,
    }));
    await route.fulfill({ response, json: workspace });
  });
  await page.goto("/");
  await expect(page.locator(".transfer-item")).toHaveCount(40);
  await expect(
    page.getByRole("heading", { name: "Plan stock transfer" }),
  ).toBeHidden();
  const panel = page.locator(".main-panel");
  const initialTop = await panel.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  const rail = page.locator(".transfer-rail");
  await rail.hover();
  await page.mouse.wheel(0, 1200);
  await expect
    .poll(() => rail.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
  expect(
    await panel.evaluate((element) => element.getBoundingClientRect().top),
  ).toBe(initialTop);
  expect(
    await page.locator(".workspace").evaluate((element) => element.scrollTop),
  ).toBe(0);
  await page.getByRole("button", { name: "New transfer" }).click();
  await expect(
    page.getByRole("heading", { name: "Plan stock transfer" }),
  ).toBeVisible();
  await expect(page.locator(".detail-card")).toBeHidden();
  await page.locator(".transfer-item").first().click();
  await expect(page.locator(".detail-card")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Plan stock transfer" }),
  ).toBeHidden();
});

test("follows a South-to-North transfer and keeps comparison actions available", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New transfer" }).click();
  await page
    .getByRole("combobox", { name: "From", exact: true })
    .selectOption("south");
  await page
    .getByRole("combobox", { name: "To", exact: true })
    .selectOption("north");
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("1");
  await page.getByRole("button", { name: "Create as Planner" }).click();
  const release = page.getByRole("button", { name: "Release as South" });
  await expect(release).toHaveClass(/primary/);
  await page
    .locator(".detail-card")
    .getByText("Try another workload", { exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Release as North" }),
  ).toBeEnabled();
  await release.click();
  const receive = page.getByRole("button", { name: "Receive as North" });
  await expect(receive).toHaveClass(/primary/);
  await receive.click();
  await expect(page.getByText("Stock movement is complete.")).toBeVisible();
});

async function touchTarget(control: Locator): Promise<void> {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport();
  const box = await control.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(
    await control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const target = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return target === element || element.contains(target);
    }),
  ).toBe(true);
}

test("reproduces the three workload authorization gaps", async ({ page }) => {
  const missing = await page.request.get("/missing");
  expect(missing.status()).toBe(404);
  await expect(missing.json()).resolves.toEqual({
    error: "not_found",
    requestId: expect.any(String),
  });

  await page.goto("/");
  await page.getByRole("button", { name: "New transfer" }).click();
  await expect(
    page.getByRole("heading", { name: "Plan stock transfer" }),
  ).toBeVisible();

  await page
    .locator(".create-card")
    .getByText("Try another workload", { exact: true })
    .click();
  await page.getByRole("button", { name: "Try as Auditor" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Auditor created the transfer",
  );
  await expect(page.locator(".detail-card .status")).toHaveText("planned");

  await page
    .locator(".detail-card")
    .getByText("Try another workload", { exact: true })
    .click();
  await page.getByRole("button", { name: "Release as South" }).click();
  await expect(page.getByRole("status")).toContainText(
    "South released the transfer",
  );
  await expect(page.locator(".detail-card .status")).toHaveText("in transit");

  await page
    .locator(".detail-card")
    .getByText("Try another workload", { exact: true })
    .click();
  await page.getByRole("button", { name: "Receive as North" }).click();
  await expect(page.getByRole("status")).toContainText(
    "North received the transfer",
  );
  await expect(page.locator(".detail-card .status")).toHaveText("received");
});

test("keeps mobile transfers, creation and inventory in a bounded workspace", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "New transfer" }).click();
  await expect(
    page.getByRole("heading", { name: "Plan stock transfer" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create as Planner" }).click();
  await expect(
    page.getByRole("button", { name: "Release as North" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    844,
  );
  await expect(page.locator("footer")).toBeInViewport();
  await page.getByRole("button", { name: "Back to transfers" }).click();
  await expect(
    page.getByRole("button", { name: "New transfer" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Current inventory" }),
  ).toBeVisible();
});

for (const [width, height] of [
  [320, 568],
  [390, 844],
  [768, 1024],
  [844, 390],
  [1440, 1000],
] as const) {
  test(`keeps transfer controls reachable at ${width} × ${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.getByRole("button", { name: "New transfer" }).click();
    await expect(page.locator(".brand-rail")).toHaveJSProperty(
      "clientWidth",
      width,
    );
    for (const name of ["From", "To", "Item"])
      await touchTarget(page.getByRole("combobox", { name, exact: true }));
    await touchTarget(page.getByRole("spinbutton", { name: "Quantity" }));
    await page.getByRole("spinbutton", { name: "Quantity" }).fill("1");
    await touchTarget(page.getByRole("button", { name: "Create as Planner" }));
    await page.getByRole("button", { name: "Create as Planner" }).click();
    await touchTarget(page.getByRole("button", { name: "Release as North" }));
    await page.getByRole("button", { name: "Release as North" }).click();
    await touchTarget(page.getByRole("button", { name: "Receive as South" }));
    await page.getByRole("button", { name: "Receive as South" }).click();
    await expect(page.getByText("Stock movement is complete.")).toBeVisible();
    if (width <= 980)
      await page.getByRole("button", { name: "Back to transfers" }).click();
    await page.getByRole("button", { name: "Inventory", exact: true }).click();
    const table = page.getByRole("region", { name: "Inventory stock levels" });
    await expect(table).toBeVisible();
    await table.focus();
    await expect(table).toBeFocused();
    await expect(page.locator("footer")).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBe(height);
  });
}
