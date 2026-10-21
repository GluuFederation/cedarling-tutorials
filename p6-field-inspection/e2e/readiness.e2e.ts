import { expect, type Page, test } from "@playwright/test";
import type { WorkOrder } from "../src/shared/types.ts";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: /Elena Rossi/u }).click();
  await page.getByRole("textbox", { name: "Enter any login" }).fill("elena");
  await page.getByRole("textbox", { name: "and password" }).fill("tutorial");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Ventilation unit 03/u }).click();
  await expect(
    page.getByRole("heading", { name: "Ventilation unit 03" }),
  ).toBeVisible();
}

async function restoreStorage(page: Page) {
  await page.evaluate(() => {
    (
      window as Window & { restoreDraftStorage: () => void }
    ).restoreDraftStorage();
  });
}

for (const failure of ["open", "read"] as const) {
  test(`loads server records when draft ${failure} fails and recovers without losing edits`, async ({
    page,
  }) => {
    await page.addInitScript((method) => {
      if (sessionStorage.getItem("p6-storage-test-restored") === "yes") return;
      const originalOpen = IDBFactory.prototype.open;
      const originalGet = IDBObjectStore.prototype.get;
      Object.assign(window, {
        restoreDraftStorage: () => {
          IDBFactory.prototype.open = originalOpen;
          IDBObjectStore.prototype.get = originalGet;
          sessionStorage.setItem("p6-storage-test-restored", "yes");
        },
      });
      const fail = () => {
        throw new DOMException("Storage blocked", "SecurityError");
      };
      if (method === "open") IDBFactory.prototype.open = fail;
      else IDBObjectStore.prototype.get = fail;
    }, failure);
    await signIn(page);
    if (failure === "read") {
      await page.evaluate(async () => {
        const request = indexedDB.open("p6-field-inspection", 1);
        await new Promise<void>((resolve, reject) => {
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const database = request.result;
            const transaction = database.transaction("drafts", "readwrite");
            transaction.objectStore("drafts").put({
              key: "user-elena:wo-ventilation-03",
              principalId: "user-elena",
              workOrderId: "wo-ventilation-03",
              formatVersion: 2,
              checklist: { oldCheck: true },
              notes: "An older checklist note",
            });
            transaction.oncomplete = () => {
              database.close();
              resolve();
            };
            transaction.onabort = () => {
              database.close();
              reject(transaction.error);
            };
          };
        });
      });
    }
    const warning = page.getByRole("region", {
      name: "Browser storage unavailable",
    });
    await expect(warning).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "Add work order" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Submit inspection", exact: true }),
    ).toBeDisabled();
    const notes = page.getByRole("textbox", { name: "Inspection notes" });
    await notes.fill("Keep my unsaved inspection");
    await page
      .getByRole("group", { name: "Safety checks", exact: true })
      .getByRole("radio", { name: "Fail", exact: true })
      .check();
    await page.getByRole("tab", { name: "Manage order" }).click();
    await expect(
      page.getByRole("button", { name: "Reassign", exact: true }),
    ).toBeEnabled();
    await page.getByRole("tab", { name: "Inspection", exact: true }).click();
    await page.getByRole("button", { name: "Refresh queue" }).click();
    await expect(warning).toBeVisible();
    await restoreStorage(page);
    await page.getByRole("button", { name: "Retry storage" }).click();
    await expect(warning).toHaveCount(0);
    await expect(notes).toHaveValue("Keep my unsaved inspection");
    await expect(
      page
        .getByRole("group", { name: "Safety checks", exact: true })
        .getByRole("radio", { name: "Fail", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByText("Unsaved changes", { exact: true }),
    ).toBeVisible();
    if (failure === "read") {
      await expect(page.getByText("An older checklist note")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Save draft", exact: true }),
      ).toBeDisabled();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Discard old draft" }).click();
      await expect(notes).toHaveValue("Keep my unsaved inspection");
    }
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByText("Draft saved on this device.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(notes).toHaveValue("Keep my unsaved inspection");
  });
}

test("retrying storage restores a saved queue without sending it", async ({
  page,
}) => {
  await signIn(page);
  await page.evaluate(async () => {
    const session = await fetch("/api/session").then((response) =>
      response.json(),
    );
    const order = await fetch("/api/work-orders/wo-ventilation-03").then(
      (response) => response.json(),
    );
    const request = indexedDB.open("p6-field-inspection", 1);
    await new Promise<void>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("drafts", "readwrite");
        transaction.objectStore("drafts").put({
          key: `${session.user.id}:${order.id}`,
          principalId: session.user.id,
          workOrderId: order.id,
          expectedWorkOrderVersion: order.workOrderVersion,
          checklist: {
            equipmentConditionPassed: true,
            safetyChecksPassed: true,
            functionalCheckPassed: true,
          },
          formatVersion: 3,
          notes: "Saved queue to recover",
          idempotencyKey: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          status: "queued",
        });
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      };
    });
  });
  await page.addInitScript(() => {
    const original = IDBFactory.prototype.open;
    Object.assign(window, {
      restoreDraftStorage: () => {
        IDBFactory.prototype.open = original;
      },
    });
    IDBFactory.prototype.open = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  let submissions = 0;
  await page.route("**/api/work-orders/*/inspections", async (route) => {
    submissions += 1;
    await route.fulfill({ status: 503, json: { error: "unavailable" } });
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Retry storage" }),
  ).toBeVisible();
  await restoreStorage(page);
  await page.getByRole("button", { name: "Retry storage" }).click();
  await expect(
    page.getByRole("textbox", { name: "Inspection notes" }),
  ).toHaveValue("Saved queue to recover");
  await expect(
    page.getByRole("button", { name: "Retry sending" }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  expect(submissions).toBe(0);
});

test("loads additional pages without changing selection, filters, or unsaved notes", async ({
  page,
}) => {
  await signIn(page);
  const records = await page.evaluate(
    async () =>
      (await fetch("/api/work-orders").then((response) => response.json()))
        .workOrders as WorkOrder[],
  );
  const selected = records.find((order) => order.id === "wo-ventilation-03");
  if (!selected) throw new Error("Missing ventilation fixture");
  const later = { ...selected, id: "wo-later", equipment: "Later work order" };
  const offsets: string[] = [];
  await page.route("**/api/work-orders?*", async (route) => {
    const offset =
      new URL(route.request().url()).searchParams.get("offset") ?? "0";
    offsets.push(offset);
    await route.fulfill({
      json:
        offset === "20"
          ? { workOrders: [], createAllowed: true, nextOffset: 40 }
          : {
              workOrders: [selected, later],
              createAllowed: true,
              nextOffset: null,
            },
    });
  });
  await page.route("**/api/work-orders", (route) =>
    route.fulfill({
      json: { workOrders: records, createAllowed: true, nextOffset: 20 },
    }),
  );
  const notes = page.getByRole("textbox", { name: "Inspection notes" });
  await notes.fill("Keep across queue pages");
  await page.getByRole("button", { name: "Refresh queue" }).click();
  await page.getByRole("searchbox").fill("Ventilation");
  await page.getByRole("button", { name: "Load more" }).click();
  await expect.poll(() => offsets.length).toBe(1);
  await expect(page.getByRole("button", { name: "Load more" })).toBeEnabled();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  expect(offsets).toEqual(["20", "40"]);
  await expect(page.getByRole("searchbox")).toHaveValue("Ventilation");
  await expect(notes).toHaveValue("Keep across queue pages");
  await expect(
    page.getByRole("button", { name: /Ventilation unit 03/u }),
  ).toHaveCount(1);
  await page.getByRole("searchbox").clear();
  await expect(
    page.getByRole("button", { name: /Later work order/u }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Ventilation unit 03/u }),
  ).toHaveAttribute("aria-current", "true");
});

test("discards an old load-more response after a queue refresh", async ({
  page,
}) => {
  await signIn(page);
  const records = await page.evaluate(
    async () =>
      (await fetch("/api/work-orders").then((response) => response.json()))
        .workOrders as WorkOrder[],
  );
  const selected = records.find((order) => order.id === "wo-ventilation-03");
  if (!selected) throw new Error("Missing ventilation fixture");
  let release: () => void = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pageRequests = 0;
  await page.route("**/api/work-orders?offset=20", async (route) => {
    pageRequests += 1;
    await delayed;
    await route.fulfill({
      json: {
        workOrders: [{ ...selected, id: "wo-stale", equipment: "Stale page" }],
        createAllowed: true,
        nextOffset: null,
      },
    });
  });
  await page.route("**/api/work-orders", (route) =>
    route.fulfill({
      json: { workOrders: records, createAllowed: true, nextOffset: 20 },
    }),
  );
  await page
    .getByRole("textbox", { name: "Inspection notes" })
    .fill("Keep through refresh");
  await page.getByRole("button", { name: "Refresh queue" }).click();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect.poll(() => pageRequests).toBe(1);
  await expect(page.getByRole("button", { name: "Load more" })).toBeDisabled();
  await page.getByRole("button", { name: "Refresh queue" }).click();
  await expect(page.getByRole("button", { name: "Load more" })).toBeEnabled();
  const finished = page.waitForResponse("**/api/work-orders?offset=20");
  release();
  await finished;
  // Wait for the browser to process the response before inspecting the queue.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole("button", { name: /Stale page/u })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Load more" })).toBeEnabled();
  await expect(
    page.getByRole("textbox", { name: "Inspection notes" }),
  ).toHaveValue("Keep through refresh");
});
