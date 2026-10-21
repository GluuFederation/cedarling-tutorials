import { expect, type Page, test } from "@playwright/test";
import type { MatchSnapshot } from "../src/shared/contracts.ts";

async function login(page: Page, subject: string) {
  await page.goto("/");
  await page
    .getByRole("link", { name: new RegExp(`^${subject}$`, "i") })
    .click();
  await page.getByRole("textbox", { name: "Enter any login" }).fill(subject);
  await page
    .getByRole("textbox", { name: "and password" })
    .fill("cedarling-is-awesome");
  await page.getByRole("button", { name: "Sign-in", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Start a game" }),
  ).toBeVisible();
}

async function snapshot(page: Page): Promise<MatchSnapshot> {
  return page.evaluate(async () => {
    const id = location.hash.replace("#match/", "");
    return (await fetch(`/api/matches/${id}`)).json();
  });
}

test("two identities play, trade, exercise baseline gaps, and recover an uncertain command", async ({
  browser,
}, info) => {
  const first = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const second = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const dina = await first.newPage();
    const amara = await second.newPage();
    await login(dina, "dina");
    await login(amara, "amara");
    await dina
      .getByRole("textbox", { name: "Game name" })
      .fill("Two-player practice");
    await dina.getByRole("radio", { name: /Practice position/ }).check();
    await dina.getByRole("button", { name: "Create lobby" }).click();
    await expect(dina).toHaveURL(/#match\//);
    await amara.goto(dina.url());
    await amara.getByRole("button", { name: "Join game", exact: true }).click();
    await expect(
      dina.getByRole("button", { name: "Start game", exact: true }),
    ).toBeEnabled();
    await dina.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(
      dina.getByRole("button", { name: "End Dina’s turn" }),
    ).toBeVisible();
    await expect(
      amara.getByRole("button", { name: "End Dina’s turn" }),
    ).toBeVisible();
    await expect(dina.locator(".board-cell")).toHaveCount(40);
    const accountMenu = dina.getByLabel("Open account menu");
    await accountMenu.click();
    await expect(
      dina.getByRole("button", { name: "Change account" }),
    ).toBeVisible();
    await dina.keyboard.press("Escape");
    await expect(accountMenu).toBeFocused();
    await expect(
      dina.getByRole("button", { name: "Change account" }),
    ).not.toBeVisible();
    await accountMenu.click();
    await dina.getByRole("heading", { name: "Dina’s turn" }).click();
    await expect(
      dina.getByRole("button", { name: "Sign out", exact: true }),
    ).not.toBeVisible();
    await expect(
      dina
        .getByRole("complementary", { name: "Game details" })
        .getByRole("heading", { name: "Recent activity" }),
    ).toBeVisible();
    await dina.getByRole("button", { name: "How to play" }).click();
    await expect(
      dina.getByRole("dialog", { name: "How to play" }),
    ).toBeVisible();
    await dina.getByRole("button", { name: "Got it" }).click();

    await dina.getByRole("button", { name: /^6\. Orchard Row/ }).click();
    await dina.getByRole("button", { name: "Improve for 60" }).click();
    await expect
      .poll(
        async () =>
          (await snapshot(amara)).properties.find(
            (property) => property.id === "space-6",
          )?.level,
      )
      .toBe(1);
    expect((await snapshot(dina)).players[0]?.cash).toBe(940);

    await dina.getByRole("button", { name: "New offer", exact: true }).click();
    const dialog = dina.getByRole("dialog", { name: "Make a trade offer" });
    await dialog
      .locator(".trade-side")
      .nth(0)
      .getByRole("checkbox", { name: /West Quay/ })
      .check();
    await dialog
      .locator(".trade-side")
      .nth(1)
      .getByRole("checkbox", { name: /Orchard Row/ })
      .check();
    await dialog.getByRole("button", { name: "Review offer" }).click();
    await dina
      .getByRole("dialog", { name: "Confirm trade offer" })
      .getByRole("button", { name: "Send offer" })
      .click();
    await expect(dialog).not.toBeVisible();
    await amara.locator(".offer-row").first().click();
    await amara.getByRole("button", { name: "Accept for Amara" }).click();
    await amara.getByRole("button", { name: "Confirm exchange" }).click();
    await expect
      .poll(async () => (await snapshot(dina)).offers[0]?.status)
      .toBe("accepted");
    const traded = await snapshot(dina);
    expect(
      traded.properties.find((property) => property.id === "space-6")?.ownerId,
    ).toBe(traded.players[0]?.id);
    expect(
      traded.properties.find((property) => property.id === "space-6")?.level,
    ).toBe(1);

    // Another account can operate the active seat in this deliberately permissive baseline.
    await amara.getByRole("button", { name: "End Dina’s turn" }).click();
    await expect(
      dina.getByRole("button", { name: "Roll for Amara" }),
    ).toBeVisible();
    const version = (await snapshot(dina)).version;
    let key: string | undefined;
    let resumeRequest = () => {};
    const heldRequest = new Promise<void>((resolve) => {
      resumeRequest = resolve;
    });
    await dina.route("**/api/matches/*/commands", async (route) => {
      key = route.request().headers()["idempotency-key"];
      await heldRequest;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
      await dina.unroute("**/api/matches/*/commands");
    });
    await dina.getByRole("button", { name: "Roll for Amara" }).click();
    await expect(
      dina.getByRole("status").filter({ hasText: "Processing request" }),
    ).toBeVisible();
    resumeRequest();
    await expect(
      dina.getByRole("button", { name: "Confirm previous request" }).first(),
    ).toBeVisible();
    await expect
      .poll(async () => (await snapshot(dina)).version)
      .toBe(version + 1);
    expect(key).toBeTruthy();
    // A full reload must keep the original key available for receipt recovery.
    await dina.reload();
    await expect(
      dina.getByRole("button", { name: "Confirm previous request" }).first(),
    ).toBeVisible();
    const retry = dina.waitForRequest("**/api/matches/*/commands");
    await dina
      .getByRole("button", { name: "Confirm previous request" })
      .first()
      .click();
    expect((await retry).headers()["idempotency-key"]).toBe(key);
    await expect(
      dina.getByRole("button", { name: "Confirm previous request" }),
    ).toHaveCount(0);
    expect((await snapshot(dina)).version).toBe(version + 1);

    const fit = await dina.evaluate(() => {
      const board = document.querySelector(".board")?.getBoundingClientRect();
      const frame = document
        .querySelector(".board-scroll")
        ?.getBoundingClientRect();
      return (
        !!board &&
        !!frame &&
        board.bottom <= frame.bottom &&
        board.right <= frame.right
      );
    });
    expect(fit).toBe(true);

    await dina.screenshot({
      path: info.outputPath("desktop.png"),
      fullPage: true,
    });
    await dina.setViewportSize({ width: 390, height: 844 });
    await expect(dina.locator(".board-cell")).toHaveCount(40);
    expect(
      await dina.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await dina.evaluate(() => {
        const toolbar = document
          .querySelector(".match-toolbar")
          ?.getBoundingClientRect();
        const workspace = document
          .querySelector(".game-workspace")
          ?.getBoundingClientRect();
        return !!toolbar && !!workspace && toolbar.bottom <= workspace.top;
      }),
    ).toBe(true);
    await dina.screenshot({
      path: info.outputPath("narrow.png"),
      fullPage: true,
    });
    for (const link of await dina.locator("footer a").all())
      await expect(link).toHaveAttribute("target", "_blank");
  } finally {
    await first.close();
    await second.close();
  }
});

test("normal game resolves its first landing, preserves its seat, and supports logout", async ({
  page,
}) => {
  await login(page, "benoit");
  const client = await page.context().browser()?.newContext();
  if (!client) throw new Error("Second browser context required");
  try {
    const chloe = await client.newPage();
    await login(chloe, "chloe");
    await page.getByRole("textbox", { name: "Game name" }).fill("Normal game");
    await page.getByRole("button", { name: "Create lobby" }).click();
    await expect(page).toHaveURL(/#match\//);
    await chloe.goto(page.url());
    await chloe.getByRole("button", { name: "Join game", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Start game", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await page.getByRole("button", { name: "Roll for Benoit" }).click();
    await expect
      .poll(async () => (await snapshot(page)).lastDice)
      .not.toBeNull();
    if ((await snapshot(page)).phase === "PurchaseDecision")
      await page.getByRole("button", { name: "Buy for Benoit" }).click();
    await page.getByRole("button", { name: "End Benoit’s turn" }).click();
    await expect(
      page.getByRole("button", { name: "Roll for Chloe" }),
    ).toBeVisible();
    const before = await snapshot(page);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Roll for Chloe" }),
    ).toBeVisible();
    expect((await snapshot(page)).players).toEqual(before.players);
    await page.getByRole("link", { name: "All games", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Start a game" }),
    ).toBeVisible();
    await page.getByLabel("Open account menu").click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Choose a tutorial identity" }),
    ).toBeVisible();
    const session = await page.request.get("/api/session");
    expect(await session.json()).toEqual({ user: null });
  } finally {
    await client.close();
  }
});
