import { useEffect, useRef } from "react";
import mark from "./assets/cedarling-mark.png";
import wordmark from "./assets/cedarling-wordmark-dark.webp";

export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {name[0]}
    </span>
  );
}

export function Header({
  user,
  busy,
  onHelp,
  onLogout,
}: {
  user: { name: string } | null | undefined;
  busy: boolean;
  onHelp: () => void;
  onLogout: () => Promise<void>;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function outside(event: MouseEvent) {
      if (!menu.current?.contains(event.target as Node))
        menu.current?.removeAttribute("open");
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);
  return (
    <header className="brand-rail">
      <picture className="brand-lockup">
        <source media="(max-width:760px)" srcSet={mark} />
        <img src={wordmark} alt="Cedarling" />
      </picture>
      <div className="topbar-copy">
        <h1>P14 · Capital District</h1>
        <p>Authorizing turns and property trades with Cedarling</p>
      </div>
      <div className="topbar-tools">
        <button
          type="button"
          className="help-button"
          aria-label="How to play"
          onClick={onHelp}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16v1" />
          </svg>
        </button>
        {user && (
          <details className="account-menu" ref={menu}>
            <summary aria-label="Open account menu">
              <Avatar name={user.name} />
              <span className="identity-copy">
                <strong>{user.name}</strong>
              </span>
            </summary>
            <div className="account-menu-items">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onLogout()}
              >
                Change account
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onLogout()}
              >
                Sign out
              </button>
            </div>
          </details>
        )}
      </div>
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
