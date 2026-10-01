// Every permit requires signed P3 API evidence matching the server's caller.
// The MCP authentication middleware checks the coarse mcp.access OAuth scope.
@id("require-p3-access-token")
forbid(principal, action, resource) unless {
  context has tokens &&
  context.tokens has p3incidentassistant_access_token &&
  context.tokens.p3incidentassistant_access_token.hasTag("sub") &&
  context.tokens.p3incidentassistant_access_token.getTag("sub").contains(context.caller.subject) &&
  context.tokens.p3incidentassistant_access_token.hasTag("aud") &&
  context.tokens.p3incidentassistant_access_token.getTag("aud").contains("http://localhost:17003/mcp") &&
  context.tokens.p3incidentassistant_access_token.hasTag("client_id") &&
  context.tokens.p3incidentassistant_access_token.getTag("client_id").contains("p3-mcp-capability-governance-cli")
};

// Operations staff can discover the surface, begin a search, and read guidance.
@id("operations-surface")
permit(principal, action in [
  P3IncidentAssistant::Action::"Discover",
  P3IncidentAssistant::Action::"Search",
  P3IncidentAssistant::Action::"ReadRunbook"
], resource) when {
  ["supervisor", "analyst"].contains(context.caller.role)
};

// Supervisors cover all incidents; analysts cover only their assignments.
@id("incident-assignment")
permit(principal, action in [
  P3IncidentAssistant::Action::"Read",
  P3IncidentAssistant::Action::"UpdateStatus",
  P3IncidentAssistant::Action::"Triage"
], resource is P3IncidentAssistant::Incident) when {
  context.caller.role == "supervisor" ||
  (context.caller.role == "analyst" && resource has assigned_to &&
    resource.assigned_to == context.caller.subject)
};
