// Allow a caller to search only the corpus owned by their current tenant.
@id("server-search-tenant-corpus")
permit(
  principal,
  action == RAG::Action::"SearchCorpus",
  resource is RAG::Corpus
) when {
  context.boundary == "server" &&
  context has tokens &&
  context.tokens has p2tenantrag_access_token &&
  context.tokens.p2tenantrag_access_token.hasTag("sub") &&
  context.tokens.p2tenantrag_access_token.getTag("sub").contains(context.user.subject) &&
  context.tokens.p2tenantrag_access_token.hasTag("aud") &&
  context.tokens.p2tenantrag_access_token.getTag("aud").contains("http://localhost:17002/api") &&
  context.tokens.p2tenantrag_access_token has scope &&
  (context.tokens.p2tenantrag_access_token.scope == "corpus.search" ||
   context.tokens.p2tenantrag_access_token.scope like "corpus.search *" ||
   context.tokens.p2tenantrag_access_token.scope like "* corpus.search" ||
   context.tokens.p2tenantrag_access_token.scope like "* corpus.search *") &&
  context.selected_corpus_id == resource.corpus_id &&
  context.user.tenant_id == resource.tenant_id
};

// Allow same-tenant public evidence and explicitly granted confidential evidence.
@id("server-retrieve-authorized-document")
permit(
  principal,
  action == RAG::Action::"RetrieveDocument",
  resource is RAG::Document
) when {
  context.boundary == "server" &&
  context has tokens &&
  context.tokens has p2tenantrag_access_token &&
  context.tokens.p2tenantrag_access_token.hasTag("sub") &&
  context.tokens.p2tenantrag_access_token.getTag("sub").contains(context.user.subject) &&
  context.tokens.p2tenantrag_access_token.hasTag("aud") &&
  context.tokens.p2tenantrag_access_token.getTag("aud").contains("http://localhost:17002/api") &&
  context.tokens.p2tenantrag_access_token has scope &&
  (context.tokens.p2tenantrag_access_token.scope == "document.retrieve" ||
   context.tokens.p2tenantrag_access_token.scope like "document.retrieve *" ||
   context.tokens.p2tenantrag_access_token.scope like "* document.retrieve" ||
   context.tokens.p2tenantrag_access_token.scope like "* document.retrieve *") &&
  context.selected_corpus_id == resource.corpus_id &&
  context.user.tenant_id == resource.tenant_id &&
  (resource.classification == "public" ||
    (resource.classification == "confidential" &&
      resource.confidential_reader_subjects.contains(context.user.subject)))
};
