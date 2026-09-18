import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { BrandRail, Login } from "../app/components/shell.tsx";

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
    expect(html).not.toContain("synthetic local data");
    expect(html).not.toContain("Permissive teaching");
  });

  it("provides one explicit account exit action", () => {
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
    expect(rail).toContain("Sign out or change account");
    expect(rail).toContain('name="_csrf"');
  });
});
