import Image from "next/image";
import Link from "next/link";
import { personas } from "@/src/shared/personas.ts";
import cedarlingMark from "@/src/web/assets/cedarling-mark.png";
import cedarlingWordmark from "@/src/web/assets/cedarling-wordmark-dark.webp";
import { ArrowRight, Warning } from "@/src/web/icons.tsx";

export const title = "P4 - Securing Editorial Publishing with Cedarling";
export const subtitle = "Bind approval to exact content and current authority.";

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
        <source media="(max-width: 760px)" srcSet={cedarlingMark.src} />
        <Image src={cedarlingWordmark} alt="Cedarling" priority />
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
            <form action="/auth/logout" method="post">
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button type="submit">Sign out or change account</button>
            </form>
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

export function Login({ expired = false }: Readonly<{ expired?: boolean }>) {
  return (
    <main className="landing">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-heading">
          <h2 id="login-title">Choose a tutorial identity</h2>
          <p>Compare the same editorial workflow across three identities.</p>
        </div>
        {expired ? (
          <p className="outcome error" role="alert">
            Session expired. Choose an identity again.
          </p>
        ) : null}
        <nav className="account-choices" aria-label="Tutorial identities">
          {personas.map((persona) => (
            <a
              className="account-choice"
              href={`/auth/login?login_hint=${persona.id}`}
              key={persona.id}
            >
              <span className="account-avatar" aria-hidden="true">
                {persona.initials}
              </span>
              <span className="account-copy">
                <strong>{persona.name}</strong>
                <small>{persona.context}</small>
              </span>
              <ArrowRight size={20} />
            </a>
          ))}
        </nav>
      </section>
    </main>
  );
}

export function EmptyQueue() {
  return (
    <main className="landing">
      <section className="service-state" role="status">
        <h2>No articles available</h2>
        <p>This identity has no readable editorial work.</p>
      </section>
    </main>
  );
}

export function ServiceError({ message }: Readonly<{ message: string }>) {
  return (
    <section className="service-state" role="alert">
      <Warning size={28} />
      <h2>Editorial workspace unavailable</h2>
      <p>{message}</p>
      <Link href="/">Return safely</Link>
    </section>
  );
}
