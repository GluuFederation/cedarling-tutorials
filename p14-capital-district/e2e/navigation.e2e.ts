import { expect, type Page, type Route, test } from "@playwright/test";
import { GameStore } from "../src/server/data/game-store.ts";
import { GameService } from "../src/server/game/service.ts";
import type { MatchSnapshot } from "../src/shared/contracts.ts";

async function navigation(page: Page) {
  const store = new GameStore(":memory:");
  const service = new GameService(store);
  const user = { id: "dina", name: "Dina" };
  const matches: MatchSnapshot[] = [];
  try {
    for (const name of ["First game", "Second game"])
      matches.push(
        (
          await service.create(
            user,
            { name, preset: "normal" },
            name.replaceAll(" ", "-"),
          )
        ).match,
      );
  } finally {
    store.close();
  }
  const [first, second] = matches;
  if (!first || !second) throw new Error("Two navigation fixtures required");
  const held = new Map<string, Route>();
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/session")
      return route.fulfill({ json: { user, csrfToken: "navigation-fixture" } });
    if (path.endsWith("/events")) return route.abort();
    const match = matches.find((entry) => path === `/api/matches/${entry.id}`);
    if (match) {
      held.set(match.id, route);
      return;
    }
    return route.fulfill({ json: matches });
  });
  await page.goto(`/#match/${first.id}`);
  await expect.poll(() => held.has(first.id)).toBe(true);
  await page.evaluate((id) => {
    location.hash = `match/${id}`;
  }, second.id);
  await expect.poll(() => held.has(second.id)).toBe(true);
  async function respond(id: string, status = 200) {
    const route = held.get(id);
    if (!route) throw new Error("Expected a held navigation request");
    const response = page.waitForResponse((entry) =>
      entry.url().endsWith(`/api/matches/${id}`),
    );
    await route.fulfill(
      status !== 200
        ? {
            status,
            json: {
              error: "service_unavailable",
              message: "Old request failed.",
            },
          }
        : { json: matches.find((entry) => entry.id === id) },
    );
    await response;
    // Flush the fetch continuation and React's render before checking the old result.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }
  return { first, second, respond };
}

for (const status of [401, 503]) {
  test(`an old navigation ${status} cannot replace the current game`, async ({
    page,
  }) => {
    const { first, second, respond } = await navigation(page);
    await respond(second.id);
    await expect(
      page.getByRole("heading", { name: second.name }),
    ).toBeVisible();
    await respond(first.id, status);
    await expect(
      page.getByRole("heading", { name: second.name }),
    ).toBeVisible();
  });
}

test("an old request cannot finish the current game's loading state", async ({
  page,
}) => {
  const { first, second, respond } = await navigation(page);
  await respond(first.id);
  await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "true");
  await respond(second.id);
  await expect(page.getByRole("heading", { name: second.name })).toBeVisible();
});

test("a delayed session refresh cannot restore an account after logout", async ({
  page,
}) => {
  const { second, respond } = await navigation(page);
  await respond(second.id);
  await expect(page.getByRole("heading", { name: second.name })).toBeVisible();
  let signedIn = true;
  let pending: Route | undefined;
  await page.route("**/api/session", async (route) => {
    if (!signedIn) return route.fulfill({ json: { user: null } });
    pending = route;
  });
  await page.route("**/auth/logout", async (route) => {
    signedIn = false;
    return route.fulfill({ status: 204 });
  });
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.getByLabel("Open account menu").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const login = page.getByRole("heading", {
    name: "Choose a tutorial identity",
  });
  await expect(login).toBeVisible();
  if (!pending) throw new Error("Expected a held session refresh");
  const completed = page.waitForResponse((response) =>
    response.url().endsWith("/api/session"),
  );
  await pending.fulfill({
    json: {
      user: { id: "dina", name: "Dina" },
      csrfToken: "navigation-fixture",
    },
  });
  await completed;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(login).toBeVisible();
});
