import { ArrowRight, WarningCircle } from "./icons.tsx";
import cedarlingMark from "./assets/cedarling-mark.png";
import cedarlingWordmark from "./assets/cedarling-wordmark-dark.webp";

interface TutorialAccount {
  readonly id: string;
  readonly initials: string;
  readonly name: string;
  readonly context: string;
}

interface Identity {
  readonly initials: string;
  readonly name: string;
  readonly detail: string;
}

export function BrandRail({
  title,
  subtitle,
  identity,
  onSwitchAccount,
}: Readonly<{
  title: string;
  subtitle: string;
  identity?: Identity;
  onSwitchAccount?: () => void;
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
      {identity ? (
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
            <button type="button" onClick={onSwitchAccount}>
              Change account
            </button>
            <button type="button" onClick={onSwitchAccount}>
              Sign out
            </button>
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

export function LoginShell({
  title,
  subtitle,
  accounts,
}: Readonly<{
  title: string;
  subtitle: string;
  accounts: readonly TutorialAccount[];
}>) {
  return (
    <div className="login-shell">
      <BrandRail title={title} subtitle={subtitle} />
      <main className="landing">
        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-heading">
            <h2 id="login-title">Choose a tutorial identity</h2>
          </div>
          <nav className="account-choices" aria-label="Tutorial identities">
            {accounts.map((account) => (
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
                <ArrowRight aria-hidden="true" size={20} weight="bold" />
              </a>
            ))}
          </nav>
        </section>
      </main>
      <ProgramFooter />
    </div>
  );
}

export function LoadingShell({
  title,
  subtitle,
}: Readonly<{ title: string; subtitle: string }>) {
  return (
    <div className="login-shell">
      <BrandRail title={title} subtitle={subtitle} />
      <main className="landing">
        <section className="service-state" role="status">
          <WarningCircle aria-hidden="true" size={28} />
          <p>Loading current session…</p>
        </section>
      </main>
      <ProgramFooter />
    </div>
  );
}
