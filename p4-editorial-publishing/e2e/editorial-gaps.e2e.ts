import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";

async function signIn(
  page: Page,
  name: string,
  subject: string,
  entry = "/",
): Promise<void> {
  await page.goto(entry);
  await expect(
    page.getByRole("heading", {
      name: "P4 - Securing Editorial Publishing with Cedarling",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: new RegExp(name, "u") }).click();
  await page.getByRole("textbox", { name: "Enter any login" }).fill(subject);
  await page.getByRole("textbox", { name: "and password" }).fill("tutorial");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/p4\.localhost:3004\/articles/u);
}

async function openArticle(page: Page, title: string): Promise<void> {
  const link = page.getByRole("link", { name: new RegExp(title, "u") });
  const href = await link.getAttribute("href");
  if (!href) throw new Error(`Article link for ${title} has no destination`);
  const target = new URL(href, page.url());
  const heading = page.getByRole("heading", { name: title, exact: true });
  await link.click();
  await expect(page).toHaveURL(target.toString());
  await expect(heading).toBeVisible();
  await page.reload();
  await expect(heading).toBeVisible();
}

test("reproduces the three editorial authorization gaps and valid control", async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const rileyContext = await browser.newContext();
  const anaContext = await browser.newContext();
  const omarContext = await browser.newContext();
  try {
    const riley = await rileyContext.newPage();
    const rejectedOrigin = await riley.request.post(
      "http://127.0.0.1:3004/articles/article-launch-brief",
    );
    expect(rejectedOrigin.status()).toBe(400);
    expect(await rejectedOrigin.json()).toEqual({
      error: "canonical_origin_required",
    });
    await signIn(riley, "Riley", "riley", "http://127.0.0.1:3004/");
    expect(new URL(riley.url()).hostname).toBe("p4.localhost");
    await openArticle(riley, "Launch brief");
    await riley.getByRole("button", { name: "Submit for review" }).click();
    await expect(riley.getByRole("status")).toContainText("Revision submitted");
    await riley.getByRole("button", { name: "Reject revision" }).click();
    await expect(riley.getByRole("status")).toContainText(
      "This action is not allowed",
    );
    await riley.getByRole("button", { name: "Approve revision" }).click();
    await expect(riley.getByRole("status")).toContainText(
      "Exact revision approved",
    );
    await riley
      .getByRole("button", { name: "Publish current revision" })
      .click();
    await expect(riley.getByRole("status")).toContainText(
      "This action is not allowed",
    );

    const ana = await anaContext.newPage();
    await signIn(ana, "Ana", "ana");
    await openArticle(ana, "Customer migration guide");
    await ana.getByRole("button", { name: "Approve revision" }).click();
    await expect(ana.getByRole("status")).toContainText(
      "Exact revision approved",
    );

    await openArticle(riley, "Customer migration guide");
    await riley
      .getByLabel("Body")
      .fill("A changed migration guide that has not been approved.");
    await riley.getByRole("button", { name: "Create new draft" }).click();
    await expect(riley.getByRole("status")).toContainText("Draft saved");
    await riley.getByRole("button", { name: "Submit for review" }).click();
    await expect(riley.getByRole("status")).toContainText("Revision submitted");

    await openArticle(ana, "Customer migration guide");
    await ana.getByRole("button", { name: "Publish current revision" }).click();
    await expect(ana.getByRole("status")).toContainText(
      "Current revision published",
    );
    await expect(ana.getByText("Published", { exact: true })).toBeVisible();

    const omar = await omarContext.newPage();
    await signIn(omar, "Omar", "omar");
    await openArticle(omar, "Partner announcement");
    await omar.getByRole("button", { name: "Approve revision" }).click();
    await expect(omar.getByRole("status")).toContainText(
      "Exact revision approved",
    );
    execFileSync(
      process.execPath,
      ["--env-file=.env", "scripts/admin.ts", "revoke-omar"],
      { stdio: "pipe" },
    );
    await openArticle(ana, "Partner announcement");
    await expect(ana.getByText("Revoked", { exact: true })).toBeVisible();
    await ana.getByRole("button", { name: "Publish current revision" }).click();
    await expect(ana.getByRole("status")).toContainText(
      "Current revision published",
    );

    await openArticle(ana, "Editorial handbook");
    await ana.getByRole("button", { name: "Approve revision" }).click();
    await expect(ana.getByRole("status")).toContainText(
      "Exact revision approved",
    );
    await ana.getByRole("button", { name: "Publish current revision" }).click();
    await expect(ana.getByRole("status")).toContainText(
      "Current revision published",
    );
    await expect(ana).toHaveURL(/articles\/article-editorial-handbook/u);

    await ana.goto("/articles/missing");
    await expect(ana.getByRole("banner")).toHaveCount(1);
    await expect(ana.getByRole("contentinfo")).toHaveCount(1);
    await expect(
      ana.getByText("The requested article is unavailable."),
    ).toBeVisible();
  } finally {
    await rileyContext.close();
    await anaContext.close();
    await omarContext.close();
  }
});
