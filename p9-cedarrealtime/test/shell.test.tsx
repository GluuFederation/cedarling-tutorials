import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandRail, LoadingShell, LoginShell } from "../src/web/shell.tsx";

const accounts = [
  { id: "first", initials: "FI", name: "First", context: "Owner" },
  { id: "second", initials: "SE", name: "Second", context: "Viewer" },
] as const;

describe("P1 shell contract", () => {
  it("uses the official brand, compact identity chooser, and program footer", () => {
    const html = renderToString(
      <LoginShell
        accounts={accounts}
        title="Tutorial workspace"
        subtitle="One focused authorization boundary."
      />,
    );

    expect(html).toContain('alt="Cedarling"');
    expect(html).toContain("Choose a tutorial identity");
    expect(html).toContain("/auth/login?login_hint=first");
    expect(html).toContain("/auth/login?login_hint=second");
    expect(html).toContain("https://cedarling.dev");
    expect(html).toContain("Cedarling Docs");
    expect(html).toContain("https://gluu.org");
    expect(html).not.toContain("synthetic local data");
    expect(html).not.toContain("Permissive teaching");
  });

  it("provides a named account switch and an announced loading state", () => {
    const rail = renderToString(
      <BrandRail
        title="Tutorial workspace"
        subtitle="One focused authorization boundary."
        identity={{ initials: "FI", name: "First", detail: "Owner" }}
        onSwitchAccount={() => undefined}
      />,
    );
    const loading = renderToString(
      <LoadingShell
        title="Tutorial workspace"
        subtitle="One focused authorization boundary."
      />,
    );

    expect(rail).toContain('aria-label="Open account menu"');
    expect(rail).toContain("Change account");
    expect(rail).toContain("Sign out");
    expect(loading).toContain('role="status"');
    expect(loading).toContain("Loading current session");
  });
});
