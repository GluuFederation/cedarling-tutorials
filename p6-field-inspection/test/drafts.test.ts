import { afterEach, expect, it, vi } from "vitest";
import {
  answered,
  DraftStorageError,
  drafts,
  type InspectionDraft,
  readDraft,
} from "../src/web/drafts.ts";

afterEach(() => vi.unstubAllGlobals());

it("refuses incompatible drafts without rewriting their answers or notes", () => {
  const legacy = {
    formatVersion: 2,
    checklist: { safetyGuardSecured: true },
    notes: "Keep these notes",
    status: "queued",
  } as unknown as InspectionDraft;
  const snapshot = structuredClone(legacy);
  expect(() => readDraft(legacy)).toThrow("different checklist");
  expect(legacy).toEqual(snapshot);
  const current = {
    ...legacy,
    formatVersion: 3,
    checklist: {
      equipmentConditionPassed: null,
      safetyChecksPassed: null,
      functionalCheckPassed: null,
    },
  } as InspectionDraft;
  expect(readDraft(current)).toBe(current);
  expect(answered(current.checklist)).toBe(false);
  expect(
    answered({
      equipmentConditionPassed: true,
      safetyChecksPassed: false,
      functionalCheckPassed: true,
    }),
  ).toBe(true);
});

function draftTransaction() {
  const request = {
    result: undefined,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };
  const transaction = {
    objectStore: () => ({ delete: () => request }),
    oncomplete: null as (() => void) | null,
    onabort: null as (() => void) | null,
    error: null,
  };
  const database = { transaction: () => transaction, close: vi.fn() };
  vi.stubGlobal("indexedDB", {
    open: () => {
      const opened = {
        result: database,
        onsuccess: null as (() => void) | null,
      };
      queueMicrotask(() => opened.onsuccess?.());
      return opened;
    },
  });
  return { request, transaction, database };
}

it("waits for the transaction to commit before reporting a saved change", async () => {
  const { request, transaction, database } = draftTransaction();
  const completed = vi.fn();
  const pending = drafts.remove("user-elena:wo-pump-17").then(completed);
  await vi.waitFor(() => expect(transaction.onabort).toBeTypeOf("function"));
  request.onsuccess?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();
  expect(database.close).not.toHaveBeenCalled();
  transaction.oncomplete?.();
  await pending;
  expect(completed).toHaveBeenCalledOnce();
  expect(database.close).toHaveBeenCalledOnce();
});

it("reports an abort even after the individual request succeeded", async () => {
  const { request, transaction, database } = draftTransaction();
  const pending = drafts.remove("user-elena:wo-pump-17");
  const rejected = expect(pending).rejects.toBeInstanceOf(DraftStorageError);
  await vi.waitFor(() => expect(transaction.onabort).toBeTypeOf("function"));
  request.onsuccess?.();
  transaction.onabort?.();
  await rejected;
  expect(database.close).toHaveBeenCalledOnce();
});

it("identifies unavailable local storage separately from a network failure", async () => {
  vi.stubGlobal("indexedDB", {
    open: () => {
      throw new DOMException("Blocked storage", "SecurityError");
    },
  });
  await expect(drafts.get("user-elena:wo-pump-17")).rejects.toThrow(
    "Browser storage could not be accessed",
  );
});
