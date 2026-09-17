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
  await expect(page).toHaveURL(/p7\.localhost:3007/u);
}

async function signedInPage(
  context: BrowserContext,
  name: string,
  subject: string,
): Promise<Page> {
  const page = await context.newPage();
  await signIn(page, name, subject);
  return page;
}

test("keeps an open stream useful after access is revoked", async ({
  browser,
}) => {
  const noahContext = await browser.newContext();
  const mayaContext = await browser.newContext();
  try {
    const noah = await signedInPage(noahContext, "Noah Williams", "noah");
    await noah.getByRole("button", { name: /Launch brief/u }).click();
    await expect(noah.getByText("live", { exact: true })).toBeVisible();

    const maya = await signedInPage(mayaContext, "Maya Chen", "maya");
    await maya.getByRole("button", { name: /Launch brief/u }).click();
    const noahMember = maya
      .locator(".member")
      .filter({ hasText: "Noah Williams" });
    await noahMember.getByRole("button", { name: "Remove" }).click();
    await expect(maya.getByText("Access removed.")).toBeVisible();

    await maya
      .getByRole("textbox", { name: "Document" })
      .fill("Owner update delivered after Noah was revoked.");
    await maya.getByRole("button", { name: "Save changes" }).click();
    await expect(maya.getByText("Document saved.")).toBeVisible();
    await expect(noah.getByRole("textbox", { name: "Document" })).toHaveValue(
      "Owner update delivered after Noah was revoked.",
    );
  } finally {
    await noahContext.close();
    await mayaContext.close();
  }
});

test("creates a document and keeps selection in the URL", async ({ page }) => {
  await signIn(page, "Maya Chen", "maya");
  await page.getByRole("button", { name: "New document" }).click();
  const creation = page.locator(".compact-form");
  await creation.getByRole("textbox", { name: "Title" }).fill("Partner notes");
  await page
    .getByRole("textbox", { name: "Starting text" })
    .fill("First draft.");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByRole("heading", { name: "Partner notes" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\?document=doc-/u);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Partner notes" }),
  ).toBeVisible();
});

test("reuses a comment key when an unchanged request is retried", async ({
  page,
}) => {
  await signIn(page, "Lena Ortiz", "lena");
  await page.getByRole("button", { name: /Launch brief/u }).click();

  const keys: string[] = [];
  let attempts = 0;
  await page.route("**/api/documents/*/comments", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as { idempotencyKey: string };
    keys.push(body.idempotencyKey);
    attempts += 1;
    if (attempts === 1) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "service_unavailable" }),
      });
    }
    return route.continue();
  });

  const comment = `Retry-safe comment ${crypto.randomUUID()}`;
  await page.getByRole("textbox", { name: "Comment" }).fill(comment);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByText("Service unavailable. Try again.")).toBeVisible();
  await page.getByRole("button", { name: "Comment", exact: true }).click();

  await expect(page.getByText(comment)).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test("distinguishes service failure from signed out", async ({ page }) => {
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
});
