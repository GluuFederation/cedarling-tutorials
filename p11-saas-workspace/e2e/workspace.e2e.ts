import { spawnSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";

async function signIn(page: Page, persona: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: new RegExp(persona, "u") }).click();
  await page
    .getByRole("textbox", { name: "Enter any login" })
    .fill(persona.toLowerCase());
  await page.getByRole("textbox", { name: "and password" }).fill("tutorial");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/p11\.localhost:3011/u);
}

function revokeMayaFromAster(): void {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "p11",
      "-d",
      "p11",
      "-c",
      "UPDATE memberships SET active = false, version = version + 1 WHERE principal_id = 'user-maya' AND organization_id = 'aster';",
    ],
    { cwd: process.cwd(), env: process.env, encoding: "utf8" },
  );
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

test("@exercise reproduces the three tenant authorization gaps and controls", async ({
  browser,
}) => {
  const mayaContext = await browser.newContext();
  const noahContext = await browser.newContext();
  const imaniContext = await browser.newContext();
  const lenaContext = await browser.newContext();
  try {
    const maya = await mayaContext.newPage();
    await signIn(maya, "Maya");
    await expect(maya.getByRole("heading", { name: "Projects" })).toBeVisible();

    await maya.getByRole("button", { name: /Tenant B · Boreal/u }).click();
    await expect(maya).toHaveURL(
      /organizations\/boreal\/projects\/project-b1/u,
    );
    await maya
      .getByRole("textbox", { name: "Project name" })
      .fill("Boreal viewer changed this project");
    await maya.getByRole("button", { name: "Save current version" }).click();
    await expect(maya.getByRole("status")).toContainText("Saved version 2");
    await maya.getByRole("link", { name: "Billing" }).click();
    await expect(
      maya.getByRole("heading", { name: "Billing projection" }),
    ).toBeVisible();

    await maya.getByRole("button", { name: /Tenant A · Aster/u }).click();
    await expect(maya).toHaveURL(/organizations\/aster\/projects\/project-a1/u);
    revokeMayaFromAster();
    await maya.reload();
    await expect(
      maya.getByRole("textbox", { name: "Project name" }),
    ).toBeVisible();
    await maya
      .getByRole("textbox", { name: "Project name" })
      .fill("Stale Aster route remained effective");
    await maya.getByRole("button", { name: "Save current version" }).click();
    await expect(maya.getByRole("status")).toContainText("Saved version 2");

    const noah = await noahContext.newPage();
    await signIn(noah, "Noah");
    await noah
      .getByRole("textbox", { name: "Project body" })
      .fill("P11 restart persistence proof");
    await noah.getByRole("button", { name: "Save current version" }).click();
    await expect(noah.getByRole("status")).toContainText("Saved version 3");

    const imani = await imaniContext.newPage();
    await signIn(imani, "Imani");
    await imani.getByRole("button", { name: "Open exact scope" }).click();
    await expect(imani.getByRole("status")).toContainText(
      "Exact support scope opened.",
    );
    await imani.goto("/organizations/aster/projects/project-a2");
    await expect(
      imani.getByRole("textbox", { name: "Project name" }),
    ).toHaveValue("Aster financial controls");
    await imani.getByRole("link", { name: "Billing" }).click();
    await expect(
      imani.getByRole("heading", { name: "Billing projection" }),
    ).toBeVisible();

    const lena = await lenaContext.newPage();
    await signIn(lena, "Lena");
    await lena
      .getByRole("textbox", { name: "One-time invitation token" })
      .fill("p11-lena-invite-token");
    await lena.getByRole("button", { name: "Accept invitation" }).click();
    await expect(lena.getByRole("status")).toContainText(
      "Invitation accepted once.",
    );
    await expect(lena).toHaveURL(/\/invitations$/u);
  } finally {
    await Promise.all([
      mayaContext.close(),
      noahContext.close(),
      imaniContext.close(),
      lenaContext.close(),
    ]);
  }
});

test("@persistence retains an authorized project effect after restart", async ({
  page,
}) => {
  await signIn(page, "Noah");
  await expect(page.getByRole("textbox", { name: "Project body" })).toHaveValue(
    "P11 restart persistence proof",
  );
});
