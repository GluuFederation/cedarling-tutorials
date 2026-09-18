type TaskListTrace = Readonly<{
  principalId: string;
  tenantId: string;
}>;

/**
 * Records the server authorization boundary without sensitive request data.
 * Keep this trace free of tokens, session identifiers, and sensitive claims.
 */
export function logTaskListAuthorization(trace: TaskListTrace): void {
  console.info(
    `P1 server | FAKE ALLOW | task.view | ${trace.principalId} -> TaskCollection::${trace.tenantId}`,
  );
}
