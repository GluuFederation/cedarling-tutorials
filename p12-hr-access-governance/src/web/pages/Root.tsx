import { useEffect, useLayoutEffect, useRef } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLoaderData,
  useLocation,
  useNavigation,
  useRouteError,
} from "react-router";
import { accounts, type SessionView } from "../../shared/contracts.ts";
import { ApiError } from "../api.ts";
import { Avatar, Shell } from "../components/Shell.tsx";
import { Icon } from "../Icons.tsx";

export function Login({ message }: { message?: string }) {
  return (
    <main className="landing">
      <section className="login-panel" aria-labelledby="login-title">
        <h2 id="login-title">Choose a tutorial identity</h2>
        {message && <p role="alert">{message}</p>}
        <nav className="account-choices" aria-label="Tutorial identities">
          {accounts.map((account) => (
            <a
              key={account.id}
              className="account-choice"
              href={`/auth/login?login_hint=${account.id}`}
            >
              <Avatar name={account.name} />
              <span>
                <strong>{account.name}</strong>
                <small>{account.role}</small>
              </span>
              <Icon name="forward" />
            </a>
          ))}
        </nav>
      </section>
    </main>
  );
}
export function Root() {
  const session = useLoaderData<SessionView | null>();
  const navigation = useNavigation();
  const { pathname } = useLocation();
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => window.location.replace("/"),
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session]);
  if (!session)
    return (
      <Shell>
        <Login />
      </Shell>
    );
  const signingOut = navigation.formAction === "/sign-out";
  return (
    <Shell session={session}>
      <div className="workspace-shell">
        {signingOut ? (
          <main className="empty-state" role="status">
            Signing out…
          </main>
        ) : (
          <>
            <nav className="primary-nav" aria-label="HR workspace">
              <NavLink to="/employees">Employees</NavLink>
              <NavLink to="/access-requests">Access requests</NavLink>
            </nav>
            <PageContent key={pathname} busy={navigation.state === "loading"} />
          </>
        )}
      </div>
    </Shell>
  );
}
export function Home() {
  return <Navigate to="/employees" replace />;
}
export function RootError() {
  const error = useRouteError();
  const expired = error instanceof ApiError && error.status === 401;
  return (
    <Shell>
      {expired ? (
        <Login message="Your session ended. Choose an identity to sign in again." />
      ) : (
        <main className="empty-state">
          <h2>The workspace could not be loaded</h2>
          <p role="alert">
            {error instanceof ApiError
              ? error.message
              : "Check that P12 is running, then reload the page."}
          </p>
          <Link className="secondary" reloadDocument to="/">
            Reload workspace
          </Link>
        </main>
      )}
    </Shell>
  );
}
export function NotFound() {
  return (
    <section className="empty-state">
      <h2>Page not found</h2>
      <Link to="/employees">Return to employees</Link>
    </section>
  );
}

export function Loading() {
  return (
    <Shell>
      <main className="empty-state" role="status">
        Loading workspace…
      </main>
    </Shell>
  );
}

function PageContent({ busy }: { busy: boolean }) {
  const content = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    content.current?.querySelector("h2")?.focus();
  }, []);
  return (
    <main ref={content} className="content" aria-busy={busy || undefined}>
      <Outlet />
    </main>
  );
}
