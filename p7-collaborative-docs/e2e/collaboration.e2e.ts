import { type BrowserContext, expect, type Page, test } from "@playwright/test";

async function signIn(
  page: Page,
  name: string,
  subject: string,
): Promise<void> {
  // The local IdP's demo page imports a remote font; keep sign-in independent of it.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//u, (route) =>
    route.abort(),
  );
  await page.goto("/");
  await page.getByRole("link", { name: new RegExp(name, "u") }).click();
  await page.getByRole("textbox", { name: "Enter any login" }).fill(subject);
  await page.getByRole("textbox", { name: "and password" }).fill("tutorial");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/localhost:17007/u);
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

async function openCollaboration(page: Page, tab: "Comments" | "Access") {
  await page
    .getByRole("button", { name: new RegExp(`^${tab} \\(`, "u") })
    .click();
}

async function closeDrawer(page: Page) {
  if (await page.getByRole("dialog", { name: "Collaboration" }).isVisible()) {
    await page.getByRole("button", { name: "Close collaboration" }).click();
  }
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
    await openCollaboration(maya, "Access");
    const noahMember = maya
      .locator(".member")
      .filter({ hasText: "Noah Williams" });
    await noahMember.getByRole("button", { name: "Remove" }).click();
    await expect(maya.getByText("Access removed.")).toBeVisible();
    await closeDrawer(maya);

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
  await openCollaboration(page, "Comments");

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

test("keeps comment and creation drafts and dismisses the account menu", async ({
  page,
}) => {
  await signIn(page, "Maya Chen", "maya");
  await page.getByRole("button", { name: /Launch brief/u }).click();
  const menu = page.getByLabel("Open account menu for Maya Chen");
  await menu.click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeHidden();
  await menu.click();
  await page
    .getByRole("heading", { name: "Launch brief", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeHidden();
  await openCollaboration(page, "Comments");
  await page.getByLabel("Add comment").fill("Keep this unsent comment");
  await closeDrawer(page);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: /Maya's private planning/u }).click();
  await openCollaboration(page, "Comments");
  await expect(page.getByLabel("Add comment")).toHaveValue(
    "Keep this unsent comment",
  );
  await page.getByRole("tab", { name: /Comments/u }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Access/u })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByLabel("Add comment")).toHaveValue(
    "Keep this unsent comment",
  );
  await closeDrawer(page);
  await page.getByRole("button", { name: "New document", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "New document",
    exact: true,
  });
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Unfinished new document");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New document", exact: true }).click();
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
    "Unfinished new document",
  );
  await page.keyboard.press("Escape");
  await menu.click();
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Document", exact: true }),
  ).toBeVisible();
});

test("preserves edits during comments and asks before navigation", async ({
  page,
}) => {
  await signIn(page, "Maya Chen", "maya");
  await page.getByRole("button", { name: /Launch brief/u }).click();
  await expect(page.getByText("live", { exact: true })).toBeVisible();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Unsaved local title");
  await page
    .getByRole("textbox", { name: "Document", exact: true })
    .fill("Unsaved local body");
  await openCollaboration(page, "Comments");
  await page
    .getByRole("textbox", { name: "Add comment" })
    .fill("A comment without losing the draft");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByText("Comment added.")).toBeVisible();
  await closeDrawer(page);
  await expect(title).toHaveValue("Unsaved local title");
  await expect(
    page.getByRole("textbox", { name: "Document", exact: true }),
  ).toHaveValue("Unsaved local body");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: /Maya's private planning/u }).click();
  await expect(title).toHaveValue("Unsaved local title");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Maya's private planning/u }).click();
  await expect(title).toHaveValue("Maya's private planning");
});

test("refetches missed edits on reconnect without overwriting a local draft", async ({
  browser,
}) => {
  const readerContext = await browser.newContext();
  const writerContext = await browser.newContext();
  try {
    const reader = await signedInPage(readerContext, "Noah Williams", "noah");
    const writer = await signedInPage(writerContext, "Maya Chen", "maya");
    await reader.getByRole("button", { name: /Launch brief/u }).click();
    await writer.getByRole("button", { name: /Launch brief/u }).click();
    await expect(reader.getByText("live", { exact: true })).toBeVisible();
    for (const dirty of [false, true]) {
      if (dirty)
        await reader
          .getByRole("textbox", { name: "Document", exact: true })
          .fill("Keep this local draft");
      await readerContext.setOffline(true);
      await expect(
        reader.getByText("reconnecting", { exact: true }),
      ).toBeVisible();
      const update = `Missed update ${crypto.randomUUID()}`;
      await writer
        .getByRole("textbox", { name: "Document", exact: true })
        .fill(update);
      await writer.getByRole("button", { name: "Save changes" }).click();
      await expect(writer.getByText("Document saved.")).toBeVisible();
      await readerContext.setOffline(false);
      await expect(reader.getByText("live", { exact: true })).toBeVisible();
      await expect(
        reader.getByRole("textbox", { name: "Document", exact: true }),
      ).toHaveValue(dirty ? "Keep this local draft" : update);
      if (dirty) {
        await expect(
          reader.getByText("A newer version is available."),
        ).toBeVisible();
        reader.once("dialog", (dialog) => dialog.dismiss());
        await reader
          .getByRole("button", { name: "Refresh", exact: true })
          .click();
        await expect(
          reader.getByRole("textbox", { name: "Document", exact: true }),
        ).toHaveValue("Keep this local draft");
      }
    }
  } finally {
    await readerContext.close();
    await writerContext.close();
  }
});

test("keeps the mobile document workspace bounded and restores list focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "Maya Chen", "maya");
  const item = page.getByRole("button", { name: /Launch brief/u });
  await item.click();
  await expect(
    page.getByRole("textbox", { name: "Document", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    844,
  );
  await expect(page.locator("footer")).toBeInViewport();
  await page.getByRole("button", { name: "Back to documents" }).click();
  await expect(item).toBeFocused();
});

test("keeps the collaboration drawer usable when crossing layout breakpoints", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "Maya Chen", "maya");
  await page.getByRole("button", { name: /Launch brief/u }).click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(
    page.getByRole("dialog", { name: "Collaboration" }),
  ).toBeHidden();
  await openCollaboration(page, "Comments");
  await page.getByLabel("Add comment").fill("Keep this when resizing");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("dialog", { name: "Collaboration" }),
  ).toBeVisible();
  await expect(page.getByLabel("Add comment")).toHaveValue(
    "Keep this when resizing",
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Collaboration" }),
  ).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "Document", exact: true }),
  ).toBeVisible();
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]) {
  test(`fits editing and sharing on narrow and short screens ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await signIn(page, "Maya Chen", "maya");
    await page.getByRole("button", { name: "New document" }).click();
    const title = `Mobile ${viewport.width} ${"x".repeat(70)}`;
    await page
      .locator(".compact-form")
      .getByLabel("Title", { exact: true })
      .fill(title);
    await page
      .getByLabel("Starting text")
      .fill("A document we can edit and share on a phone.");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    if (viewport.width <= 760 || viewport.height <= 500) {
      await expect
        .poll(() =>
          page
            .locator(".brand-lockup img")
            .evaluate((image) => (image as HTMLImageElement).currentSrc),
        )
        .toContain("cedarling-mark");
    }
    await openCollaboration(page, "Access");
    await page
      .getByLabel("Collaborator", { exact: true })
      .selectOption("user-noah");
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const role = page.getByLabel("Role for Noah Williams");
    await expect(role).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".workspace")
          .evaluate((element) => element.scrollWidth - element.clientWidth),
      )
      .toBe(0);
    for (const control of [
      role,
      page.getByRole("button", { name: "Remove Noah Williams", exact: true }),
    ]) {
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.boundingBox();
      if (!bounds) throw new Error("Sharing control has no visible bounds");
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    await role.selectOption("commenter");
    await expect(role).toHaveValue("commenter");
    await closeDrawer(page);
    await page
      .getByRole("textbox", { name: "Document", exact: true })
      .fill("Edited on a small screen.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Document saved.")).toBeVisible();
    if (viewport.width <= 980) {
      await page.getByRole("button", { name: "Back to documents" }).click();
      await expect(
        page.getByRole("button", { name: new RegExp(title) }),
      ).toBeFocused();
    }
  });
}
