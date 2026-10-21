import { checklistKeys } from "../shared/catalog.ts";
import type { Checklist } from "../shared/types.ts";

type DraftChecklist = {
  readonly [Key in keyof Checklist]: boolean | null;
};
export const emptyChecklist: DraftChecklist = {
  equipmentConditionPassed: null,
  safetyChecksPassed: null,
  functionalCheckPassed: null,
};
export function answered(checklist: DraftChecklist): checklist is Checklist {
  return checklistKeys.every((key) => typeof checklist[key] === "boolean");
}

export type InspectionDraft = Readonly<{
  key: string;
  principalId: string;
  workOrderId: string;
  expectedWorkOrderVersion: number;
  checklist: DraftChecklist;
  formatVersion: 3;
  notes: string;
  idempotencyKey: string;
  createdAt: string;
  status: "draft" | "queued" | "orphaned";
}>;

export class IncompatibleDraftError extends Error {
  constructor(readonly notes: string) {
    super(
      "This saved draft uses a different checklist. Copy any notes you need, then discard it and enter new answers.",
    );
  }
}

export class DraftStorageError extends Error {
  constructor(cause: unknown) {
    super(
      "Browser storage could not be accessed. Keep this page open and copy your notes before reloading; the latest change may not be saved on this device.",
      { cause },
    );
  }
}

export function readDraft(
  value: InspectionDraft | undefined,
): InspectionDraft | undefined {
  if (!value) return value;
  if (
    value.formatVersion !== 3 ||
    !value.checklist ||
    Object.keys(value.checklist).length !== checklistKeys.length ||
    checklistKeys.some(
      (key) =>
        value.checklist[key] !== null &&
        typeof value.checklist[key] !== "boolean",
    )
  )
    throw new IncompatibleDraftError(value.notes);
  return value;
}

const databaseName = "p6-field-inspection";
const storeName = "drafts";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Draft database unavailable"));
  });
}

async function operation<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    const opened = database;
    return await new Promise<T>((resolve, reject) => {
      const transaction = opened.transaction(storeName, mode);
      const request = run(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Draft operation failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Draft transaction aborted"));
    });
  } catch (error) {
    throw new DraftStorageError(error);
  } finally {
    database?.close();
  }
}

export const drafts = {
  key: (principalId: string, workOrderId: string) =>
    `${principalId}:${workOrderId}`,
  get: async (key: string) =>
    readDraft(
      await operation<InspectionDraft | undefined>("readonly", (store) =>
        store.get(key),
      ),
    ),
  put: (draft: InspectionDraft) =>
    operation<IDBValidKey>("readwrite", (store) => store.put(draft)),
  remove: (key: string) =>
    operation<undefined>("readwrite", (store) => store.delete(key)),
  incompatible: async (principalId: string) => {
    const all = await operation<InspectionDraft[]>("readonly", (store) =>
      store.getAll(),
    );
    return all
      .filter((draft) => {
        if (draft.principalId !== principalId) return false;
        try {
          readDraft(draft);
          return false;
        } catch {
          return true;
        }
      })
      .map(({ key, workOrderId, notes }) => ({ key, workOrderId, notes }));
  },
  saved: async (principalId: string) => {
    const all = await operation<InspectionDraft[]>("readonly", (store) =>
      store.getAll(),
    );
    return all
      .filter((draft) => {
        if (draft.principalId !== principalId) return false;
        try {
          return Boolean(readDraft(draft));
        } catch {
          return false;
        }
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },
};
