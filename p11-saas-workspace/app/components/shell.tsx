import { Form, Link } from "react-router";
import cedarlingMark from "../../src/web/assets/cedarling-mark.png";
import cedarlingWordmark from "../../src/web/assets/cedarling-wordmark-dark.webp";
import { ArrowRight, WarningCircle } from "../../src/web/icons.tsx";

export const title =
  "P11 - Securing Active-Tenant Switching in a SaaS Workspace with Cedarling";
export const subtitle =
  "Resolve authority again when the organization changes.";

export const personas = [
  {
    id: "maya",
    initials: "MA",
    name: "Maya",
    context: "Aster admin · Boreal viewer",
  },
  { id: "noah", initials: "NO", name: "Noah", context: "Project editor" },
  { id: "lena", initials: "LE", name: "Lena", context: "Pending invite" },
  { id: "imani", initials: "IM", name: "Imani", context: "Support agent" },
] as const;

export function BrandRail({
  identity,
  csrfToken,
}: Readonly<{
  identity?: { initials: string; name: string; detail: string };
  csrfToken?: string;
}>) {
  return (
    <header className="brand-rail">
      <picture className="brand-lockup">
        <source media="(max-width: 760px)" srcSet={cedarlingMark} />
        <img src={cedarlingWordmark} alt="Cedarling" />
      </picture>
      <div className="topbar-copy">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {identity && csrfToken ? (
        <details className="account-menu">
          <summary className="rail-identity" aria-label="Open account menu">
            <span className="identity-avatar" aria-hidden="true">
              {identity.initials}
            </span>
            <span className="identity-copy">
              <strong>{identity.name}</strong>
              <small>{identity.detail}</small>
            </span>
          </summary>
          <div className="account-menu-items">
            <Form action="/auth/logout" method="post">
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button className="account-menu-action" type="submit">
                Sign out or change account
              </button>
            </Form>
          </div>
        </details>
      ) : (
        <span aria-hidden="true" />
      )}
    </header>
  );
}

export function ProgramFooter() {
  return (
    <footer className="program-footer">
      <nav aria-label="Related resources">
        <a href="https://cedarling.dev">Cedarling.dev</a>
        <a href="https://docs.jans.io/stable/cedarling/">Cedarling Docs</a>
        <a href="https://gluu.org/agama-lab/">Agama Lab</a>
        <a href="https://docs.jans.io/stable/cedarling/reference/cedarling-lock-server/">
          Lock Server
        </a>
        <a href="https://gluu.org">Gluu</a>
      </nav>
    </footer>
  );
}

export function Login() {
  return (
    <div className="login-shell">
      <BrandRail />
      <main className="landing">
        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-heading">
            <h2 id="login-title">Choose a tutorial identity</h2>
            <p>Compare the same workspace across four identities.</p>
          </div>
          <nav className="account-choices" aria-label="Tutorial identities">
            {personas.map((account) => (
              <a
                className="account-choice"
                href={`/auth/login?login_hint=${account.id}`}
                key={account.id}
              >
                <span className="account-avatar" aria-hidden="true">
                  {account.initials}
                </span>
                <span className="account-copy">
                  <strong>{account.name}</strong>
                  <small>{account.context}</small>
                </span>
                <ArrowRight size={20} weight="bold" />
              </a>
            ))}
          </nav>
        </section>
      </main>
      <ProgramFooter />
    </div>
  );
}

export function ServiceError({ message }: { message: string }) {
  return (
    <section className="service-state" role="alert">
      <WarningCircle size={28} />
      <h2>Workspace unavailable</h2>
      <p>{message}</p>
      <Link to="/">Return safely</Link>
    </section>
  );
}

export function Outcome({ children }: { children: React.ReactNode }) {
  return (
    <div className="outcome" role="status" aria-live="polite">
      {children}
    </div>
  );
}
