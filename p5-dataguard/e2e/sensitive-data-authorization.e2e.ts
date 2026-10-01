import { expect, type Page, test } from "@playwright/test";

test("ignores obsolete previews and recovers after a permission check failure", async ({
  page,
}) => {
  const fetched = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const delivered = Promise.withResolvers<void>();
  let delayFirst = true;
  await page.route("**/api/authorization", async (route) => {
    if (!delayFirst) return route.continue();
    delayFirst = false;
    const response = await route.fetch();
    fetched.resolve();
    await release.promise;
    try {
      await route.fulfill({ response });
    } finally {
      delivered.resolve();
    }
  });
  try {
    await signIn(page, "Amina", "amina");
    await fetched.promise;
    await expect(
      page.getByRole("button", { name: "Run query" }),
    ).toBeDisabled();
    await page.getByLabel("Tenant equals").fill("tenant-b");
    await expect(page.locator("#query-permission")).toContainText("cannot run");
    release.resolve();
    await delivered.promise;
    await expect(
      page.getByRole("button", { name: "Run query" }),
    ).toBeDisabled();
    await page.unroute("**/api/authorization");
    await page.route(
      "**/api/authorization",
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "authorization_unavailable" }),
        }),
      { times: 1 },
    );
    await page.getByLabel("Tenant equals").fill("tenant-a");
    await expect(page.locator("#query-permission")).toContainText(
      "temporarily unavailable",
    );
    await expect(
      page.getByRole("button", { name: "Run query" }),
    ).toBeDisabled();
    await page.evaluate("window.dispatchEvent(new Event('focus'))");
    await expect(page.getByRole("button", { name: "Run query" })).toBeEnabled();
  } finally {
    release.resolve();
  }
});

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
  await expect(
    page.getByRole("heading", { name: "Query plan", exact: true }),
  ).toBeVisible();
}

test("enforces fields, aggregates, and export ownership in real user workflows", async ({
  browser,
}) => {
  const aminaContext = await browser.newContext();
  const leahContext = await browser.newContext();
  const theoContext = await browser.newContext();
  try {
    const amina = await aminaContext.newPage();
    await signIn(amina, "Amina", "amina");
    await expect(amina.getByRole("checkbox", { name: /Salary/u })).toHaveCount(
      0,
    );
    await amina.getByRole("button", { name: "Run query" }).click();
    await expect(amina.getByRole("status")).toContainText("returned");
    await amina.getByRole("radio", { name: "Aggregate" }).check();
    await expect(amina.getByLabel("Group by")).toHaveValue("");
    await amina.getByRole("button", { name: "Run query" }).click();
    await expect(
      amina.getByRole("cell", { name: "10", exact: true }),
    ).toBeVisible();
    await amina
      .getByRole("checkbox", { name: "Apply tenant filter" })
      .uncheck();
    await expect(amina.locator("#query-permission")).toContainText(
      "cannot run",
    );
    await amina.getByRole("checkbox", { name: "Apply tenant filter" }).check();
    await expect(
      amina.getByRole("button", { name: "Run query" }),
    ).toBeEnabled();
    await amina.getByLabel("Tenant equals").fill("tenant-b");
    await expect(
      amina.getByRole("button", { name: "Run query" }),
    ).toBeDisabled();
    await expect(amina.locator("#query-permission")).toContainText(
      "cannot run",
    );
    await expect(
      amina.getByRole("button", { name: "Create export" }),
    ).toBeDisabled();

    const theo = await theoContext.newPage();
    await signIn(theo, "Theo", "theo");
    await theo.getByLabel("Purpose").selectOption("external-audit");
    await expect(theo.getByLabel("Tenant equals")).toHaveValue("tenant-b");
    await expect(
      theo.getByRole("button", { name: "Run query" }),
    ).toBeDisabled();
    await expect(theo.locator("#query-permission")).toContainText("cannot run");
    await theo.getByRole("radio", { name: "Aggregate" }).check();
    await expect(theo.getByLabel("Group by")).toHaveValue("");
    await theo.getByRole("button", { name: "Run query" }).click();
    await expect(theo.getByRole("status")).toContainText("returned");
    await expect(
      theo.getByRole("cell", { name: "8", exact: true }),
    ).toBeVisible();
    await expect(
      theo.getByRole("button", { name: "Create export" }),
    ).toBeDisabled();
    await theo.getByLabel("Group by").selectOption("department");
    await expect(
      theo.getByRole("button", { name: "Run query" }),
    ).toBeDisabled();
    await expect(theo.locator("#query-permission")).toContainText("cannot run");
    await theo.getByLabel("Limit").fill("1");
    await theo.getByRole("button", { name: "Run query" }).click();
    await expect(theo.getByRole("status")).toContainText("returned");
    await expect(
      theo.getByRole("region", { name: "Query results" }),
    ).toContainText("Finance");

    const leah = await leahContext.newPage();
    await signIn(leah, "Leah", "leah");
    await leah.getByLabel("Purpose").selectOption("finance-review");
    await leah.getByRole("checkbox", { name: /Salary/u }).check();
    await leah.getByRole("checkbox", { name: /Bonus/u }).check();
    await leah.getByRole("button", { name: "Run query" }).click();
    await expect(leah.getByRole("status")).toContainText("returned");
    // Editing the next query must not change the plan attached to the displayed export.
    await leah.getByLabel("Purpose").selectOption("support");
    await expect(leah.locator("#query-permission")).toContainText("cannot run");
    await expect(
      leah.getByRole("button", { name: "Create export" }),
    ).toBeEnabled();
    const createdResponse = leah.waitForResponse(
      (response) =>
        response.url().endsWith("/api/exports") &&
        response.request().method() === "POST",
    );
    await leah.getByRole("button", { name: "Create export" }).click();
    const response = await createdResponse;
    expect(response.status()).toBe(201);
    const created = (await response.json()) as {
      export: { id: string };
      downloadRef: string;
    };
    await expect(leah.getByRole("status")).toContainText("Export ready");
    // Bypass field visibility and export controls through the actual protected endpoints.
    const rejected = await amina.evaluate(async (value) => {
      const session = (await fetch("/api/session").then((result) =>
        result.json(),
      )) as { csrfToken: string };
      const headers = {
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      };
      const query = await fetch("/api/query/rows", {
        method: "POST",
        headers,
        body: JSON.stringify({
          kind: "rows",
          fields: ["salary"],
          purpose: "support",
          limit: 10,
          filter: { field: "tenantId", operator: "eq", value: "tenant-a" },
        }),
      });
      const download = await fetch("/api/exports/download", {
        method: "POST",
        headers,
        body: JSON.stringify({ downloadRef: value.downloadRef }),
      });
      const revoke = await fetch(`/api/exports/${value.export.id}/revoke`, {
        method: "POST",
        headers,
      });
      return [query.status, download.status, revoke.status];
    }, created);
    expect(rejected).toEqual([403, 403, 403]);
    const downloadLog = leah.waitForEvent("console", (message) =>
      message.text().startsWith("P5 browser | export.download"),
    );
    const download = leah.waitForEvent("download");
    await leah.getByRole("button", { name: "Download", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("dataguard-export.csv");
    const browserLog = await (await downloadLog).args()[1]?.jsonValue();
    expect(browserLog).toMatchObject({
      event: "http.response",
      operation: "export.download",
      status: 200,
      requestId: expect.any(String),
    });
    expect(JSON.stringify(browserLog)).not.toContain(created.downloadRef);
    await leah.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(leah.getByRole("status")).toContainText("revoked");

    await leah.getByLabel("Purpose").selectOption("finance-review");
    await leah.getByRole("radio", { name: "Aggregate" }).check();
    await leah.getByRole("button", { name: "Run query" }).click();
    await expect(
      leah.getByRole("cell", { name: "10", exact: true }),
    ).toBeVisible();
    await leah
      .getByRole("combobox", { name: "Aggregate", exact: true })
      .selectOption("average");
    for (const [field, average] of [
      ["salary", "5270000"],
      ["bonus", "338250"],
    ] as const) {
      await leah.getByLabel("Numeric field").selectOption(field);
      await leah.getByRole("button", { name: "Run query" }).click();
      await expect(
        leah.getByRole("cell", { name: average, exact: true }),
      ).toBeVisible();
    }
    await leah.getByLabel("Group by").selectOption("department");
    await expect(leah.locator("#query-permission")).toContainText("cannot run");
    await leah.getByLabel("Group by").selectOption("");
    await expect(leah.getByRole("button", { name: "Run query" })).toBeEnabled();
    await leah.getByRole("button", { name: "Create export" }).click();
    await expect(leah.getByRole("status")).toContainText("Export ready");
    const aggregateDownload = leah.waitForEvent("download");
    await leah.getByRole("button", { name: "Download", exact: true }).click();
    expect((await aggregateDownload).suggestedFilename()).toBe(
      "dataguard-export.csv",
    );
    await leah.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(leah.getByRole("status")).toContainText("revoked");
  } finally {
    await aminaContext.close();
    await leahContext.close();
    await theoContext.close();
  }
});
