import { Form, Link, useNavigation } from "react-router";
import cedarlingMark from "../assets/cedarling-mark.png";
import cedarlingWordmark from "../assets/cedarling-wordmark-dark.webp";
import { useDisclosure } from "../hooks/use-disclosure.ts";
import { ArrowRight, CheckCircle, WarningCircle } from "./icons.tsx";

export const title =
  "P11 - Securing Active-Tenant Switching in a SaaS Workspace with Cedarling";
export const subtitle = "Check current access when switching organizations.";

const personas = [
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
  const menuRef = useDisclosure();
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
        <details className="account-menu" ref={menuRef}>
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
            <div className="account-menu-header">
              <span className="identity-avatar" aria-hidden="true">
                {identity.initials}
              </span>
              <span className="identity-copy">
                <strong>{identity.name}</strong>
                <small>{identity.detail}</small>
              </span>
            </div>
            <Form action="/auth/logout" method="post">
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button className="account-menu-action" type="submit">
                Change account
              </button>
            </Form>
            <Form action="/auth/logout" method="post">
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button className="account-menu-action" type="submit">
                Sign out
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
        <a
          href="https://cedarling.dev"
          target="_blank"
          rel="noopener noreferrer"
        >
          Cedarling.dev
        </a>
        <a
          href="https://docs.jans.io/stable/cedarling/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Cedarling Docs
        </a>
        <a
          href="https://gluu.org/agama-lab/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Agama Lab
        </a>
        <a
          href="https://docs.jans.io/stable/cedarling/reference/cedarling-lock-server/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Lock Server
        </a>
        <a href="https://gluu.org" target="_blank" rel="noopener noreferrer">
          Gluu
        </a>
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
      <Link to="/">Return to workspace</Link>
    </section>
  );
}

type NoticeTone = "info" | "success" | "error";

export function Outcome({
  children,
  tone = "info",
  requestId,
}: Readonly<{
  children: React.ReactNode;
  tone?: NoticeTone;
  requestId?: string | undefined;
}>) {
  return (
    <div className={`outcome ${tone}`} role="status" aria-live="polite">
      <span className="outcome-icon" aria-hidden="true">
        {tone === "success" ? (
          <CheckCircle size={16} />
        ) : tone === "error" ? (
          <WarningCircle size={16} />
        ) : null}
      </span>
      <div className="outcome-copy">
        {children}
        {requestId ? (
          <small className="result-reference">Reference: {requestId}</small>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title: heading,
  children,
}: Readonly<{
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}>) {
  return (
    <div className="empty-state">
      {icon ? (
        <span className="empty-state-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <strong>{heading}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export function RouteProgress() {
  const navigation = useNavigation();
  return (
    <div
      className="route-progress"
      data-active={navigation.state !== "idle"}
      aria-hidden="true"
    />
  );
}
