import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { Login } from "../components/shell.tsx";
import { sessionView } from "../server.ts";

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await sessionView(request, context);
  if (!session) return null;
  if (session.user.id === "user-imani") throw redirect("/support");
  if (session.user.id === "user-lena" && session.memberships.length === 0) {
    throw redirect("/invitations");
  }
  throw redirect(
    session.activeOrganizationId
      ? `/organizations/${session.activeOrganizationId}/projects`
      : "/invitations",
  );
}

export default function Home() {
  return <Login />;
}
