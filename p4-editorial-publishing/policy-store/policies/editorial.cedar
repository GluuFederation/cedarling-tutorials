// All authenticated tenant members can read that tenant's articles.
@id("read-tenant-article")
permit (
  principal is P4EditorialPublishing::Principal,
  action == P4EditorialPublishing::Action::"ReadArticle",
  resource is P4EditorialPublishing::Article
) when { principal.tenant_id == resource.tenant_id };

// Authorship permits editing and submission; SQLite enforces valid transitions.
@id("author-revision")
permit (
  principal is P4EditorialPublishing::Principal,
  action in [P4EditorialPublishing::Action::"EditRevision", P4EditorialPublishing::Action::"SubmitRevision"],
  resource is P4EditorialPublishing::Revision
) when {
  principal.tenant_id == resource.tenant_id &&
  principal.id == resource.author_id
};

// An editor cannot review their own content, even if they have editor authority.
@id("independent-review")
permit (
  principal is P4EditorialPublishing::Principal,
  action in [P4EditorialPublishing::Action::"ApproveRevision", P4EditorialPublishing::Action::"RejectRevision"],
  resource is P4EditorialPublishing::Revision
) when {
  principal.tenant_id == resource.tenant_id &&
  context.editor_authority_current &&
  principal.id != resource.author_id &&
  resource.state == "submitted"
};

// Publication requires evidence for this exact content and a still-authorized reviewer.
@id("publish-exact-approved-revision")
permit (
  principal is P4EditorialPublishing::Principal,
  action == P4EditorialPublishing::Action::"PublishRevision",
  resource is P4EditorialPublishing::Revision
) when {
  principal.tenant_id == resource.tenant_id &&
  context.publisher_authority_current &&
  resource.state == "approved" &&
  context has approval &&
  context.approval.revision_id == resource.revision_id &&
  context.approval.revision_version == resource.version &&
  context.approval.digest == resource.digest &&
  context.approval.reviewer_id != resource.author_id &&
  context.approval.reviewer_authority_current
};
// Every authenticated tenant member can author an article in their own tenant.
@id("create-tenant-article")
permit (principal is P4EditorialPublishing::Principal,
  action == P4EditorialPublishing::Action::"CreateArticle",
  resource is P4EditorialPublishing::Tenant)
when { principal.tenant_id == resource.id };
