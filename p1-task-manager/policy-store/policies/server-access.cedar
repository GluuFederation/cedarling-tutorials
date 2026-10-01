// Server policies use validated API-token evidence and trusted database facts.
// Multi-issuer authorization has no principal, so every policy head leaves it
// unconstrained. Each rule binds the token subject to the current user and
// requires the P1 API audience plus the action's scope.
// Scope matches use whole, space-delimited names: alone, first, last, or middle.

// Allow a user to view a same-tenant task they own or are assigned.
@id("server-view-related-task")
permit(
  principal,
  action == Task::Action::"View",
  resource is Task::Task
) when {
  context.boundary == "server" &&
  context has user &&
  context has tokens &&
  context.tokens has p1taskmanager_access_token &&
  context.tokens.p1taskmanager_access_token.hasTag("sub") &&
  context.tokens.p1taskmanager_access_token.getTag("sub").contains(context.user.subject) &&
  context.tokens.p1taskmanager_access_token.hasTag("aud") &&
  context.tokens.p1taskmanager_access_token.getTag("aud").contains("http://localhost:17001/api") &&
  context.tokens.p1taskmanager_access_token has scope &&
  (context.tokens.p1taskmanager_access_token.scope == "task.view" ||
    context.tokens.p1taskmanager_access_token.scope like "task.view *" ||
    context.tokens.p1taskmanager_access_token.scope like "* task.view" ||
    context.tokens.p1taskmanager_access_token.scope like "* task.view *") &&
  context.user.tenant_id == resource.tenant_id &&
  (context.user.id == resource.owner_id ||
    (resource has assignee_id && context.user.id == resource.assignee_id))
};

// Allow an assured owner to create a task inside their tenant.
@id("server-owner-create-task")
permit(
  principal,
  action == Task::Action::"Create",
  resource is Task::Tenant
) when {
  context.boundary == "server" &&
  context has user &&
  context has tokens &&
  context.tokens has p1taskmanager_access_token &&
  context.tokens.p1taskmanager_access_token.hasTag("sub") &&
  context.tokens.p1taskmanager_access_token.getTag("sub").contains(context.user.subject) &&
  context.tokens.p1taskmanager_access_token.hasTag("aud") &&
  context.tokens.p1taskmanager_access_token.getTag("aud").contains("http://localhost:17001/api") &&
  context.tokens.p1taskmanager_access_token has scope &&
  (context.tokens.p1taskmanager_access_token.scope == "task.create" ||
    context.tokens.p1taskmanager_access_token.scope like "task.create *" ||
    context.tokens.p1taskmanager_access_token.scope like "* task.create" ||
    context.tokens.p1taskmanager_access_token.scope like "* task.create *") &&
  context.user.tenant_id == resource.tenant_id &&
  context.user.role == "owner" &&
  context.user.assurance_level >= 2
};

// Allow a user to edit a same-tenant task they own or are assigned.
@id("server-edit-related-task")
permit(
  principal,
  action == Task::Action::"Edit",
  resource is Task::Task
) when {
  context.boundary == "server" &&
  context has user &&
  context has tokens &&
  context.tokens has p1taskmanager_access_token &&
  context.tokens.p1taskmanager_access_token.hasTag("sub") &&
  context.tokens.p1taskmanager_access_token.getTag("sub").contains(context.user.subject) &&
  context.tokens.p1taskmanager_access_token.hasTag("aud") &&
  context.tokens.p1taskmanager_access_token.getTag("aud").contains("http://localhost:17001/api") &&
  context.tokens.p1taskmanager_access_token has scope &&
  (context.tokens.p1taskmanager_access_token.scope == "task.edit" ||
    context.tokens.p1taskmanager_access_token.scope like "task.edit *" ||
    context.tokens.p1taskmanager_access_token.scope like "* task.edit" ||
    context.tokens.p1taskmanager_access_token.scope like "* task.edit *") &&
  context.user.tenant_id == resource.tenant_id &&
  (context.user.id == resource.owner_id ||
    (resource has assignee_id && context.user.id == resource.assignee_id))
};

// Allow an assured owner to assign their task to a user in the same tenant.
@id("server-owner-assign-task")
permit(
  principal,
  action == Task::Action::"Assign",
  resource is Task::Task
) when {
  context.boundary == "server" &&
  context has user &&
  context has requested_assignee_tenant_id &&
  context has tokens &&
  context.tokens has p1taskmanager_access_token &&
  context.tokens.p1taskmanager_access_token.hasTag("sub") &&
  context.tokens.p1taskmanager_access_token.getTag("sub").contains(context.user.subject) &&
  context.tokens.p1taskmanager_access_token.hasTag("aud") &&
  context.tokens.p1taskmanager_access_token.getTag("aud").contains("http://localhost:17001/api") &&
  context.tokens.p1taskmanager_access_token has scope &&
  (context.tokens.p1taskmanager_access_token.scope == "task.assign" ||
    context.tokens.p1taskmanager_access_token.scope like "task.assign *" ||
    context.tokens.p1taskmanager_access_token.scope like "* task.assign" ||
    context.tokens.p1taskmanager_access_token.scope like "* task.assign *") &&
  context.user.tenant_id == resource.tenant_id &&
  context.requested_assignee_tenant_id == resource.tenant_id &&
  context.user.id == resource.owner_id &&
  context.user.role == "owner" &&
  context.user.assurance_level >= 2
};

// Allow an assured owner to complete related work in their tenant.
@id("server-owner-complete-related-task")
permit(
  principal,
  action == Task::Action::"Complete",
  resource is Task::Task
) when {
  context.boundary == "server" &&
  context has user &&
  context has tokens &&
  context.tokens has p1taskmanager_access_token &&
  context.tokens.p1taskmanager_access_token.hasTag("sub") &&
  context.tokens.p1taskmanager_access_token.getTag("sub").contains(context.user.subject) &&
  context.tokens.p1taskmanager_access_token.hasTag("aud") &&
  context.tokens.p1taskmanager_access_token.getTag("aud").contains("http://localhost:17001/api") &&
  context.tokens.p1taskmanager_access_token has scope &&
  (context.tokens.p1taskmanager_access_token.scope == "task.complete" ||
    context.tokens.p1taskmanager_access_token.scope like "task.complete *" ||
    context.tokens.p1taskmanager_access_token.scope like "* task.complete" ||
    context.tokens.p1taskmanager_access_token.scope like "* task.complete *") &&
  context.user.tenant_id == resource.tenant_id &&
  context.user.role == "owner" &&
  context.user.assurance_level >= 2 &&
  (context.user.id == resource.owner_id ||
    (resource has assignee_id && context.user.id == resource.assignee_id))
};

// Allow an assured owner to delete a task they own in their tenant.
@id("server-owner-delete-task")
permit(
  principal,
  action == Task::Action::"Delete",
  resource is Task::Task
) when {
  context.boundary == "server" &&
  context has user &&
  context has tokens &&
  context.tokens has p1taskmanager_access_token &&
  context.tokens.p1taskmanager_access_token.hasTag("sub") &&
  context.tokens.p1taskmanager_access_token.getTag("sub").contains(context.user.subject) &&
  context.tokens.p1taskmanager_access_token.hasTag("aud") &&
  context.tokens.p1taskmanager_access_token.getTag("aud").contains("http://localhost:17001/api") &&
  context.tokens.p1taskmanager_access_token has scope &&
  (context.tokens.p1taskmanager_access_token.scope == "task.delete" ||
    context.tokens.p1taskmanager_access_token.scope like "task.delete *" ||
    context.tokens.p1taskmanager_access_token.scope like "* task.delete" ||
    context.tokens.p1taskmanager_access_token.scope like "* task.delete *") &&
  context.user.tenant_id == resource.tenant_id &&
  context.user.id == resource.owner_id &&
  context.user.role == "owner" &&
  context.user.assurance_level >= 2
};
