// Inspection reveals only the metadata needed for each analyst's work.
@id("inspect-fields")
permit (
  principal is P5DataGuard::Analyst,
  action == P5DataGuard::Action::"InspectDataset",
  resource is P5DataGuard::Field
)
when {
  principal.role == "Finance lead" ||
  (principal.role == "Support analyst" &&
    ["operational", "tenant"].contains(resource.classification)) ||
  (principal.role == "External reviewer" &&
    ["operational", "tenant"].contains(resource.classification) &&
    resource.name != "employeeId")
};
