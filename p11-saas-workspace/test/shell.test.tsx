import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { BrandRail, Login, ProgramFooter } from "../app/components/shell.tsx";

describe("P1 shell contract", () => {
  it("uses the official brand, compact identity chooser, and program footer", () => {
    const html = renderToString(<Login />);

    expect(html).toContain('alt="Cedarling"');
    expect(html).toContain("Choose a tutorial identity");
    expect(html).toContain("/auth/login?login_hint=maya");
    expect(html).toContain("/auth/login?login_hint=imani");
    expect(html).toContain("https://cedarling.dev");
    expect(html).toContain("Cedarling Docs");
    expect(html).toContain("https://gluu.org");
  });

  it("opens resource links in a separate tab without sharing the opener", () => {
    const html = renderToString(<ProgramFooter />);
    const links = [...html.matchAll(/<a\b[^>]*>/gu)].map(([link]) => link);
    expect(links).toHaveLength(5);
    for (const link of links) {
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener noreferrer"');
    }
  });

  it("provides separate change-account and sign-out actions", () => {
    const router = createMemoryRouter([
      {
        path: "*",
        element: (
          <BrandRail
            csrfToken="test-csrf"
            identity={{ initials: "MA", name: "Maya", detail: "Aster" }}
          />
        ),
      },
    ]);
    const rail = renderToString(<RouterProvider router={router} />);

    expect(rail).toContain('aria-label="Open account menu"');
    expect(rail).toContain("Change account");
    expect(rail).toContain("Sign out");
    expect(rail.match(/action="\/auth\/logout"/gu)).toHaveLength(2);
    expect(rail).toContain('name="_csrf"');
  });
});
