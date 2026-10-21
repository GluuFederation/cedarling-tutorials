// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GradeView, StudentProfile } from "../src/shared/contracts.ts";
import { App } from "../src/web/App.tsx";
import { routes } from "../src/web/routes.tsx";

let host: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter> | undefined;
let teacher: GradeView;
let session: {
  user: { id: string; name: string; role: string };
  csrfToken: string;
  expiresAt: number;
} | null;
const profile: StudentProfile = {
  id: "sam",
  name: "Sam Rivera",
  preferredName: "Sam",
  studentNumber: "STU-1001",
  className: "10A",
  yearGroup: "Year 10",
  academicYear: "2026/27",
  admittedOn: "2025-09-01",
  enrollmentStatus: "Active",
  version: 1,
  enrollments: [{ courseId: "algebra", course: "Algebra", state: "active" }],
};
function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "X-Request-ID": "req_test" },
  });
}
function defaults(path: string, init?: RequestInit): Response {
  if (path === "/api/session")
    return session
      ? reply(session)
      : reply(
          { error: "AUTHENTICATION_REQUIRED", message: "Sign in again." },
          401,
        );
  if (path === "/auth/logout") {
    session = null;
    return new Response(null, { status: 204 });
  }
  if (path === "/api/students") return reply({ students: [profile] });
  if (path === "/api/students/sam") return reply(profile);
  if (path.startsWith("/api/grades/teacher?"))
    return reply({ grades: [teacher] });
  if (path.startsWith("/api/grades/teacher/")) return reply(teacher);
  if (path.startsWith("/api/grades/guardian"))
    return reply(
      path.includes("/grade-")
        ? {
            id: teacher.id,
            grade: {
              course: "Algebra",
              assessment: "Quiz 1",
              letterGrade: "B",
              publishedAt: "2026-10-01T10:00:00Z",
              version: 1,
            },
          }
        : { grades: [] },
    );
  if (path.startsWith("/api/grades/student")) return reply({ grades: [] });
  if (init?.method === "PATCH") {
    const value = JSON.parse(String(init.body)) as {
      score: number;
      feedback: string;
      internalNote: string;
    };
    teacher = {
      id: teacher.id,
      grade: { ...teacher.grade, ...value, version: teacher.grade.version + 1 },
    };
    return reply(teacher);
  }
  if (path.endsWith("/publish")) {
    teacher = {
      id: teacher.id,
      grade: {
        ...teacher.grade,
        state: "published",
        version: 2,
        publishedAt: "2026-10-01T10:00:00.000Z",
      },
    };
    return reply({
      id: teacher.id,
      state: "published",
      version: 2,
      publishedAt: "2026-10-01T10:00:00.000Z",
      requestId: "req_test",
    });
  }
  throw new Error(`Unexpected request: ${path}`);
}
async function settle(action: () => unknown) {
  await act(async () => {
    await action();
    await new Promise((done) => setTimeout(done, 15));
  });
}
async function render(path = "/students") {
  await settle(() => {
    router = createMemoryRouter(routes, { initialEntries: [path] });
    root.render(<App router={router} />);
  });
}
function button(text: string) {
  const value = [...host.querySelectorAll("button")].find((e) =>
    e.textContent?.includes(text),
  );
  if (!value) throw new Error(`Missing button: ${text}`);
  return value;
}
async function input(value: string) {
  const node = host.querySelector<HTMLInputElement>('input[name="score"]');
  if (!node) throw new Error("Missing score");
  await settle(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return node;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(window, "confirm").mockReturnValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  session = {
    user: { id: "talia", name: "Talia", role: "teacher" },
    csrfToken: "test-csrf",
    expiresAt: Date.now() + 60000,
  };
  teacher = {
    id: "grade-sam-1",
    grade: {
      studentId: "sam",
      studentName: "Sam Rivera",
      course: "Algebra",
      assessment: "Quiz 1",
      score: 85,
      feedback: "Clear working.",
      internalNote: "Check reasoning privately.",
      state: "draft",
      publishedAt: null,
      version: 1,
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => defaults(path, init)),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  router?.dispose();
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
test("the chooser presents all six identities in the shared shell", async () => {
  session = null;
  await render("/");
  expect(host.querySelectorAll(".account-choice")).toHaveLength(6);
  expect(host.textContent).toContain("René");
  expect(host.querySelector("h1")?.textContent).toContain(
    "P13 - Protecting Grade Publication",
  );
  for (const link of host.querySelectorAll("footer a"))
    expect(link.getAttribute("target")).toBe("_blank");
});
test("the account menu opens without an arrow and closes on Escape", async () => {
  await render();
  const menu = host.querySelector<HTMLDetailsElement>(".account-menu");
  const summary = menu?.querySelector("summary");
  expect(summary?.querySelector("svg")).toBeNull();
  await settle(() => summary?.click());
  expect(menu?.open).toBe(true);
  expect(button("Change account")).toBeDefined();
  expect(button("Sign out")).toBeDefined();
  await settle(() =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  expect(menu?.open).toBe(false);
  expect(document.activeElement).toBe(summary);
});
test.each(["teacher", "student", "guardian"])(
  "every baseline identity can reach students and the editable gradebook (%s)",
  async (role) => {
    if (session) session.user.role = role;
    await render("/gradebook/grade-sam-1");
    expect(host.querySelector('textarea[name="internalNote"]')).not.toBeNull();
    expect(host.querySelector('a[href="/students"]')).not.toBeNull();
    expect(button("Publish grade").disabled).toBe(false);
  },
);
test("student profiles and result views have distinct navigation and field groups", async () => {
  await render("/students/sam");
  expect(host.textContent).toContain("Course enrollment");
  expect(host.textContent).toContain("STU-1001");
  expect(
    host.querySelector('a[href="/students/sam/results/guardian"]'),
  ).not.toBeNull();
  expect(host.textContent).not.toContain("Check reasoning privately.");
});
test("guardian result pages render the smaller response without teacher or student-only values", async () => {
  await render("/students/sam/results/guardian/grade-sam-1");
  expect(host.textContent).toContain("Quiz 1");
  expect(host.textContent).not.toContain("Check reasoning privately.");
  expect(host.textContent).not.toContain("Clear working.");
  expect(host.textContent).not.toContain("85");
  expect(host.querySelector("textarea")).toBeNull();
});
test("editing retains focus and requires saving before publication", async () => {
  await render("/gradebook/grade-sam-1");
  const field = host.querySelector<HTMLInputElement>('input[name="score"]');
  field?.focus();
  await input("88");
  expect(document.activeElement).toBe(field);
  expect(button("Save draft").disabled).toBe(false);
  expect(button("Publish grade").disabled).toBe(true);
  expect(host.textContent).toContain("Unsaved changes");
});
test("a failed save preserves typed values for recovery", async () => {
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? Promise.resolve(
            reply(
              {
                error: "INTERNAL_ERROR",
                message: "The server could not save this change.",
              },
              500,
            ),
          )
        : original(path, init),
    ),
  );
  await render("/gradebook/grade-sam-1");
  await input("88");
  await settle(() => button("Save draft").click());
  expect(
    host.querySelector<HTMLInputElement>('input[name="score"]')?.value,
  ).toBe("88");
  expect(host.textContent).toContain("The server could not save");
});
test.each(["session", "save", "publish"])(
  "a network failure during %s keeps the editor without revalidating its loaders",
  async (phase) => {
    await render("/gradebook/grade-sam-1");
    if (phase !== "publish") await input("88");
    const original = globalThis.fetch;
    const offline = vi.fn(async (path: string, init?: RequestInit) => {
      if (phase !== "session" && path === "/api/session")
        return original(path, init);
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", offline);
    await settle(() =>
      button(phase === "publish" ? "Publish grade" : "Save draft").click(),
    );
    expect(
      host.querySelector<HTMLInputElement>('input[name="score"]')?.value,
    ).toBe(phase === "publish" ? "85" : "88");
    expect(host.textContent).toContain("Could not confirm the change");
    expect(host.textContent).not.toContain("Record unavailable");
    expect(host.querySelector(".notice")).toBeNull();
    expect(button("Save draft").disabled).toBe(true);
    expect(button("Publish grade").disabled).toBe(true);
    expect(offline.mock.calls.map(([path]) => path)).toEqual(
      phase === "session"
        ? ["/api/session"]
        : [
            "/api/session",
            phase === "save"
              ? "/api/grades/grade-sam-1"
              : "/api/grades/grade-sam-1/publish",
          ],
    );
  },
);
test("a lost response does not claim failure or retry a committed save", async () => {
  await render("/gradebook/grade-sam-1");
  await input("88");
  const original = globalThis.fetch;
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    const response = await original(path, init);
    if (init?.method === "PATCH")
      throw new TypeError("response lost after commit");
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  await settle(() => button("Save draft").click());
  expect(teacher.grade.version).toBe(2);
  expect(
    host.querySelector<HTMLInputElement>('input[name="score"]')?.value,
  ).toBe("88");
  expect(host.textContent).toContain(
    "Reload the grade to check its current state",
  );
  expect(host.textContent).not.toContain("Draft saved.");
  expect(button("Save draft").disabled).toBe(true);
  expect(
    fetch.mock.calls.filter(([, init]) => init?.method === "PATCH"),
  ).toHaveLength(1);
  const reload = [...host.querySelectorAll("a")].find(
    (link) => link.textContent === "Reload the current grade",
  );
  expect(reload?.getAttribute("href")).toBe("/gradebook/grade-sam-1");
  const beforeUnload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(beforeUnload);
  expect(beforeUnload.defaultPrevented).toBe(true);
  expect(
    host.querySelector<HTMLInputElement>('input[name="score"]')?.value,
  ).toBe("88");
});
test("saving updates the version and publication returns immutable teacher detail", async () => {
  await render("/gradebook/grade-sam-1");
  await input("88");
  await settle(() => button("Save draft").click());
  expect(button("Save draft").disabled).toBe(true);
  expect(button("Publish grade").disabled).toBe(false);
  expect(host.textContent).toContain("Draft saved.");
  await settle(() => button("Publish grade").click());
  expect(window.confirm).toHaveBeenCalledWith(
    "Publish this grade? Published grades cannot be edited.",
  );
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).toContain("Check reasoning privately.");
  expect(host.textContent).toContain("Published result");
});
test("a denied refresh removes previously displayed private values", async () => {
  await render("/gradebook/grade-sam-1");
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) =>
      path.startsWith("/api/grades/teacher/")
        ? Promise.resolve(
            reply({ error: "NOT_FOUND", message: "Grade unavailable." }, 404),
          )
        : original(path, init),
    ),
  );
  await settle(() => router?.revalidate());
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).not.toContain("Check reasoning privately.");
  expect(host.textContent).toContain("Grade unavailable.");
});
test("logout clears the editor before a delayed response can return", async () => {
  let release: ((value: Response) => void) | undefined;
  const original = globalThis.fetch;
  await render("/gradebook/grade-sam-1");
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) =>
      path === "/auth/logout"
        ? new Promise<Response>((done) => {
            release = done;
          })
        : original(path, init),
    ),
  );
  await settle(() => {
    void router?.navigate("/sign-out", {
      formMethod: "post",
      formData: new FormData(),
    });
  });
  expect(host.querySelector("textarea")).toBeNull();
  await settle(() => {
    session = null;
    release?.(new Response(null, { status: 204 }));
  });
  expect(host.textContent).toContain("Choose a tutorial identity");
});
test("session expiry clears private content without another request", async () => {
  vi.useFakeTimers();
  await act(async () => {
    router = createMemoryRouter(routes, {
      initialEntries: ["/gradebook/grade-sam-1"],
    });
    root.render(<App router={router} />);
    await vi.advanceTimersByTimeAsync(20);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60001);
  });
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).toContain("Your session ended");
});

test("unsaved navigation keeps the draft when discard is declined", async () => {
  await render("/gradebook/grade-sam-1");
  await input("88");
  vi.mocked(window.confirm).mockReturnValue(false);
  await settle(() => {
    void router?.navigate("/students");
  });
  expect(router?.state.location.pathname).toBe("/gradebook/grade-sam-1");
  expect(
    host.querySelector<HTMLInputElement>('input[name="score"]')?.value,
  ).toBe("88");
  expect(window.confirm).toHaveBeenCalledWith(
    "Discard your unsaved grade changes?",
  );
});
test("a late teacher response cannot restore private data after logout", async () => {
  let release: ((value: Response) => void) | undefined;
  const original = globalThis.fetch;
  await render("/students");
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) =>
      path.startsWith("/api/grades/teacher/")
        ? new Promise<Response>((done) => {
            release = done;
          })
        : original(path, init),
    ),
  );
  await settle(() => {
    void router?.navigate("/gradebook/grade-sam-1");
  });
  await settle(() => {
    void router?.navigate("/sign-out", {
      formMethod: "post",
      formData: new FormData(),
    });
  });
  await settle(() => release?.(reply(teacher)));
  expect(host.textContent).toContain("Choose a tutorial identity");
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).not.toContain("Check reasoning privately.");
});
