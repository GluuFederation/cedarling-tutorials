import { useContext } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import {
  BrandRail,
  ProgramFooter,
  RouteProgress,
  ServiceError,
  subtitle,
  title,
} from "./components/shell.tsx";
import { DocumentNonceContext, requestServicesContext } from "./context.ts";
import stylesheet from "./styles/styles.css?url";

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

export const meta: Route.MetaFunction = () => [
  { title: `${title} | Cedarling Tutorials` },
  { name: "description", content: subtitle },
];

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const runtime = context.get(requestServicesContext);
  try {
    return {
      session: await runtime.requests.sessionView(
        request,
        params.organizationId,
      ),
    };
  } catch (error) {
    return context.get(requestServicesContext).requests.loaderFailure(error);
  }
}

export function Layout({ children }: { children: React.ReactNode }) {
  const nonce = useContext(DocumentNonceContext);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links nonce={nonce} />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function Root({
  loaderData: { session },
}: Route.ComponentProps) {
  if (!session) return <Outlet />;
  const activeOrganization = session.memberships.find(
    (membership) => membership.organizationId === session.activeOrganizationId,
  );
  return (
    <div className="app-shell">
      <RouteProgress />
      <BrandRail
        csrfToken={session.csrfToken}
        identity={{
          initials: session.user.name.slice(0, 2).toUpperCase(),
          name: session.user.name,
          detail:
            activeOrganization?.organizationName ??
            (session.activeOrganizationId
              ? `${session.activeOrganizationId} · membership unavailable`
              : "No workspace selected"),
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
