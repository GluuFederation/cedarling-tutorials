import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import type { Route } from "./+types/root";
import { sessionView } from "./server.ts";
import {
  BrandRail,
  ProgramFooter,
  ServiceError,
  subtitle,
  title,
} from "./components/shell.tsx";
import "../src/web/styles.css";

export const meta: Route.MetaFunction = () => [
  { title: `${title} | Cedarling Tutorials` },
  { name: "description", content: subtitle },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  return { session: await sessionView(request, context) };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  const { session } = useLoaderData<typeof loader>();
  if (!session) return <Outlet />;
  return (
    <div className="app-shell">
      <BrandRail
        csrfToken={session.csrfToken}
        identity={{
          initials: session.user.name.slice(0, 2).toUpperCase(),
          name: session.user.name,
          detail: session.activeOrganizationId ?? "No organization",
        }}
      />
      <Outlet />
      <ProgramFooter />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const requestId =
    isRouteErrorResponse(error) &&
    typeof error.data === "object" &&
    error.data !== null &&
    "requestId" in error.data
      ? String(error.data.requestId)
      : undefined;
  const message =
    status === 404
      ? "The requested workspace item was not found."
      : status === 401
        ? "Your session has expired. Sign in again."
        : status === 409
          ? "The workspace changed. Reload and try again."
          : status === 503
            ? "A required authorization or data service is unavailable."
            : "The request could not be completed.";
  return (
    <div className="login-shell">
      <BrandRail />
      <main className="landing">
        <ServiceError
          message={`${message}${requestId ? ` (${requestId})` : ""}`}
        />
      </main>
      <ProgramFooter />
    </div>
  );
}
