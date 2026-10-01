// Browser policies use an unsigned, server-projected user and safe resource
// snapshots. Their decisions control presentation only; the server rechecks
// authorization before every protected effect.

// Show a same-tenant task the user owns or is assigned.
@id("browser-view-related-task")
permit(
  principal,
  action == Task::Action::"View",
  resource is Task::Task
) when {
  context.boundary == "browser" &&
  principal is Task::User &&
  principal.tenant_id == resource.tenant_id &&
  (principal.id == resource.owner_id ||
    (resource has assignee_id && principal.id == resource.assignee_id))
};

// Show task creation to an assured owner in the selected tenant.
@id("browser-owner-create-task")
permit(
  principal,
  action == Task::Action::"Create",
  resource is Task::Tenant
) when {
  context.boundary == "browser" &&
  principal is Task::User &&
  principal.tenant_id == resource.tenant_id &&
  principal.role == "owner" &&
  principal.assurance_level >= 2
};

// Show editing for a same-tenant task the user owns or is assigned.
@id("browser-edit-related-task")
permit(
  principal,
  action == Task::Action::"Edit",
  resource is Task::Task
) when {
  context.boundary == "browser" &&
  principal is Task::User &&
  principal.tenant_id == resource.tenant_id &&
  (principal.id == resource.owner_id ||
    (resource has assignee_id && principal.id == resource.assignee_id))
};

// Show assignment when the owner and requested assignee share the task tenant.
@id("browser-owner-assign-task")
permit(
  principal,
  action == Task::Action::"Assign",
  resource is Task::Task
) when {
  context.boundary == "browser" &&
  principal is Task::User &&
  context has requested_assignee_tenant_id &&
  principal.tenant_id == resource.tenant_id &&
  context.requested_assignee_tenant_id == resource.tenant_id &&
  principal.id == resource.owner_id &&
  principal.role == "owner" &&
  principal.assurance_level >= 2
};

// Show completion to an assured owner related to the task.
@id("browser-owner-complete-related-task")
permit(
  principal,
  action == Task::Action::"Complete",
  resource is Task::Task
) when {
  context.boundary == "browser" &&
  principal is Task::User &&
  principal.tenant_id == resource.tenant_id &&
  principal.role == "owner" &&
  principal.assurance_level >= 2 &&
  (principal.id == resource.owner_id ||
    (resource has assignee_id && principal.id == resource.assignee_id))
};

// Show deletion to the assured owner of the task.
@id("browser-owner-delete-task")
permit(
  principal,
  action == Task::Action::"Delete",
  resource is Task::Task
) when {
  context.boundary == "browser" &&
  principal is Task::User &&
  principal.tenant_id == resource.tenant_id &&
  principal.id == resource.owner_id &&
  principal.role == "owner" &&
  principal.assurance_level >= 2
};
