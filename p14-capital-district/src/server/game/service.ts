import { createHash, randomInt, randomUUID } from "node:crypto";
import { BOARD, PLAYER_COLORS } from "../../shared/catalog.ts";
import type {
  Actor,
  Authorizer,
  Capability,
  CommandReceipt,
  CommandResult,
  GameCommand,
  MatchSnapshot,
  Preset,
} from "../../shared/contracts.ts";
import { CAPABILITIES } from "../../shared/contracts.ts";
import {
  MAX_GAME_NAME_LENGTH,
  validIdempotencyKey,
} from "../../shared/rules.ts";
import type { GameStore } from "../data/game-store.ts";
import { fixedFakeAllow } from "./authorization.ts";
import { GameEngine } from "./engine.ts";
import { DomainError } from "./errors.ts";

export { DomainError } from "./errors.ts";

function requireThat(
  condition: unknown,
  status: number,
  code: string,
): asserts condition {
  if (!condition) throw new DomainError(status, code);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
function validActor(actor: Actor): void {
  requireThat(
    typeof actor.id === "string" &&
      actor.id.length > 0 &&
      typeof actor.name === "string" &&
      actor.name.length > 0,
    401,
    "authentication_required",
  );
  requireThat(
    !actor.sessionValid || actor.sessionValid(),
    401,
    "session_expired",
  );
}
function validKey(key: string): void {
  requireThat(validIdempotencyKey(key), 400, "invalid_idempotency_key");
}
export interface GameOptions {
  clock?: () => number;
  dice?: () => [number, number];
  authorize?: Authorizer;
}

export class GameService {
  private readonly store: GameStore;
  private readonly clock: () => number;
  private readonly engine: GameEngine;
  private readonly authorize: Authorizer;
  constructor(store: GameStore, options: GameOptions = {}) {
    this.store = store;
    this.clock = options.clock ?? Date.now;
    this.engine = new GameEngine(
      this.clock,
      options.dice ?? (() => [randomInt(1, 7), randomInt(1, 7)]),
    );
    this.authorize = options.authorize ?? fixedFakeAllow;
  }
  list(): MatchSnapshot[] {
    return this.store
      .list()
      .map((match) => ({ ...match, serverTime: this.clock() }));
  }
  get(id: string): MatchSnapshot {
    const match = this.store.get(id);
    requireThat(match, 404, "match_not_found");
    match.serverTime = this.clock();
    return match;
  }
  private replay(
    actor: Actor,
    key: string,
    hash: string,
  ): CommandResult | undefined {
    const saved = this.store.receipt(actor.id, key);
    if (!saved) return;
    requireThat(saved.fingerprint === hash, 409, "idempotency_key_conflict");
    return { receipt: saved.receipt, match: this.get(saved.receipt.matchId) };
  }
  private receipt(
    actor: Actor,
    match: MatchSnapshot,
    action: CommandReceipt["action"],
    requestId: string,
  ): CommandReceipt {
    return {
      id: randomUUID(),
      actorId: actor.id,
      matchId: match.id,
      action,
      requestId,
      resultingVersion: match.version,
      at: this.clock(),
    };
  }
  async create(
    actor: Actor,
    input: { name: string; preset: Preset },
    key: string,
    requestId: string = randomUUID(),
  ): Promise<CommandResult> {
    validActor(actor);
    validKey(key);
    requireThat(
      typeof input?.name === "string" &&
        input.name.trim().length >= 1 &&
        input.name.trim().length <= MAX_GAME_NAME_LENGTH &&
        ["normal", "practice"].includes(input.preset),
      400,
      "invalid_match",
    );
    const hash = fingerprint({ action: "match.create", input });
    const prior = this.replay(actor, key, hash);
    if (prior) return prior;
    const now = this.clock();
    const match: MatchSnapshot = {
      id: randomUUID(),
      name: input.name.trim(),
      preset: input.preset,
      hostId: actor.id,
      status: "lobby",
      version: 1,
      createdAt: now,
      serverTime: now,
      players: [
        {
          id: randomUUID(),
          actorId: actor.id,
          name: actor.name,
          seat: 1,
          cash: 1000,
          position: 0,
          color: PLAYER_COLORS[0],
        },
      ],
      properties: BOARD.filter((entry) => entry.kind !== "neutral").map(
        (entry) => ({ id: entry.id, ownerId: null, level: 0 }),
      ),
      phase: "AwaitingRoll",
      round: 1,
      activeSeatId: null,
      pendingPropertyId: null,
      lastDice: null,
      offers: [],
      events: [],
      finalScores: [],
    };
    this.engine.event(match, actor, `${actor.name} created the lobby.`);
    validActor(actor);
    const receipt = this.receipt(actor, match, "match.create", requestId);
    requireThat(
      this.store.commit(match, null, key, hash, receipt),
      409,
      "command_conflict",
    );
    return { receipt, match };
  }
  async execute(
    actor: Actor,
    matchId: string,
    command: GameCommand,
    key: string,
    requestId: string = randomUUID(),
  ): Promise<CommandResult> {
    validActor(actor);
    validKey(key);
    this.validateCommand(command);
    const hash = fingerprint({ matchId, command });
    const prior = this.replay(actor, key, hash);
    if (prior) return prior;
    let match = this.get(matchId);
    requireThat(match.version === command.expectedVersion, 409, "stale_match");
    // Validate mechanical input before calling the adapter; never consume dice here.
    this.engine.validateEffect(match, command);
    for (let attempt = 0; attempt < 2; attempt++) {
      const decisionTime = this.clock();
      if (command.type !== "join" && command.type !== "leave") {
        const capability: Capability = command.type;
        let decision: { decision: boolean };
        try {
          decision = await this.authorize.decide({
            actor,
            action: capability,
            command: structuredClone(command),
            resourceId: this.resourceId(match, command),
            requestId,
            facts: { match: structuredClone(match), now: decisionTime },
          });
        } catch {
          throw new DomainError(503, "authorization_unavailable");
        }
        requireThat(
          decision && typeof decision.decision === "boolean",
          503,
          "authorization_unavailable",
        );
        requireThat(decision.decision === true, 403, "forbidden");
      }
      validActor(actor);
      const completed = this.replay(actor, key, hash);
      if (completed) return completed;
      const latest = this.get(matchId);
      requireThat(latest.version === match.version, 409, "stale_match");
      const next = structuredClone(match);
      this.engine.apply(next, actor, command);
      next.version++;
      next.serverTime = this.clock();
      const receipt = this.receipt(actor, next, command.type, requestId);
      const offer =
        command.type === "trade.accept"
          ? match.offers.find((entry) => entry.id === command.payload.offerId)
          : undefined;
      // Check again at the effect boundary, after preparing the candidate state.
      if (
        offer &&
        decisionTime < offer.expiresAt &&
        this.clock() >= offer.expiresAt
      ) {
        requireThat(attempt === 0, 409, "facts_changed");
        match = latest;
        continue;
      }
      validActor(actor);
      const committed = this.store.commit(
        next,
        match.version,
        key,
        hash,
        receipt,
      );
      if (!committed) {
        const replayed = this.replay(actor, key, hash);
        if (replayed) return replayed;
        throw new DomainError(409, "stale_match");
      }
      return { receipt, match: next };
    }
    throw new DomainError(409, "facts_changed");
  }
  private resourceId(match: MatchSnapshot, command: GameCommand): string {
    if ("offerId" in command.payload) return command.payload.offerId;
    if ("propertyId" in command.payload) return command.payload.propertyId;
    if ("seatId" in command.payload) return command.payload.seatId;
    return match.id;
  }
  private validateCommand(command: GameCommand): void {
    requireThat(
      command &&
        typeof command === "object" &&
        Number.isSafeInteger(command.expectedVersion) &&
        command.expectedVersion >= 1 &&
        command.payload &&
        typeof command.payload === "object" &&
        !Array.isArray(command.payload),
      400,
      "invalid_command",
    );
    requireThat(
      [...CAPABILITIES, "join", "leave"].includes(command.type),
      400,
      "unknown_command",
    );
    const keys =
      command.type === "trade.offer"
        ? [
            "senderId",
            "recipientId",
            "senderProperties",
            "recipientProperties",
            "senderCash",
            "recipientCash",
          ]
        : command.type.startsWith("trade.")
          ? ["offerId"]
          : command.type === "property.build"
            ? ["seatId", "propertyId"]
            : [
                  "turn.roll",
                  "property.buy",
                  "property.pass",
                  "turn.end",
                ].includes(command.type)
              ? ["seatId"]
              : [];
    requireThat(
      Object.keys(command.payload).length === keys.length &&
        keys.every((key) => Object.hasOwn(command.payload, key)),
      400,
      "invalid_payload",
    );
    for (const key of keys.filter((key) => key.endsWith("Id")))
      requireThat(
        typeof (command.payload as Record<string, unknown>)[key] === "string" &&
          ((command.payload as Record<string, unknown>)[key] as string)
            .length <= 100,
        400,
        "invalid_id",
      );
  }
}
