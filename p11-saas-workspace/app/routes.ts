import {
  index,
  layout,
  prefix,
  type RouteConfig,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  layout("routes/workspace/layout.tsx", [
    ...prefix("organizations/:organizationId", [
      route("projects", "routes/organizations/projects.tsx"),
      route("projects/:projectId", "routes/organizations/project.tsx"),
      route("members", "routes/organizations/members.tsx"),
      route("billing", "routes/organizations/billing.tsx"),
    ]),
    route("invitations", "routes/invitations/index.tsx"),
    route("support", "routes/support/index.tsx"),
  ]),
  ...prefix("organizations/:organizationId", [
    route("switch", "routes/organizations/switch.ts"),
    route("invitations", "routes/organizations/issue-invitation.ts"),
  ]),
  route("invitations/:invitationId/accept", "routes/invitations/accept.ts"),
  route("support/:approvalId/open", "routes/support/open.ts"),
  ...prefix("auth", [
    route("login", "routes/auth/login.ts"),
    route("callback", "routes/auth/callback.ts"),
    route("logout", "routes/auth/logout.ts"),
  ]),
  route("health", "routes/system/health.ts"),
] satisfies RouteConfig;
