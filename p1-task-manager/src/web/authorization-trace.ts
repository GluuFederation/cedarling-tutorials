type TaskListTrace = Readonly<{
  principalId: string;
  tenantId: string;
}>;

/** Records the browser presentation boundary without implying enforcement. */
export function logTaskListAuthorization(trace: TaskListTrace): void {
  console.info(
    `P1 browser | FAKE ALLOW (presentation only) | task.view | ${trace.principalId} -> TaskCollection::${trace.tenantId}`,
  );
}
