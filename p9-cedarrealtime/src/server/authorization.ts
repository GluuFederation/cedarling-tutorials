import type { Capability } from "../shared/capabilities.ts";
import type { OperationOutcome } from "../shared/protocol.ts";
import { limits } from "./config.ts";
import { randomToken } from "./crypto.ts";

type SafeFact = string | number | boolean | null;

type AuthorizationInput = Readonly<{
  principalId: string;
  capability: Capability;
  resourceId: string;
  facts: Readonly<Record<string, SafeFact>>;
  effect: string;
}>;

type Diagnostic = OperationOutcome &
  Readonly<{ principalId: string; timestamp: number }>;

export class AuthorizationGateway {
  readonly #diagnostics: Diagnostic[] = [];

  private readonly decide: (input: AuthorizationInput) => boolean;

  constructor(decide: (input: AuthorizationInput) => boolean = () => true) {
    this.decide = decide;
  }

  evaluate(input: AuthorizationInput): OperationOutcome {
    const requestId = `req_${randomToken(12)}`;
    const allowed = this.decide(input);
    const outcome: OperationOutcome = {
      requestId,
      capability: input.capability,
      resource: input.resourceId,
      decision: allowed ? "FAKE ALLOW" : "UNAVAILABLE",
      effect: allowed ? input.effect : "none",
      reason: allowed ? "permissive_allow" : "authorization_unavailable",
    };
    const now = Date.now();
    this.#diagnostics.push({
      ...outcome,
      principalId: input.principalId,
      timestamp: now,
    });
    while (
      this.#diagnostics.length > limits.diagnosticEntries ||
      (this.#diagnostics[0]?.timestamp ?? now) < now - limits.diagnosticMs
    ) {
      this.#diagnostics.shift();
    }

    console.info(
      `P9 server | ${allowed ? "FAKE ALLOW" : "UNAVAILABLE"} | ${input.capability} | ${input.principalId} -> ${input.resourceId}`,
    );
    return outcome;
  }

  diagnostic(
    principalId: string,
    requestId: string,
  ): OperationOutcome | undefined {
    const item = this.#diagnostics.find(
      (entry) =>
        entry.requestId === requestId && entry.principalId === principalId,
    );
    if (!item || item.timestamp < Date.now() - limits.diagnosticMs)
      return undefined;
    const { timestamp: _timestamp, principalId: _principal, ...outcome } = item;
    return outcome;
  }
}
