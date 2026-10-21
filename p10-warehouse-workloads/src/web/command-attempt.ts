import type { WorkloadId } from "../shared/catalog.ts";
import type { WorkloadCommand } from "../shared/types.ts";

type Mutation = Extract<WorkloadCommand, { idempotencyKey: string }>;
export type MutationInput = Mutation extends infer Command
  ? Command extends Mutation
    ? Omit<Command, "idempotencyKey">
    : never
  : never;

/** An unanswered request may already have committed; retry the same operation. */
export class CommandAttempt {
  private pending:
    | { workloadId: WorkloadId; fingerprint: string; command: Mutation }
    | undefined;

  prepare(workloadId: WorkloadId, input: MutationInput): Mutation {
    const fingerprint = JSON.stringify(input);
    if (
      this.pending?.workloadId === workloadId &&
      this.pending.fingerprint === fingerprint
    )
      return this.pending.command;
    const command = { ...input, idempotencyKey: crypto.randomUUID() };
    this.pending = { workloadId, fingerprint, command };
    return command;
  }

  acknowledge(): void {
    this.pending = undefined;
  }
}
