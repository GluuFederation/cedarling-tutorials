import { type ReactNode, useEffect, useRef } from "react";
import { Form } from "react-router";
import type { SessionView } from "../../shared/contracts.ts";
import mark from "../assets/cedarling-mark.png";
import wordmark from "../assets/cedarling-wordmark-dark.webp";

export function Avatar({
  name,
  large = false,
}: {
  name: string;
  large?: boolean;
}) {
  const initials = name
    .replace(/^Dr\.\s*/u, "")
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return (
    <span
      className={`avatar${large ? " avatar-large" : ""}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
export function Shell({
  children,
  session,
}: {
  children: ReactNode;
  session?: SessionView | null;
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
    <div className="app-shell">
      <header className="brand-rail">
        <picture className="brand-lockup">
          <source media="(max-width:760px)" srcSet={mark} />
          <img src={wordmark} alt="Cedarling" />
        </picture>
        <div className="topbar-copy">
          <h1>
            P13 - Protecting Grade Publication and Guardian Access with
            Cedarling
          </h1>
          <p>Prepare grades and publish results.</p>
        </div>
        {session ? (
          <details className="account-menu" ref={menu}>
            <summary aria-label="Open account menu">
              <Avatar name={session.user.name} />
              <span className="identity-copy">
                <strong>{session.user.name}</strong>
                <small>
                  {session.user.role[0]?.toUpperCase() +
                    session.user.role.slice(1)}
                </small>
              </span>
            </summary>
            <div className="account-menu-items">
              <Form method="post" action="/sign-out">
                <button name="intent" value="change" type="submit">
                  Change account
                </button>
                <button name="intent" value="logout" type="submit">
                  Sign out
                </button>
              </Form>
            </div>
          </details>
        ) : (
          <span />
        )}
      </header>
      {children}
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
    </div>
  );
}
