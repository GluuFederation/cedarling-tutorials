import type { Checklist } from "../shared/types.ts";

export type InspectionDraft = Readonly<{
  key: string;
  principalId: string;
  workOrderId: string;
  expectedWorkOrderVersion: number;
  checklist: Checklist;
  notes: string;
  idempotencyKey: string;
  createdAt: string;
  status: "draft" | "queued" | "orphaned";
}>;

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
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = run(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Draft operation failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Draft transaction aborted"));
    });
  } finally {
    database.close();
  }
}

export const drafts = {
  key: (principalId: string, workOrderId: string) =>
    `${principalId}:${workOrderId}`,
  get: (key: string) =>
    operation<InspectionDraft | undefined>("readonly", (store) =>
      store.get(key),
    ),
  put: (draft: InspectionDraft) =>
    operation<IDBValidKey>("readwrite", (store) => store.put(draft)),
  remove: (key: string) =>
    operation<undefined>("readwrite", (store) => store.delete(key)),
  orphaned: async (principalId: string) => {
    const all = await operation<InspectionDraft[]>("readonly", (store) =>
      store.getAll(),
    );
    return all
      .filter(
        (draft) =>
          draft.principalId === principalId && draft.status === "orphaned",
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },
};
