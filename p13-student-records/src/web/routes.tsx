import {
  type ActionFunctionArgs,
  createBrowserRouter,
  data,
  type LoaderFunctionArgs,
  type RouteObject,
  redirect,
} from "react-router";
import type {
  GradeFilter,
  GradeView,
  SessionView,
  StudentProfile,
} from "../shared/contracts.ts";
import { ApiError, api, request } from "./api.ts";
import {
  Editor,
  type GradeActionData,
  Gradebook,
  RecordError,
  Result,
  Results,
} from "./pages/Grades.tsx";
import { Home, Loading, NotFound, Root, RootError } from "./pages/Root.tsx";
import { Overview, Student, Students } from "./pages/Students.tsx";

async function gradeAction({ request: incoming, params }: ActionFunctionArgs) {
  try {
    const current = await api.session(incoming.signal);
    const form = await incoming.formData();
    const intent = form.get("intent");
    if (intent === "publish")
      return {
        published: await api.publish(
          params.id ?? "",
          Number(form.get("expectedVersion")),
          current.csrfToken,
          incoming.signal,
        ),
      };
    if (intent !== "save")
      return data<GradeActionData>(
        { message: "Choose a valid grade action." },
        { status: 400 },
      );
    return {
      saved: await api.save(
        params.id ?? "",
        {
          expectedVersion: Number(form.get("expectedVersion")),
          score: form.get("score") === "" ? null : Number(form.get("score")),
          feedback: String(form.get("feedback") ?? ""),
          internalNote: String(form.get("internalNote") ?? ""),
        },
        current.csrfToken,
        incoming.signal,
      ),
    };
  } catch (error) {
    if (!(error instanceof ApiError) || [401, 403, 404].includes(error.status))
      throw error;
    return data<GradeActionData>(
      {
        message:
          error.code === "REQUEST_UNCONFIRMED"
            ? "Could not confirm the change. Your entries are kept. Reload the grade to check its current state."
            : error.message,
        code: error.code,
      },
      { status: error.status },
    );
  }
}
function resultsLoader({ params, request: incoming }: LoaderFunctionArgs) {
  const query = new URLSearchParams({ studentId: params.id ?? "" });
  return request<{ grades: GradeView[] }>(
    `/api/grades/${params.audience}?${query}`,
    { signal: incoming.signal },
  );
}
function resultLoader({ params, request: incoming }: LoaderFunctionArgs) {
  return request<GradeView>(
    "/api/grades/" +
      params.audience +
      "/" +
      encodeURIComponent(params.gradeId ?? "") +
      "?studentId=" +
      encodeURIComponent(params.id ?? ""),
    { signal: incoming.signal },
  );
}
export const routes: RouteObject[] = [
  {
    id: "root",
    path: "/",
    element: <Root />,
    errorElement: <RootError />,
    hydrateFallbackElement: <Loading />,
    loader: async ({ request: incoming }) => {
      try {
        return await api.session(incoming.signal);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    children: [
      { index: true, element: <Home /> },
      {
        path: "students",
        loader: ({ request: incoming }) =>
          request("/api/students", { signal: incoming.signal }),
        element: <Students />,
        errorElement: <RecordError />,
      },
      {
        id: "student",
        path: "students/:id",
        loader: ({ request: incoming, params }) =>
          request<StudentProfile>(
            `/api/students/${encodeURIComponent(params.id ?? "")}`,
            { signal: incoming.signal },
          ),
        element: <Student />,
        errorElement: <RecordError />,
        children: [
          { index: true, element: <Overview /> },
          {
            path: "results/:audience",
            loader: (args) => {
              if (!["student", "guardian"].includes(args.params.audience ?? ""))
                throw new ApiError(404, "Result view not found");
              return resultsLoader(args);
            },
            element: <Results />,
            errorElement: <RecordError />,
          },
          {
            path: "results/:audience/:gradeId",
            loader: (args) => {
              if (!["student", "guardian"].includes(args.params.audience ?? ""))
                throw new ApiError(404, "Result view not found");
              return resultLoader(args);
            },
            element: <Result />,
            errorElement: <RecordError />,
          },
        ],
      },
      {
        path: "gradebook",
        loader: ({ request: incoming }) => {
          const params = new URL(incoming.url).searchParams;
          const filter: GradeFilter = {};
          for (const name of ["studentId", "courseId", "state"] as const) {
            const value = params.get(name);
            if (value) Object.assign(filter, { [name]: value });
          }
          return request(`/api/grades/teacher?${new URLSearchParams(filter)}`, {
            signal: incoming.signal,
          });
        },
        element: <Gradebook />,
        errorElement: <RecordError />,
      },
      {
        path: "gradebook/:id",
        loader: ({ request: incoming, params }) =>
          request<GradeView>(
            `/api/grades/teacher/${encodeURIComponent(params.id ?? "")}`,
            { signal: incoming.signal },
          ),
        action: gradeAction,
        element: <Editor />,
        errorElement: <RecordError />,
      },
      {
        path: "sign-out",
        action: async ({ request: incoming }) => {
          let current: SessionView;
          try {
            current = await api.session(incoming.signal);
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) return redirect("/");
            throw e;
          }
          await api.logout(current.csrfToken);
          return redirect("/");
        },
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];
let browserRouter: ReturnType<typeof createBrowserRouter> | undefined;
export function getBrowserRouter() {
  browserRouter ??= createBrowserRouter(routes);
  return browserRouter;
}
