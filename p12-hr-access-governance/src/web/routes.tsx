import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type RouteObject,
  redirect,
} from "react-router";
import type {
  AccessOptions,
  Contact,
  Grant,
  GrantOperation,
  Medical,
  Profile,
  SessionView,
} from "../shared/contracts.ts";
import { ApiError, api, mutate } from "./api.ts";
import { FieldError } from "./components/Feedback.tsx";
import {
  ContactFields,
  Employee,
  Employees,
  MedicalFields,
  ProfileFields,
} from "./pages/Employees.tsx";
import { NewRequest, RequestDetails, Requests } from "./pages/Requests.tsx";
import { Home, Loading, NotFound, Root, RootError } from "./pages/Root.tsx";

async function get<T>(path: string, request: Request) {
  return (await api<T>(path, { signal: request.signal })).data;
}
async function session(request: Request) {
  const value = await get<SessionView | null>("/api/session", request);
  if (!value)
    throw new ApiError(401, "SESSION_EXPIRED", "Sign in to continue.");
  return value;
}
function view(request: Request) {
  return new URL(request.url).searchParams.get("view") === "requests"
    ? "requests"
    : "review";
}
export async function createRequest({ request }: ActionFunctionArgs) {
  const current = await session(request);
  const data = await request.formData();
  const packageId = String(data.get("packageId"));
  const employeeId = String(data.get("employeeId"));
  const beneficiaryId = data.get("beneficiaryId");
  try {
    const result = await mutate<Grant>(
      "/api/grants",
      current.csrfToken,
      {
        employeeId,
        packageId,
        days: Number(data.get("days")),
        reason: String(data.get("reason") ?? ""),
        ...(beneficiaryId ? { beneficiaryId: String(beneficiaryId) } : {}),
      },
      request.signal,
    );
    return redirect(`/access-requests/${result.data.id}?result=created`);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status === 401) throw error;
    if (error.code === "ACTIVE_GRANT_EXISTS") {
      const grants = await get<Grant[]>(
        "/api/grants?view=requests&employeeId=" +
          encodeURIComponent(employeeId),
        request,
      );
      const existing = grants.find(
        (grant) =>
          grant.packageId === packageId &&
          (!beneficiaryId || grant.beneficiaryId === beneficiaryId),
      );
      if (existing)
        return redirect(
          `/access-requests/${existing.id}?view=requests&result=existing`,
        );
    }
    return { message: error.message };
  }
}
export async function reviewRequest({ request, params }: ActionFunctionArgs) {
  const current = await session(request);
  const data = await request.formData();
  const operation = String(data.get("operation")) as GrantOperation;
  if (!["approve", "reject", "revoke"].includes(operation))
    return { message: "Choose a valid review action." };
  try {
    const result = await mutate<Grant>(
      `/api/grants/${encodeURIComponent(params.id ?? "")}/${operation}`,
      current.csrfToken,
      {
        version: Number(data.get("version")),
        ...(operation === "reject"
          ? { note: String(data.get("note") ?? "") }
          : {}),
      },
      request.signal,
    );
    return redirect(
      `/access-requests/${result.data.id}?result=${result.data.status}`,
    );
  } catch (error) {
    if (!(error instanceof ApiError) || error.status === 401) throw error;
    return { message: error.message };
  }
}
export const routes: RouteObject[] = [
  {
    id: "root",
    path: "/",
    loader: ({ request }) => get<SessionView | null>("/api/session", request),
    element: <Root />,
    hydrateFallbackElement: <Loading />,
    errorElement: <RootError />,
    children: [
      { index: true, element: <Home /> },
      {
        path: "employees",
        loader: ({ request }) => get<Profile[]>("/api/employees", request),
        element: <Employees />,
      },
      {
        id: "employee",
        path: "employees/:id",
        loader: ({ request, params }) =>
          get<Profile>(
            "/api/employees/" +
              encodeURIComponent(params.id ?? "") +
              "/profile",
            request,
          ),
        element: <Employee />,
        children: [
          { index: true, element: <ProfileFields /> },
          {
            path: "contact",
            loader: ({ request, params }) =>
              get<Contact>(
                "/api/employees/" +
                  encodeURIComponent(params.id ?? "") +
                  "/contact",
                request,
              ),
            element: <ContactFields />,
            errorElement: <FieldError />,
          },
          {
            path: "medical",
            loader: ({ request, params }) =>
              get<Medical>(
                "/api/employees/" +
                  encodeURIComponent(params.id ?? "") +
                  "/medical",
                request,
              ),
            element: <MedicalFields />,
            errorElement: <FieldError />,
          },
        ],
      },
      {
        path: "access-requests",
        loader: ({ request }) =>
          get<Grant[]>(`/api/grants?view=${view(request)}`, request),
        element: <Requests />,
      },
      {
        path: "access-requests/new",
        loader: async ({ request }: LoaderFunctionArgs) => {
          const [employees, options] = await Promise.all([
            get<Profile[]>("/api/employees", request),
            get<AccessOptions>("/api/access-options", request),
          ]);
          return { employees, options };
        },
        action: createRequest,
        element: <NewRequest />,
      },
      {
        path: "access-requests/:id",
        loader: ({ request, params }) =>
          get<Grant>(
            "/api/grants/" +
              encodeURIComponent(params.id ?? "") +
              "?view=" +
              view(request),
            request,
          ),
        action: reviewRequest,
        element: <RequestDetails />,
      },
      {
        path: "sign-out",
        action: async ({ request }) => {
          const current = await get<SessionView | null>(
            "/api/session",
            request,
          );
          if (current) {
            const response = await fetch("/auth/logout", {
              method: "POST",
              credentials: "same-origin",
              headers: { "X-CSRF-Token": current.csrfToken },
              signal: request.signal,
            });
            if (!response.ok && response.status !== 401)
              throw new ApiError(
                response.status,
                "SIGN_OUT_FAILED",
                "Sign-out could not be confirmed. Reload the workspace and try again.",
              );
          }
          return redirect("/");
        },
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];
