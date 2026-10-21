import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
export function Login({ message }: { message?: string | undefined }) {
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
                <small>
                  {account.role[0]?.toUpperCase() + account.role.slice(1)}
                </small>
              </span>
            </a>
          ))}
        </nav>
      </section>
    </main>
  );
}
export function Root() {
  const session = useLoaderData<SessionView | null>();
  const [expired, setExpired] = useState(false);
  const navigation = useNavigation();
  const { pathname } = useLocation();
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session]);
  if (!session || expired || session.expiresAt <= Date.now())
    return (
      <Shell>
        <Login
          message={
            expired
              ? "Your session ended. Choose an identity to sign in again."
              : undefined
          }
        />
      </Shell>
    );
  return (
    <Shell session={session}>
      <div className="workspace-shell">
        {navigation.formAction === "/sign-out" ? (
          <main className="empty-state" role="status">
            Signing out…
          </main>
        ) : (
          <>
            <nav className="primary-nav" aria-label="School workspace">
              <NavLink to="/students">Students</NavLink>
              <NavLink to="/gradebook">Gradebook</NavLink>
            </nav>
            <PageContent key={pathname} busy={navigation.state === "loading"} />
          </>
        )}
      </div>
    </Shell>
  );
}
function PageContent({ busy }: { busy: boolean }) {
  const content = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    content.current?.querySelector("h2")?.focus();
  }, []);
  return (
    <main className="content" ref={content} aria-busy={busy || undefined}>
      <Outlet />
    </main>
  );
}
export function Home() {
  return <Navigate to="/students" replace />;
}
export function RootError() {
  const error = useRouteError();
  return (
    <Shell>
      {error instanceof ApiError && error.status === 401 ? (
        <Login message="Your session ended. Choose an identity to sign in again." />
      ) : (
        <main className="empty-state">
          <h2>The workspace could not be loaded</h2>
          <p role="alert">
            {error instanceof ApiError
              ? error.message
              : "Check that P13 is running, then reload the page."}
          </p>
          <Link reloadDocument to="/">
            Reload workspace
          </Link>
        </main>
      )}
    </Shell>
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
export function NotFound() {
  return (
    <section className="empty-state">
      <h2>Page not found</h2>
      <Link to="/students">Return to students</Link>
    </section>
  );
}
