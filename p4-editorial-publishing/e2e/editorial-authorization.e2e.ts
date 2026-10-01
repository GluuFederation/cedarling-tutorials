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
  await expect(page).toHaveURL(/localhost:17004\/articles/u);
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

async function bypassDisabledButton(page: Page, name: string): Promise<void> {
  const button = page.getByRole("button", { name, exact: true });
  await expect(button).toBeDisabled();
  // Tamper with the real form to prove UI guidance is not the enforcement boundary.
  await button.evaluate((element) => element.removeAttribute("disabled"));
  await button.click();
}

test("denies the three unsafe editorial workflows and permits valid publication", async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const rileyContext = await browser.newContext();
  const anaContext = await browser.newContext();
  const omarContext = await browser.newContext();
  try {
    const riley = await rileyContext.newPage();
    const rejectedOrigin = await riley.request.post(
      "http://127.0.0.1:17004/articles/article-launch-brief",
    );
    expect(rejectedOrigin.status()).toBe(400);
    expect(await rejectedOrigin.json()).toEqual({
      error: "canonical_origin_required",
    });
    await signIn(riley, "Riley", "riley", "http://127.0.0.1:17004/");
    expect(new URL(riley.url()).hostname).toBe("localhost");
    await riley.getByRole("link", { name: "New article", exact: true }).click();
    await expect(
      riley.getByRole("heading", { name: "New article", exact: true }),
    ).toBeVisible();
    await riley
      .getByLabel("Title", { exact: true })
      .fill("Fresh editorial story");
    await riley.getByLabel("Body", { exact: true }).fill("   ");
    await riley
      .getByRole("button", { name: "Create article", exact: true })
      .click();
    await expect(riley.locator(".outcome.error")).toContainText(
      "Enter a title",
    );
    await expect(riley.getByLabel("Title", { exact: true })).toHaveValue(
      "Fresh editorial story",
    );
    await expect(riley.getByLabel("Body", { exact: true })).toHaveValue("   ");
    await riley
      .getByLabel("Body", { exact: true })
      .fill("An article created by the learner.");
    await riley
      .getByRole("button", { name: "Create article", exact: true })
      .click();
    await expect(riley.getByRole("status")).toHaveText("Article created.");
    await riley.getByRole("button", { name: "Submit for review" }).click();
    await expect(
      riley.getByRole("button", { name: "Approve revision" }),
    ).toBeDisabled();
    await openArticle(riley, "Launch brief");
    await riley.getByRole("button", { name: "Submit for review" }).click();
    await expect(riley.getByRole("status")).toContainText("Revision submitted");
    await bypassDisabledButton(riley, "Reject revision");
    await expect(riley.getByRole("status")).toContainText(
      "This action is not allowed",
    );
    const submittedApproval = riley.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        Boolean(request.headers()["next-action"]),
    );
    await bypassDisabledButton(riley, "Approve revision");
    await expect(riley.getByRole("status")).toContainText(
      "This action is not allowed",
    );
    // Replay the actual framework request, not a fabricated action identifier.
    const action = await submittedApproval;
    const body = action.postData();
    if (!body) throw new Error("Missing action form data");
    const response = await riley.request.post(action.url(), {
      data: body,
      headers: {
        "content-type": action.headers()["content-type"],
        "next-action": action.headers()["next-action"],
        origin: new URL(riley.url()).origin,
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["x-action-redirect"]).toContain(
      "error-forbidden",
    );
    await bypassDisabledButton(riley, "Publish current revision");
    await expect(riley.getByRole("status")).toContainText(
      "This action is not allowed",
    );

    const ana = await anaContext.newPage();
    await signIn(ana, "Ana", "ana");
    await openArticle(ana, "Fresh editorial story");
    await expect(
      ana.getByRole("textbox", { name: "Body", exact: true }),
    ).toBeDisabled();
    await ana.getByRole("button", { name: "Approve revision" }).click();
    await ana.getByRole("button", { name: "Publish current revision" }).click();
    await expect(ana.getByRole("status")).toHaveText(
      "Current revision published.",
    );
    await openArticle(ana, "Customer migration guide");
    // Ana is allowed to approve: these denials must come from request integrity.
    for (const missing of [true, false]) {
      await ana
        .locator("form")
        .filter({
          has: ana.getByRole("button", { name: "Approve revision" }),
        })
        .locator('input[name="_csrf"]')
        .evaluate((input, remove) => {
          if (remove) input.remove();
          else (input as HTMLInputElement).value = "invalid-csrf";
        }, missing);
      await ana.getByRole("button", { name: "Approve revision" }).click();
      await expect(ana.getByRole("status")).toContainText(
        "The request could not be verified",
      );
      await ana.reload();
      await expect(ana.getByText("submitted", { exact: true })).toBeVisible();
      await expect(ana.getByText("No decision", { exact: true })).toBeVisible();
    }
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
    await bypassDisabledButton(ana, "Publish current revision");
    await expect(ana.getByRole("status")).toContainText(
      "This action is not allowed",
    );
    await expect(ana.getByText("Published", { exact: true })).toHaveCount(0);
    await ana.getByRole("button", { name: "Approve revision" }).click();
    await expect(ana.getByRole("status")).toContainText(
      "Exact revision approved",
    );
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
    execFileSync(process.execPath, ["scripts/admin.ts", "revoke-omar"], {
      stdio: "pipe",
    });
    await openArticle(ana, "Partner announcement");
    await expect(ana.getByText("Revoked", { exact: true })).toBeVisible();
    await bypassDisabledButton(ana, "Publish current revision");
    await expect(ana.getByRole("status")).toContainText(
      "This action is not allowed",
    );
    await expect(ana.getByText("Published", { exact: true })).toHaveCount(0);

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

    await ana.goto("/articles/article-launch-brief?revision=bad!");
    await expect(ana.getByRole("button", { name: "Try again" })).toBeVisible();
    await Promise.all([
      ana.waitForRequest(
        (request) =>
          request.method() === "GET" &&
          request.url().includes("/articles/article-launch-brief") &&
          request.headers().rsc === "1",
      ),
      ana.getByRole("button", { name: "Try again" }).click(),
    ]);

    // The account menu submits a native form, not a fetch-based Server Action.
    const session = (await rileyContext.cookies()).find(
      (cookie) => cookie.name === "p4_session",
    );
    if (!session) throw new Error("Missing signed-in session");
    await riley.getByLabel("Open account menu").click();
    const logout = riley.waitForResponse((response) =>
      response.url().endsWith("/auth/logout"),
    );
    await riley
      .getByRole("button", { name: "Sign out or change account" })
      .click();
    expect((await logout).status()).toBe(303);
    await expect(
      riley.getByRole("heading", { name: "Choose a tutorial identity" }),
    ).toBeVisible();
    const replay = await riley.request.get("/articles/article-launch-brief", {
      headers: { cookie: `p4_session=${session.value}` },
      maxRedirects: 0,
    });
    expect(replay.status()).toBe(307);
    expect(replay.headers().location).toContain("/?expired=1");
  } finally {
    await rileyContext.close();
    await anaContext.close();
    await omarContext.close();
  }
});
