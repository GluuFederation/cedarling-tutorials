import { expect, type Page, test } from "@playwright/test";

async function signIn(
  page: Page,
  name: string,
  subject: string,
): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "P5 - Protecting Sensitive Fields and Data Exports with Cedarling",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: new RegExp(name, "u") }).click();
  await page.getByRole("textbox", { name: "Enter any login" }).fill(subject);
  await page.getByRole("textbox", { name: "and password" }).fill("tutorial");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/p5\.localhost:3005\//u);
  await expect(
    page.getByRole("heading", { name: "Query plan", exact: true }),
  ).toBeVisible();
}

async function runQuery(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(page.getByRole("status")).toContainText(/returned/u);
}

test("reproduces the data and export authorization gaps", async ({
  browser,
}) => {
  const aminaContext = await browser.newContext();
  const theoContext = await browser.newContext();
  try {
    const amina = await aminaContext.newPage();
    await signIn(amina, "Amina", "amina");
    await amina.getByRole("checkbox", { name: /Salary/u }).check();
    await amina.getByRole("checkbox", { name: /Bonus/u }).check();
    await amina.getByLabel("Value").fill("tenant-b");
    await runQuery(amina);
    await expect(
      amina.getByRole("region", { name: "Query results" }),
    ).toContainText("tenant-b");

    const theo = await theoContext.newPage();
    await signIn(theo, "Theo", "theo");
    await runQuery(theo);
    await expect(
      theo.getByRole("region", { name: "Query results" }),
    ).toContainText("tenant-a");

    await theo.getByRole("radio", { name: "Aggregate" }).check();
    await theo.getByLabel("Group by").selectOption("tenantId");
    await theo.getByLabel("Field").selectOption("department");
    await theo.getByLabel("Value").fill("People");
    await theo.getByLabel("Purpose").selectOption("external-audit");
    await runQuery(theo);
    const aggregate = theo.getByRole("region", { name: "Query results" });
    await expect(aggregate).toContainText("tenant-a");
    await expect(aggregate).toContainText("tenant-b");

    await theo.getByRole("radio", { name: "Rows" }).check();
    await theo.getByRole("checkbox", { name: /Salary/u }).check();
    await theo.getByRole("checkbox", { name: /Bonus/u }).check();
    await theo.getByLabel("Field").selectOption("tenantId");
    await theo.getByLabel("Value").fill("tenant-b");
    await runQuery(theo);
    const responsePromise = theo.waitForResponse(
      (response) =>
        response.url().endsWith("/api/exports") &&
        response.request().method() === "POST",
    );
    await theo.getByRole("button", { name: "Create export" }).click();
    const exportResponse = await responsePromise;
    expect(exportResponse.status()).toBe(201);
    const created = (await exportResponse.json()) as {
      export: { id: string };
      downloadRef: string;
    };
    await expect(theo.getByRole("status")).toContainText("Export ready");

    const crossOwner = await amina.evaluate(
      async (value) => {
        const session = (await fetch("/api/session").then((response) =>
          response.json(),
        )) as { csrfToken: string };
        const headers = {
          "content-type": "application/json",
          "x-csrf-token": session.csrfToken,
        };
        const download = await fetch("/api/exports/download", {
          method: "POST",
          headers,
          body: JSON.stringify({ downloadRef: value.downloadRef }),
        });
        const revoke = await fetch(`/api/exports/${value.id}/revoke`, {
          method: "POST",
          headers: { "x-csrf-token": session.csrfToken },
        });
        return { download: download.status, revoke: revoke.status };
      },
      { id: created.export.id, downloadRef: created.downloadRef },
    );
    expect(crossOwner).toEqual({ download: 200, revoke: 200 });
  } finally {
    await aminaContext.close();
    await theoContext.close();
  }
});
