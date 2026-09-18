import { expect, type Page, test } from "@playwright/test";

async function signIn(
  page: Page,
  name: string,
  subject: string,
): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "P14 - Governing an AI Scheduling Assistant with Cedarling",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: new RegExp(name, "u") }).click();
  await page.getByRole("textbox", { name: "Enter any login" }).fill(subject);
  await page.getByRole("textbox", { name: "and password" }).fill("tutorial");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/p14\.localhost:3014/u);
  await expect(
    page.getByRole("heading", { name: "Scheduling assistant", exact: true }),
  ).toBeVisible();
}

async function runRequest(
  page: Page,
  request: string,
  expected: string,
): Promise<void> {
  await page.getByRole("button", { name: request }).click();
  await page.getByRole("button", { name: "Create proposal" }).click();
  await expect(page.getByRole("button", { name: "Run action" })).toBeVisible();
  await page.getByRole("button", { name: "Run action" }).click();
  await expect(page.getByRole("status")).toContainText(expected);
}

test("reproduces the three scheduling authorization gaps", async ({
  browser,
}) => {
  const benoitContext = await browser.newContext();
  const chloeContext = await browser.newContext();
  const amaraContext = await browser.newContext();
  try {
    const benoit = await benoitContext.newPage();
    await signIn(benoit, "Benoit", "benoit");
    await runRequest(
      benoit,
      "Move the selected meeting one hour later to Focus Room",
      "Launch Review was rescheduled.",
    );
    await expect(benoit).toHaveURL(/\?meeting=meeting-launch/u);

    const chloe = await chloeContext.newPage();
    await signIn(chloe, "Chloe", "chloe");
    await runRequest(
      chloe,
      "Schedule Vendor follow-up with Chloe in Atlas Boardroom",
      "Vendor follow-up was scheduled.",
    );
    await expect(chloe).toHaveURL(/\?meeting=meeting-/u);

    const amara = await amaraContext.newPage();
    await signIn(amara, "Amara", "amara");
    await amara.getByRole("button", { name: /Leadership Sync/u }).click();
    await runRequest(
      amara,
      "Cancel the selected meeting",
      "Leadership Sync was cancelled.",
    );
  } finally {
    await benoitContext.close();
    await chloeContext.close();
    await amaraContext.close();
  }
});
