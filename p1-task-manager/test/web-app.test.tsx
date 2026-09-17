/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const browserTrace = vi.fn();

describe("P1 task UI", () => {
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.resetAllMocks();
    document.body.innerHTML = '<div id="root"></div>';
    vi.spyOn(console, "info").mockImplementation(browserTrace);
    root = createRoot(document.querySelector("#root")!);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    api.session.mockResolvedValue(alex);
    api.tasks.mockResolvedValue({ tasks: [task] });
    api.task.mockResolvedValue({ task });
    api.logout.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    vi.restoreAllMocks();
  });

  it("loads task.view, emits the teaching trace, and switches branding by viewport", async () => {
    renderApp(root);
    await settle();
    await settle();

    expect(api.task).toHaveBeenCalledWith("task-a-brief");
    expect(browserTrace).toHaveBeenCalledOnce();
    expect(browserTrace.mock.calls[0]?.[0]).toContain(
      "P1 browser | FAKE ALLOW (presentation only)",
    );
    expect(browserTrace).toHaveBeenCalledWith(
      "P1 browser | FAKE ALLOW (presentation only) | task.view | user-alex -> TaskCollection::tenant-a",
    );
    expect(JSON.stringify(browserTrace.mock.calls)).not.toMatch(
      /access-token|refresh-token|id-token|p1_session/,
    );

    const source = document.querySelector<HTMLSourceElement>(
      ".brand-lockup source",
    );
    expect(source?.media).toBe("(max-width: 760px)");
    expect(source?.srcset).toContain("cedarling-mark");
    expect(
      document.querySelector<HTMLImageElement>(".brand-lockup img")?.src,
    ).toContain("cedarling-wordmark-dark");
  });

  it.each(tutorialSessions)(
    "keeps all permissive capabilities explorable for %s",
    async (_name, session) => {
      api.session.mockResolvedValue(session);
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
      expect(
        document.querySelector<HTMLInputElement>(".task-form input")?.disabled,
      ).toBe(false);
      expect(api.task).toHaveBeenCalledWith("task-a-brief");
    },
  );

  it("disables only the impossible completion transition for a completed task", async () => {
    api.task.mockResolvedValue({ task: { ...task, status: "completed" } });
    renderApp(root);
    await settle();
    await settle();

    expect(button("Complete task").disabled).toBe(true);
    expect(button("Save changes").disabled).toBe(false);
    expect(button("Assign to Mina").disabled).toBe(false);
    expect(button("Delete").disabled).toBe(false);
  });

  it("preserves a failed create form and requires confirmation before delete", async () => {
    api.session.mockResolvedValue(tutorialSessions[1]?.[1]);
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
