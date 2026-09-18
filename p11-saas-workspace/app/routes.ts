import {
  index,
  layout,
  route,
  type RouteConfig,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  layout("routes/organization.tsx", [
    route("organizations/:organizationId/projects", "routes/projects.tsx"),
    route(
      "organizations/:organizationId/projects/:projectId",
      "routes/project.tsx",
    ),
    route("organizations/:organizationId/billing", "routes/billing.tsx"),
  ]),
  route("organizations/:organizationId/switch", "routes/switch.ts"),
  route(
    "organizations/:organizationId/invitations",
    "routes/issue-invitation.ts",
  ),
  route("invitations", "routes/invitations.tsx"),
  route("invitations/:invitationId/accept", "routes/accept-invitation.ts"),
  route("support", "routes/support.tsx"),
  route("support/:approvalId/open", "routes/open-support.ts"),
  route("auth/login", "routes/auth-login.ts"),
  route("auth/callback", "routes/auth-callback.ts"),
  route("auth/logout", "routes/auth-logout.ts"),
  route("health", "routes/health.ts"),
] satisfies RouteConfig;
