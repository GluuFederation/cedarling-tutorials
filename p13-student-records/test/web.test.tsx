// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { GradeView } from "../src/shared/contracts.ts";
import { App } from "../src/web/App.tsx";
import { GradeDetail } from "../src/web/GradeDetail.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const element = document.createElement("div");
document.body.append(element);
const root = createRoot(element);
test("editing a score enables Save while the input still has focus", async () => {
  const save = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <GradeDetail
        view={teacherView}
        busy={false}
        onSave={save}
        onPublish={async () => {}}
      />,
    ),
  );
  const score = element.querySelector<HTMLInputElement>('input[type="number"]');
  if (!score) throw new Error("Score input is missing");
  const initial = score.value;
  score.focus();
  expect(button("Save draft").disabled).toBe(true);
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setValue) throw new Error("Native input value setter is missing");
  await act(async () => {
    setValue.call(score, "88");
    score.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: "88",
      }),
    );
  });
  expect(document.activeElement).toBe(score);
  expect(button("Save draft").disabled).toBe(false);
  expect(button("Publish grade").disabled).toBe(true);
  expect(save).not.toHaveBeenCalled();
  await act(async () => {
    setValue.call(score, initial);
    score.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  expect(button("Save draft").disabled).toBe(true);
});
afterEach(async () => {
  await act(async () => root.render(null));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test.each(["login", "workspace"])(
  "project title and subtitle remain visible in the %s shell",
  async (screen) => {
    if (screen === "login") {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({}, { status: 401 })),
      );
    } else {
      fakeFetch(async () => Response.json(teacherView));
    }
    await act(async () => root.render(<App />));
    expect(element.querySelector(".topbar-copy h1")?.textContent).toBe(
      "P13 - Protecting Grade Publication and Guardian Access with Cedarling",
    );
    expect(element.querySelector(".topbar-copy p")?.textContent).toBe(
      "Publish grades and control student and guardian access.",
    );
    expect(element.querySelectorAll("footer nav a")).toHaveLength(5);
    if (screen === "login") {
      expect(
        element.querySelectorAll(".account-choice .account-avatar"),
      ).toHaveLength(3);
      expect(element.querySelector(".login-heading h2")?.textContent).toBe(
        "Choose an identity",
      );
    }
  },
);

test("a late collection cannot restore protected rows after its detail request is denied", async () => {
  let release: ((response: Response) => void) | undefined;
  let refresh = false;
  fakeFetch(async () =>
    refresh ? Response.json({}, { status: 404 }) : Response.json(teacherView),
  );
  const initial = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      if (refresh && path === "/api/grades/teacher")
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return initial(path, init);
    }),
  );
  await act(async () => root.render(<App />));
  await act(async () => button("Algebra").click());
  refresh = true;
  await act(async () => button("Reload grades").click());
  expect(element.textContent).toContain("Grade not found or unavailable");
  await act(async () => {
    release?.(Response.json({ grades: [teacherView] }));
  });
  expect(element.querySelector("textarea")).toBeNull();
  expect(element.textContent).not.toContain("Algebra · Quiz 1");
});

test("session expiry clears protected content without waiting for another request", async () => {
  vi.useFakeTimers();
  fakeFetch(async () => Response.json(teacherView));
  await act(async () => root.render(<App />));
  await act(async () => button("Algebra").click());
  expect(element.querySelector("textarea")).not.toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60001);
  });
  expect(element.querySelector("textarea")).toBeNull();
  expect(element.textContent).toContain("Session expired");
});

test("back navigation restores keyboard focus to the selected row", async () => {
  fakeFetch(async () => Response.json(teacherView));
  await act(async () => root.render(<App />));
  const row = button("Algebra");
  await act(async () => row.click());
  await act(async () => button("Back to grades").click());
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(document.activeElement).toBe(row);
});

test("publication shows its request correlation and reloads immutable teacher detail", async () => {
  let published = false;
  const publishedView = {
    ...teacherView,
    grade: {
      ...teacherView.grade,
      state: "published",
      version: 2,
      publishedAt: "2026-09-10T10:00:00.000Z",
    },
  };
  fakeFetch(async () => Response.json(published ? publishedView : teacherView));
  const initial = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      if (
        path === "/api/grades/grade-sam-1/publish" &&
        init?.method === "POST"
      ) {
        published = true;
        return Promise.resolve(
          Response.json({
            id: teacherView.id,
            state: "published",
            version: 2,
            publishedAt: publishedView.grade.publishedAt,
            requestId: "publication-test",
          }),
        );
      }
      return initial(path, init);
    }),
  );
  await act(async () => root.render(<App />));
  await act(async () => button("Algebra").click());
  await act(async () => button("Publish grade").click());
  expect(element.textContent).toContain("Request: publication-test");
  expect(element.textContent).toContain("Private reasoning.");
  expect(element.querySelector("input,textarea")).toBeNull();
});

test("published teacher detail retains private notes without edit or publish controls", async () => {
  await act(async () =>
    root.render(
      <GradeDetail
        view={{
          id: "grade-sam-1",
          grade: {
            studentId: "sam",
            studentName: "Sam Rivera",
            course: "Algebra",
            assessment: "Quiz 1",
            score: 85,
            feedback: "Clear working.",
            internalNote: "Private reasoning.",
            state: "published",
            version: 2,
            publishedAt: "2026-09-10T10:00:00.000Z",
          },
        }}
        busy={false}
        onSave={async () => {}}
        onPublish={async () => {}}
      />,
    ),
  );
  expect(element.textContent).toContain("Private reasoning.");
  expect(element.textContent).toContain("Published");
  expect(element.querySelector("input,textarea,button")).toBeNull();
});

const teacherView = {
  id: "grade-sam-1",
  grade: {
    studentId: "sam",
    studentName: "Sam Rivera",
    course: "Algebra",
    assessment: "Quiz 1",
    score: 85,
    feedback: "Clear working.",
    internalNote: "Private reasoning.",
    state: "draft",
    version: 1,
    publishedAt: null,
  },
} satisfies GradeView;
function button(label: string): HTMLButtonElement {
  const result = [...element.querySelectorAll("button")].find(
    (item) =>
      item.textContent?.includes(label) ||
      item.getAttribute("aria-label")?.includes(label),
  );
  if (!result) throw new Error(`Button is missing: ${label}`);
  return result;
}
function fakeFetch(read: () => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/session")
        return Response.json({
          user: { id: "talia", name: "Talia", role: "teacher" },
          csrfToken: "test-csrf",
          expiresAt: Date.now() + 60000,
        });
      if (path === "/api/grades/teacher")
        return Response.json({ grades: [teacherView] });
      if (path === "/api/grades/teacher/grade-sam-1") return read();
      if (path === "/auth/logout") return new Response(null, { status: 204 });
      throw new Error("Unexpected test request");
    }),
  );
}

test("a denied refresh removes both protected detail and list entries", async () => {
  let denied = false;
  fakeFetch(async () =>
    denied ? Response.json({}, { status: 404 }) : Response.json(teacherView),
  );
  await act(async () => root.render(<App />));
  await act(async () => button("Algebra").click());
  expect(element.querySelector("textarea")?.value).toBe("Clear working.");
  denied = true;
  await act(async () => button("Reload grades").click());
  expect(element.querySelector("textarea")).toBeNull();
  expect(element.textContent).not.toContain("Algebra · Quiz 1");
  expect(element.textContent).toContain("Grade not found or unavailable");
});

test("an old detail response cannot repopulate protected content after identity switch", async () => {
  let release: ((response: Response) => void) | undefined;
  fakeFetch(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => root.render(<App />));
  await act(async () => button("Algebra").click());
  await act(async () => button("Change account").click());
  expect(element.textContent).toContain("Choose an identity");
  await act(async () => {
    release?.(Response.json(teacherView));
  });
  expect(element.querySelector("textarea")).toBeNull();
  expect(element.textContent).not.toContain("Private reasoning");
});

test("guardian rendering contains neither numeric score nor feedback nor private notes", async () => {
  await act(async () =>
    root.render(
      <GradeDetail
        view={{
          id: "grade-sam-1",
          grade: {
            course: "Algebra",
            assessment: "Quiz 1",
            letterGrade: "B",
            version: 2,
            publishedAt: "2026-09-10T10:00:00.000Z",
          },
        }}
        busy={false}
        onSave={async () => {}}
        onPublish={async () => {}}
      />,
    ),
  );
  expect(element.textContent).toContain("GradeB");
  expect(element.textContent).not.toContain("Score");
  expect(element.textContent).not.toContain("feedback");
  expect(element.textContent).not.toContain("note");
});
