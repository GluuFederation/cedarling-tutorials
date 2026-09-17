import type { Metadata } from "next";
import { runtime } from "@/src/server/runtime.ts";
import { personaForSubject } from "@/src/shared/personas.ts";
import { BrandRail, ProgramFooter, subtitle, title } from "./components.tsx";
import "./styles.css";

export const metadata: Metadata = {
  title: `${title} | Cedarling Tutorials`,
  description: subtitle,
};
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await (await runtime()).sessions.optional();
  const persona = session
    ? personaForSubject(session.principal.subject)
    : undefined;
  return (
    <html lang="en">
      <body>
        <div className={session ? "app-shell" : "login-shell"}>
          <BrandRail
            csrfToken={session?.csrfToken}
            identity={
              session
                ? {
                    initials:
                      persona?.initials ??
                      session.principal.name.slice(0, 2).toUpperCase(),
                    name: session.principal.name,
                    detail: persona?.context ?? "Editorial user",
                  }
                : undefined
            }
          />
          {children}
          <ProgramFooter />
        </div>
      </body>
    </html>
  );
}
