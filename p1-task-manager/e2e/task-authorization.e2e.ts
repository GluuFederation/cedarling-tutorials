import { expect, test } from "@playwright/test";

test("real browser Cedarling evaluates controls and the API rejects a bypass", async ({
  page,
}) => {
  const decisions: string[] = [];
  const pendingLogs: Promise<void>[] = [];
  const pageErrors: string[] = [];
  const cspViolations: string[] = [];
  const issuerRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (
      ["fetch", "xhr"].includes(request.resourceType()) &&
      new URL(request.url()).origin === "http://localhost:18001"
    )
      issuerRequests.push(request.url());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error("P1 test CSP violation:", event.effectiveDirective);
    });
  });
  page.on("console", (message) => {
    if (message.text().startsWith("P1 test CSP violation:"))
      cspViolations.push(message.text());
    for (const argument of message.args()) {
      pendingLogs.push(
        argument
          .jsonValue()
          .then((value: unknown) => {
            if (
              typeof value === "object" &&
              value !== null &&
              "request_id" in value &&
              "decision" in value &&
              typeof value.decision === "string"
            )
              decisions.push(value.decision);
          })
          .catch(() => {}),
      );
    }
  });
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toMatch(
    /(?:^|;)connect-src 'self'(?:;|$)/u,
  );
  await page.getByRole("link", { name: /Alex/u }).click();
  await page.getByRole("textbox", { name: "Enter any login" }).fill("alex");
  await page.getByRole("textbox", { name: "and password" }).fill("tutorial");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Prepare launch brief/u }).click();
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete task" })).toHaveCount(
    0,
  );
  // Actual SDK decision logs distinguish browser evaluation from server-ceiling fallback.
  await expect
    .poll(async () => {
      await Promise.all(pendingLogs);
      return [...new Set(decisions)].sort();
    })
    .toContain("ALLOW");
  const denied = await page.evaluate(async () => {
    const session = (await fetch("/api/session").then((response) =>
      response.json(),
    )) as { csrfToken: string };
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({
        title: "Unauthorized creation",
        description: "Must not be saved",
      }),
    });
    return response.status;
  });
  expect(denied).toBe(403);
  await Promise.all(pendingLogs);
  decisions.length = 0;
  await page.reload();
  await expect
    .poll(async () => {
      await Promise.all(pendingLogs);
      return decisions;
    })
    .toContain("ALLOW");
  await expect(page.getByText("Unauthorized creation")).toHaveCount(0);
  expect.soft(cspViolations).toEqual([]);
  expect.soft(pageErrors).toEqual([]);
  expect.soft(issuerRequests).toEqual([]);
});
