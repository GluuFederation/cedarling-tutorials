/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthorizationEnvelope,
  TaskCeiling,
} from "../src/shared/authorization";
import type { Session, Task } from "../src/web/types";

const api = vi.hoisted(() => ({
  session: vi.fn(),
  tasks: vi.fn(),
  task: vi.fn(),
  create: vi.fn(),
  edit: vi.fn(),
  assign: vi.fn(),
  complete: vi.fn(),
  delete: vi.fn(),
  logout: vi.fn(),
}));
const browserAuthorization = vi.hoisted(() => ({
  authorizePresentation: vi.fn(),
  closeBrowserAuthorization: vi.fn(async () => {}),
}));

vi.mock("../src/web/api", () => ({
  api,
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
    ) {
      super(code);
    }
  },
}));

vi.mock("../src/web/authorization-trace", () => browserAuthorization);

import App from "../src/web/App";

const task: Task = {
  id: "task-a-brief",
  tenantId: "tenant-a",
  ownerId: "user-mina",
  assigneeId: "user-alex",
  title: "Prepare launch brief",
  description: "Summarize the P1 tutorial goals.",
  status: "in-progress",
  version: 1,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

const alex: Session = {
  user: {
    id: "user-alex",
    name: "Alex Morgan",
    tenantId: "tenant-a",
    role: "contributor",
    assuranceLevel: 1,
  },
  csrfToken: "csrf",
  expiresAt: "2026-08-27T12:20:00.000Z",
};

const tutorialSessions: ReadonlyArray<readonly [string, Session]> = [
  ["Alex", alex],
  [
    "Mina",
    {
      ...alex,
      user: {
        ...alex.user,
        id: "user-mina",
        name: "Mina Okafor",
        role: "owner",
        assuranceLevel: 2,
      },
    },
  ],
  [
    "Sam",
    {
      ...alex,
      user: {
        ...alex.user,
        id: "user-sam",
        name: "Sam Rivera",
        tenantId: "tenant-b",
        role: "external",
      },
    },
  ],
];

function envelope(
  session: Session,
  taskCeiling: TaskCeiling,
  create: boolean,
  currentTask: Task = task,
): AuthorizationEnvelope {
  return {
    uiPrincipal: session.user,
    ceiling: {
      tenant: { create },
      tasks: { [currentTask.id]: taskCeiling },
    },
    policy: {
      release: "p1@1.0.0",
      storeId: "p1",
      version: "1.0.0",
      sha256: "a".repeat(64),
      url: `/policy-store/${"a".repeat(64)}.cjar`,
    },
    subjectEpoch: `epoch-${String(session.user.id)}`,
    resourceVersions: { [currentTask.id]: currentTask.version },
    evaluatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function authorizeSession(
  session: Session,
  controls: TaskCeiling,
  create: boolean,
  currentTask: Task = task,
): void {
  const authorization = envelope(session, controls, create, currentTask);
  api.tasks.mockResolvedValue({ tasks: [currentTask], authorization });
  api.task.mockResolvedValue({
    task: currentTask,
    assignmentTarget: {
      id: "user-mina",
      name: "Mina Okafor",
      tenantId: "tenant-a",
    },
    authorization,
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(label: string): HTMLButtonElement {
  const result = Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent.trim() === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

function renderApp(root: Root): void {
  act(() => root.render(<App />));
}

describe("P1 task UI", () => {
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.resetAllMocks();
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    api.session.mockResolvedValue(alex);
    authorizeSession(alex, { view: true, edit: true }, false);
    browserAuthorization.authorizePresentation.mockImplementation(
      async ({ envelope: current }: { envelope: AuthorizationEnvelope }) => ({
        ceiling: current.ceiling,
        stale: false,
      }),
    );
    api.logout.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    vi.restoreAllMocks();
  });

  it("evaluates browser presentation and switches branding by viewport", async () => {
    renderApp(root);
    await settle();
    await settle();

    expect(api.task).toHaveBeenCalledWith("task-a-brief");
    expect(browserAuthorization.authorizePresentation).toHaveBeenCalled();

    const source = document.querySelector<HTMLSourceElement>(
      ".brand-lockup source",
    );
    expect(source?.media).toBe("(max-width: 760px)");
    expect(source?.srcset).toContain("cedarling-mark");
    expect(
      document.querySelector<HTMLImageElement>(".brand-lockup img")?.src,
    ).toContain("cedarling-wordmark-dark");
  });

  it("shows only controls allowed by the server ceiling and browser decision", async () => {
    renderApp(root);
    await settle();
    await settle();

    expect(button("Save changes").disabled).toBe(false);
    for (const label of [
      "New task",
      "Assign to Mina",
      "Complete task",
      "Delete",
    ]) {
      expect(
        Array.from(document.querySelectorAll("button")).some(
          (item) => item.textContent.trim() === label,
        ),
      ).toBe(false);
    }
  });

  it("shows the owner controls when both decisions allow them", async () => {
    const mina = tutorialSessions[1]![1];
    api.session.mockResolvedValue(mina);
    authorizeSession(
      mina,
      { view: true, edit: true, assign: true, complete: true, delete: true },
      true,
    );
    renderApp(root);
    await settle();
    await settle();

    for (const label of [
      "New task",
      "Save changes",
      "Assign to Mina",
      "Complete task",
      "Delete",
    ]) {
      expect(button(label).disabled).toBe(false);
    }
  });

  it("disables only the impossible completion transition for a completed task", async () => {
    const mina = tutorialSessions[1]![1];
    const completed = { ...task, status: "completed" as const };
    api.session.mockResolvedValue(mina);
    authorizeSession(
      mina,
      { view: true, edit: true, assign: true, complete: true, delete: true },
      true,
      completed,
    );
    renderApp(root);
    await settle();
    await settle();

    expect(button("Complete task").disabled).toBe(true);
    expect(button("Save changes").disabled).toBe(false);
    expect(button("Assign to Mina").disabled).toBe(false);
    expect(button("Delete").disabled).toBe(false);
  });

  it("removes expired creation permission when list refresh fails", async () => {
    vi.useFakeTimers();
    const mina = tutorialSessions[1]![1];
    api.session.mockResolvedValue(mina);
    authorizeSession(mina, { view: true, edit: true }, true);
    renderApp(root);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(button("New task").disabled).toBe(false);

    api.tasks.mockRejectedValue(new Error("List refresh failed"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(document.body.textContent).toContain("Task service unavailable");
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (item) => item.textContent.trim() === "New task",
      ),
    ).toBe(false);
  });

  it("does not restore permissions from an older task-list response", async () => {
    const mina = tutorialSessions[1]![1];
    api.session.mockResolvedValue(mina);
    api.tasks.mockRejectedValueOnce(new Error("Retry the list"));
    renderApp(root);
    await settle();
    const older = {
      tasks: [task],
      authorization: envelope(mina, { view: true }, true),
    };
    let finishOlder!: (result: typeof older) => void;
    api.tasks.mockReturnValueOnce(
      new Promise<typeof older>((resolve) => {
        finishOlder = resolve;
      }),
    );
    api.tasks.mockResolvedValueOnce({
      tasks: [],
      authorization: envelope(mina, {}, false),
    });
    const retry = button("Retry");
    act(() => {
      retry.click();
      retry.click();
    });
    await settle();
    await act(async () => {
      finishOlder(older);
    });

    expect(
      Array.from(document.querySelectorAll("button")).some(
        (item) => item.textContent.trim() === "New task",
      ),
    ).toBe(false);
    expect(document.body.textContent).not.toContain(task.title);
  });

  it("disables an already-open create form when its permission expires", async () => {
    vi.useFakeTimers();
    const mina = tutorialSessions[1]![1];
    api.session.mockResolvedValue(mina);
    authorizeSession(mina, { view: true }, true);
    renderApp(root);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => button("New task").click());
    api.tasks.mockRejectedValue(new Error("List refresh failed"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(button("Create task").disabled).toBe(true);
    act(() => {
      document
        .querySelector<HTMLFormElement>(".modal-panel form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(api.create).not.toHaveBeenCalled();
  });

  it("ignores browser evaluation from an older list refresh", async () => {
    vi.useFakeTimers();
    const mina = tutorialSessions[1]![1];
    api.session.mockResolvedValue(mina);
    authorizeSession(mina, { view: true }, true);
    renderApp(root);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const older = envelope(mina, { view: true }, true);
    let finishOlder!: (result: {
      ceiling: AuthorizationEnvelope["ceiling"];
      stale: boolean;
    }) => void;
    browserAuthorization.authorizePresentation.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOlder = resolve;
      }),
    );
    api.tasks.mockResolvedValueOnce({ tasks: [task], authorization: older });
    api.create.mockResolvedValueOnce({ task });
    act(() => button("New task").click());
    await act(async () => {
      document
        .querySelector<HTMLFormElement>(".modal-panel form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await vi.advanceTimersByTimeAsync(0);
    });
    api.tasks.mockResolvedValueOnce({
      tasks: [],
      authorization: envelope(mina, {}, false),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await act(async () => {
      finishOlder({ ceiling: older.ceiling, stale: false });
    });
    expect(document.body.textContent).not.toContain("New task");
    expect(document.querySelector(".task-ledger")?.textContent).not.toContain(
      task.title,
    );
  });

  it("does not carry a pending list response into a new session", async () => {
    const mina = tutorialSessions[1]![1];
    api.session.mockResolvedValue(mina);
    const older = {
      tasks: [task],
      authorization: envelope(mina, { view: true }, true),
    };
    let finishOlder!: (result: typeof older) => void;
    api.tasks.mockReturnValueOnce(
      new Promise<typeof older>((resolve) => {
        finishOlder = resolve;
      }),
    );
    renderApp(root);
    await settle();
    act(() => root.render(null));
    api.session.mockResolvedValue(alex);
    authorizeSession(alex, { view: true }, false);
    renderApp(root);
    await settle();
    await act(async () => {
      finishOlder(older);
    });
    expect(document.body.textContent).not.toContain("New task");
    expect(document.querySelector(".identity-copy")?.textContent).toContain(
      "Alex Morgan",
    );
  });

  it("preserves a failed create form and requires confirmation before delete", async () => {
    api.session.mockResolvedValue(tutorialSessions[1]?.[1]);
    authorizeSession(
      tutorialSessions[1]![1],
      { view: true, edit: true, assign: true, complete: true, delete: true },
      true,
    );
    api.create.mockRejectedValue(new Error("dependency detail"));

    renderApp(root);
    await settle();
    await settle();

    act(() => button("New task").click());
    const title = document.querySelector<HTMLInputElement>(
      ".modal-panel input[data-autofocus]",
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(title, "Keep this title");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      document
        .querySelector<HTMLFormElement>(".modal-panel form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await settle();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(title.value).toBe("Keep this title");
    expect(document.querySelector(".inline-feedback")?.textContent).toContain(
      "Task service unavailable",
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    act(() => button("Delete").click());
    expect(
      document.querySelector("#delete-task-description")?.textContent,
    ).toContain("Prepare launch brief");
    expect(api.delete).not.toHaveBeenCalled();
    expect(button("Delete task")).toBeTruthy();
  });
});
