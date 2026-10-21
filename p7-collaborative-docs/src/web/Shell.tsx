import { useEffect, useRef } from "react";
import { tutorialUsers } from "../shared/catalog.ts";
import type { Session } from "../shared/types.ts";
import cedarlingMark from "./assets/cedarling-mark.png";
import cedarlingWordmark from "./assets/cedarling-wordmark-dark.webp";

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("");
}

export function BrandRail({
  session,
  signOut,
}: Readonly<{ session?: Session; signOut?: () => void }>) {
  const accountRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      const menu = accountRef.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        menu.open = false;
        menu.querySelector("summary")?.focus();
      } else if (event.target instanceof Node && !menu.contains(event.target))
        menu.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);
  return (
    <header className="brand-rail">
      <picture className="brand-lockup">
        <source
          media="(max-width: 760px), (max-height: 500px) and (orientation: landscape)"
          srcSet={cedarlingMark}
        />
        <img src={cedarlingWordmark} alt="Cedarling" />
      </picture>
      <div className="topbar-copy">
        <h1>P7 - Securing Real-Time Collaborative Documents with Cedarling</h1>
        <p>Authorize document, comment, sharing, and live-update boundaries.</p>
      </div>
      {session ? (
        <details ref={accountRef} className="account-menu">
          <summary
            className="rail-identity"
            aria-label={`Open account menu for ${session.user.name}`}
          >
            <span className="identity-avatar" aria-hidden="true">
              {initials(session.user.name)}
            </span>
            <span className="identity-copy">
              <strong>{session.user.name}</strong>
              <small>Collaborator</small>
            </span>
          </summary>
          <div className="account-menu-items">
            <button type="button" onClick={signOut}>
              Change account
            </button>
            <button type="button" onClick={signOut}>
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

export function Footer() {
  return (
    <footer>
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

export function Login({ expired = false }: Readonly<{ expired?: boolean }>) {
  const profiles: Record<string, string> = {
    maya: "Document owner",
    noah: "Document editor",
    lena: "Comment-only collaborator",
  };
  return (
    <div className="app-shell">
      <BrandRail />
      <main className="login-main">
        <section className="login-panel" aria-labelledby="login-title">
          <h2 id="login-title">Sign in to your workspace</h2>
          {expired && (
            <p className="notice error" role="alert">
              Session expired. Choose an identity again.
            </p>
          )}
          <nav className="account-choices" aria-label="Tutorial identities">
            {tutorialUsers.map((user) => (
              <a
                key={user.id}
                href={`/auth/login?login_hint=${user.subject}`}
                className="account-choice"
              >
                <span className="account-avatar" aria-hidden="true">
                  {initials(user.name)}
                </span>
                <span>
                  <strong>{user.name}</strong>
                  <small>{profiles[user.subject]}</small>
                </span>
                <span aria-hidden="true">→</span>
              </a>
            ))}
          </nav>
        </section>
      </main>
      <Footer />
    </div>
  );
}
