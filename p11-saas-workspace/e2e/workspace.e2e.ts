import { spawnSync } from "node:child_process";
import { expect, type Locator, type Page, test } from "@playwright/test";

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

async function signIn(page: Page, persona: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: new RegExp(persona, "u") }).click();
  await page
    .getByRole("textbox", { name: "Enter any login" })
    .fill(persona.toLowerCase());
  await page.getByRole("textbox", { name: "and password" }).fill("tutorial");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/localhost:17011/u);
}

async function switchWorkspace(
  page: Page,
  organization: string,
): Promise<void> {
  const trigger = page.getByLabel("Switch workspace");
  await touchTarget(trigger);
  await trigger.click();
  const option = page.getByRole("button", {
    name: new RegExp(organization, "u"),
  });
  await touchTarget(option);
  const switchUrl = await option.evaluate(
    (button) => button.closest("form")?.action ?? "",
  );
  const projectPath = new URL(switchUrl).pathname.replace(
    /\/switch$/u,
    "/projects/",
  );
  await option.click();
  await expect(page).toHaveURL((url) => url.pathname.startsWith(projectPath));
}

test("@visual keeps user controls compact across roles and workspace states", async ({
  browser,
}) => {
  for (const persona of ["Maya", "Noah", "Lena", "Imani"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    try {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && /hydrat/iu.test(message.text())) {
          pageErrors.push(message.text());
        }
      });
      await signIn(page, persona);
      if (persona === "Maya" || persona === "Noah") {
        const trigger = page.getByLabel("Switch workspace");
        const box = await trigger.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeLessThanOrEqual(60);
        await trigger.click();
        await expect(page.locator(".switcher")).toHaveAttribute("open", "");
        await page.keyboard.press("Escape");
        await expect(page.locator(".switcher")).not.toHaveAttribute("open", "");
        await expect(trigger).toBeFocused();
      }
      await expect(
        page.getByRole("link", { name: "My invitations", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Support access", exact: true }),
      ).toBeVisible();
      const account = page.getByLabel("Open account menu");
      await account.click();
      await expect(
        page.getByRole("button", { name: "Change account", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Sign out", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(account).toBeFocused();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(1440);
      await expect(page.locator(".program-footer")).toBeInViewport();
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

for (const [width, height] of [
  [320, 568],
  [390, 844],
  [768, 1024],
  [844, 390],
  [1440, 1000],
] as const) {
  test(`@responsive keeps editing and organization controls reachable at ${width} × ${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await signIn(page, "Maya");
    await touchTarget(page.getByRole("textbox", { name: "Project name" }));
    const projectName = page.getByRole("textbox", { name: "Project name" });
    const originalName = await projectName.inputValue();
    await projectName.fill(`Small-screen project ${width}`);
    await touchTarget(page.getByRole("button", { name: "Save changes" }));
    await expect(projectName).toHaveValue(`Small-screen project ${width}`);
    await projectName.fill(originalName);
    await page.getByRole("link", { name: "Members", exact: true }).click();
    await touchTarget(page.getByRole("combobox", { name: "Teammate" }));
    await touchTarget(
      page.getByRole("combobox", { name: "Role", exact: true }),
    );
    await touchTarget(page.getByRole("button", { name: "Create invitation" }));
    await touchTarget(page.getByRole("link", { name: "Billing", exact: true }));
    await switchWorkspace(page, "Tenant B · Boreal");
    await expect(page).toHaveURL(
      /organizations\/boreal\/projects\/project-b1/u,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBe(height);
    await expect(page.locator(".program-footer")).toBeInViewport();
    await switchWorkspace(page, "Tenant A · Aster");
    await expect(page).toHaveURL(/organizations\/aster\/projects\/project-a1/u);
    await page.locator('summary[aria-label="Open account menu"]').click();
    const logout = page.getByRole("button", {
      name: "Change account",
    });
    await touchTarget(logout);
    await logout.click();
    await expect(page.getByRole("link", { name: /Maya Aster/u })).toBeVisible();
    await page
      .getByRole("link", { name: /Imani Support agent/u })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("link", { name: /Imani Support agent/u }),
    ).toBeInViewport();
  });
}

for (const [width, height] of [
  [320, 568],
  [844, 390],
] as const) {
  test(`@responsive keeps invitation and support controls reachable at ${width} × ${height}`, async ({
    browser,
  }) => {
    for (const persona of ["Lena", "Imani"]) {
      const context = await browser.newContext({ viewport: { width, height } });
      try {
        const page = await context.newPage();
        await signIn(page, persona);
        if (persona === "Lena") {
          await touchTarget(
            page.getByRole("textbox", { name: "One-time invitation token" }),
          );
          await touchTarget(
            page.getByRole("button", { name: "Accept invitation" }),
          );
        } else {
          const open = page.getByRole("button", {
            name: /Open support access|Extend access/u,
          });
          await expect(open).toBeEnabled();
          await touchTarget(open);
          await open.click();
          const read = page.getByRole("link", {
            name: "Read approved project",
          });
          await touchTarget(read);
          await read.click();
          await expect(page.locator(".project-preview")).toBeVisible();
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBe(width);
        await expect(page.locator(".program-footer")).toBeInViewport();
      } finally {
        await context.close();
      }
    }
  });
}

function compose(...args: string[]): void {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

test("@forms keeps unsaved content with its original project", async ({
  page,
}) => {
  await signIn(page, "Maya");
  await page
    .getByRole("textbox", { name: "Project name" })
    .fill("Unsaved first project");
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("Belongs to project-a1 only");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: /Aster financial controls/u }).click();
  await expect(page).toHaveURL(/projects\/project-a1$/u);
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
    "Unsaved first project",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: /Aster financial controls/u }).click();
  await expect(page).toHaveURL(/projects\/project-a2$/u);
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
    "Aster financial controls",
  );
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
    "Private Tenant A finance control notes.",
  );
});

test("@forms preserves request integrity before JavaScript loads", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await signIn(page, "Maya");
    await switchWorkspace(page, "Tenant B · Boreal");
    await expect(page).toHaveURL(
      /organizations\/boreal\/projects\/project-b1/u,
    );
    await expect(page.locator(".content-shell")).toHaveCSS("display", "grid");
    await page.getByRole("link", { name: "Members", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Create invitation" }),
    ).toBeDisabled();

    const form = page.locator('form[action="/organizations/aster/switch"]');
    const fields = Object.fromEntries(
      await form
        .locator("input")
        .evaluateAll((inputs) =>
          inputs.map((input) => [
            input.getAttribute("name") ?? "",
            input.getAttribute("value") ?? "",
          ]),
        ),
    );
    for (const origin of ["null", "https://untrusted.example"]) {
      const response = await page.request.post("/organizations/aster/switch", {
        headers: { Origin: origin },
        form: fields,
      });
      expect(response.status()).toBe(403);
    }
    const tampered = await page.request.post("/organizations/aster/switch", {
      headers: { Origin: "http://localhost:17011" },
      form: { ...fields, _csrf: "invalid" },
    });
    expect(tampered.status()).toBe(403);
    await switchWorkspace(page, "Tenant A · Aster");
    await expect(page).toHaveURL(/organizations\/aster\/projects\/project-a1/u);
    await page.getByLabel("Open account menu").click();
    await page.getByRole("button", { name: "Change account" }).click();
    await expect(
      page.getByRole("heading", { name: "Choose a tutorial identity" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

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
    await expect(
      maya.getByRole("heading", { name: "Aster checkout hardening" }),
    ).toBeVisible();

    await switchWorkspace(maya, "Tenant B · Boreal");
    await expect(maya).toHaveURL(
      /organizations\/boreal\/projects\/project-b1/u,
    );
    await maya
      .getByRole("textbox", { name: "Project name" })
      .fill("Boreal viewer changed this project");
    await maya.getByRole("button", { name: "Save changes" }).click();
    await expect(maya.locator(".outcome")).toContainText(
      "Changes saved. Version 2",
    );
    await maya.getByRole("link", { name: "Billing" }).click();
    await expect(maya.getByRole("heading", { name: "Billing" })).toBeVisible();

    await switchWorkspace(maya, "Tenant A · Aster");
    await expect(maya).toHaveURL(/organizations\/aster\/projects\/project-a1/u);
    compose(
      "exec",
      "-T",
      "cedarworkspace",
      "node",
      "--env-file=/run/config/app.env",
      "scripts/admin.ts",
      "revoke",
      "user-maya",
      "aster",
    );
    await maya.reload();
    await expect(maya.locator(".switcher-trigger")).toContainText(
      "Membership unavailable",
    );
    await expect(maya.locator(".switcher-trigger")).not.toContainText("Boreal");
    await expect(
      maya.getByRole("textbox", { name: "Project name" }),
    ).toBeVisible();
    await maya
      .getByRole("textbox", { name: "Project name" })
      .fill("Stale Aster route remained effective");
    await maya.getByRole("button", { name: "Save changes" }).click();
    await expect(maya.locator(".outcome")).toContainText(
      "Changes saved. Version 2",
    );

    const noah = await noahContext.newPage();
    await signIn(noah, "Noah");
    await noah
      .getByRole("textbox", { name: "Description" })
      .fill("P11 restart persistence proof");
    await noah.getByRole("button", { name: "Save changes" }).click();
    await expect(noah.locator(".outcome")).toContainText(
      "Changes saved. Version 3",
    );

    const imani = await imaniContext.newPage();
    await signIn(imani, "Imani");
    await imani
      .getByRole("button", { name: /Open support access|Extend access/u })
      .click();
    await expect(imani.getByRole("status")).toContainText(
      "Support access opened.",
    );
    await imani.setViewportSize({ width: 390, height: 844 });
    await imani.goto("/organizations/aster/projects/project-a2");
    await expect(
      imani.getByRole("textbox", { name: "Project name" }),
    ).toHaveValue("Aster financial controls");
    await imani.getByRole("link", { name: "Billing" }).click();
    await expect(imani.getByRole("heading", { name: "Billing" })).toBeVisible();

    const lena = await lenaContext.newPage();
    await signIn(lena, "Lena");
    await lena
      .getByRole("textbox", { name: "One-time invitation token" })
      .fill("p11-lena-invite-token");
    await lena.getByRole("button", { name: "Accept invitation" }).click();
    await expect(lena.getByRole("status")).toContainText(
      "Invitation accepted.",
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

test("@workflow keeps editing explicit and preserves drafts after conflicts", async ({
  page,
}) => {
  await signIn(page, "Maya");
  await page.getByRole("link", { name: /Aster financial controls/u }).click();
  await expect(page).toHaveURL(/projects\/project-a2$/u);
  const projectUrl = page.url();
  const save = page.getByRole("button", { name: "Save changes" });
  const description = page.getByRole("textbox", { name: "Description" });
  const original = await description.inputValue();
  await expect(save).toBeDisabled();
  await page.getByLabel("Switch workspace").click();
  await expect(
    page.getByRole("button", { name: /Tenant A · Aster/u }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  expect(page.url()).toBe(projectUrl);
  await description.fill("Draft to cancel");
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(description).toHaveValue(original);
  await expect(save).toBeDisabled();
  await description.fill("First saved draft");
  await save.click();
  await expect(save).toBeDisabled();
  await expect(page.getByText(/Changes saved\. Version/u)).toBeVisible();

  const other = await page.context().newPage();
  await other.goto(projectUrl);
  await other
    .getByRole("textbox", { name: "Description" })
    .fill("Saved in another tab");
  await other.getByRole("button", { name: "Save changes" }).click();
  await expect(other.getByText(/Changes saved\. Version/u)).toBeVisible();
  await description.fill("Keep this unsaved draft after the conflict");
  await save.click();
  await expect(
    page.getByText(/This record changed\. Copy any unsaved edits/u),
  ).toBeVisible();
  await expect(description).toHaveValue(
    "Keep this unsaved draft after the conflict",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(description).toHaveValue("First saved draft");
  await page.reload();
  await expect(description).toHaveValue("Saved in another tab");
  await other.close();
});

test("@workflow completes invitation handoff and workspace entry without persona redirects", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const mayaContext = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const lenaContext = await browser.newContext();
  const imaniContext = await browser.newContext();
  try {
    const maya = await mayaContext.newPage();
    const lena = await lenaContext.newPage();
    const imani = await imaniContext.newPage();
    await signIn(imani, "Imani");
    await expect(imani).toHaveURL(/\/support$/u);
    await expect(imani.locator(".support-card")).toContainText(
      "Tenant A · Aster",
    );
    await signIn(maya, "Maya");
    await maya.getByRole("link", { name: "Members", exact: true }).click();
    const teammate = maya.getByRole("combobox", { name: "Teammate" });
    await expect(teammate).toHaveValue("user-imani");
    await expect(teammate.locator('option[value="user-lena"]')).toHaveAttribute(
      "disabled",
      "",
    );
    await expect(teammate.locator('option[value="user-maya"]')).toHaveAttribute(
      "disabled",
      "",
    );
    await maya.getByRole("button", { name: "Create invitation" }).click();
    await expect(maya.locator(".invitation-token")).toBeVisible();
    await maya.getByRole("button", { name: "Copy token" }).click();
    await expect(maya.locator(".invitation-token")).toContainText(
      "Token copied.",
    );
    expect(
      await maya.evaluate(
        async () =>
          (await navigator.clipboard.readText()) ===
          document.querySelector(".token-chip")?.textContent,
      ),
    ).toBe(true);
    await maya.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("Clipboard denied");
          },
        },
      }),
    );
    await maya.getByRole("button", { name: "Copy token" }).click();
    await expect(maya.locator(".invitation-token")).toContainText(
      "Select the token and copy it manually.",
    );
    await switchWorkspace(maya, "Tenant B · Boreal");
    await maya.getByRole("link", { name: "Members", exact: true }).click();
    await expect(maya.locator(".token-chip")).toHaveCount(0);
    await teammate.selectOption("user-lena");
    await maya.getByRole("button", { name: "Create invitation" }).click();
    const lenaToken = await maya.locator(".token-chip").innerText();
    compose(
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "p11",
      "-d",
      "p11",
      "-c",
      "UPDATE invitations SET expires_at = now() - interval '1 second' WHERE id = 'invite-lena-aster'",
    );
    await signIn(lena, "Lena");
    const expired = lena
      .locator(".invite-card")
      .filter({ hasText: "Tenant A · Aster" });
    await expect(expired).toContainText("expired");
    await expect(expired.getByRole("textbox")).toHaveCount(0);
    await lena
      .getByRole("textbox", { name: "One-time invitation token" })
      .fill(lenaToken);
    await lena.getByRole("button", { name: "Accept invitation" }).click();
    await expect(
      lena.getByRole("textbox", { name: "One-time invitation token" }),
    ).toHaveCount(0);
    await expect(lena.getByLabel("Open account menu")).toContainText(
      "No workspace selected",
    );
    await expect(
      lena.getByRole("link", { name: "Projects", exact: true }),
    ).toHaveCount(0);
    await lena.getByRole("button", { name: "Open Tenant B · Boreal" }).click();
    await expect(lena).toHaveURL(/organizations\/boreal\/projects/u);
    await lena.goto("/invitations");
    await expect(
      lena.getByRole("link", { name: "Go to workspace" }),
    ).toBeVisible();

    await maya.reload();
    await teammate.selectOption("user-imani");
    await maya.getByRole("button", { name: "Create invitation" }).click();
    const imaniToken = await maya.locator(".token-chip").innerText();
    compose(
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "p11",
      "-d",
      "p11",
      "-c",
      "UPDATE invitations SET state = 'revoked' WHERE target_principal_id = 'user-imani' AND organization_id = 'aster'",
    );
    await imani.goto("/invitations");
    const revoked = imani
      .locator(".invite-card")
      .filter({ hasText: "Tenant A · Aster" });
    await expect(revoked).toContainText("revoked");
    await expect(revoked.getByRole("textbox")).toHaveCount(0);
    await imani
      .getByRole("textbox", { name: "One-time invitation token" })
      .fill(imaniToken);
    await imani.getByRole("button", { name: "Accept invitation" }).click();
    await expect(
      imani.getByRole("button", { name: "Open Tenant B · Boreal" }),
    ).toBeVisible();
    await imani.goto("/");
    await expect(imani).toHaveURL(/\/invitations$/u);
    await imani.getByRole("button", { name: "Open Tenant B · Boreal" }).click();
    await expect(imani).toHaveURL(/organizations\/boreal\/projects/u);
    await imani.goto("/");
    await expect(imani).toHaveURL(/organizations\/boreal\/projects/u);

    await maya.reload();
    await teammate.selectOption("user-noah");
    await maya.getByRole("button", { name: "Create invitation" }).click();
    await expect(
      maya.getByRole("button", { name: "Create invitation" }),
    ).toBeDisabled();
    await expect(
      maya.getByText(
        "Everyone listed is already a member or has a pending invitation.",
      ),
    ).toBeVisible();
  } finally {
    await Promise.all([
      mayaContext.close(),
      lenaContext.close(),
      imaniContext.close(),
    ]);
  }
});

test("@limits keeps public assets outside the application request budget", async ({
  request,
}) => {
  const page = await request.get("/");
  const stylesheet = (await page.text()).match(
    /href="([^"]+\.css(?:\?[^"]*)?)"/u,
  )?.[1];
  expect(stylesheet).toBeTruthy();
  for (let index = 0; index < 605; index += 1) {
    expect((await request.get(stylesheet ?? "")).status()).toBe(200);
  }
  expect((await request.get("/health")).status()).toBe(200);
  let status = 200;
  for (let index = 0; index <= 600 && status === 200; index += 1) {
    status = (await request.get("/health")).status();
  }
  expect(status).toBe(429);
});

test("@persistence retains an authorized project effect after restart", async ({
  page,
}) => {
  await signIn(page, "Noah");
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
    "P11 restart persistence proof",
  );
});

test("@recovery retains the session and data after a database interruption", async ({
  page,
}) => {
  await signIn(page, "Noah");
  const projectPath = new URL(page.url()).pathname;
  const body = await page
    .getByRole("textbox", { name: "Description" })
    .inputValue();
  const document = await page.request.get(projectPath);
  expect(document.headers()["cache-control"]).toContain("no-store");
  const loader = await page.request.get(`${projectPath}.data`);
  expect(loader.headers()["cache-control"]).toContain("no-store");
  try {
    compose("stop", "postgres");
    const unavailable = await page.request.get(projectPath);
    expect(unavailable.status()).toBe(503);
    expect(unavailable.headers()["x-request-id"]).toBeTruthy();
    expect(await unavailable.text()).toContain("database_unavailable");
  } finally {
    compose("start", "postgres");
  }
  await expect
    .poll(async () => (await page.request.get("/health")).status())
    .toBe(200);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
    body,
  );
});
