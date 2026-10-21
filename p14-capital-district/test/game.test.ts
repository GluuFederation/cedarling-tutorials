import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameStore } from "../src/server/data/game-store.ts";
import { DomainError, GameService } from "../src/server/game/service.ts";
import { BOARD, valueAssets } from "../src/shared/catalog.ts";
import type {
  Actor,
  Authorizer,
  Capability,
  DecisionInput,
  GameCommand,
  MatchSnapshot,
} from "../src/shared/contracts.ts";
import { CAPABILITIES } from "../src/shared/contracts.ts";

const dina: Actor = { id: "dina", name: "Dina" };
const amara: Actor = { id: "amara", name: "Amara" };
const benoit: Actor = { id: "benoit", name: "Benoit" };
const chloe: Actor = { id: "chloe", name: "Chloe" };
const observer: Actor = { id: "observer", name: "Observer" };
const stores: GameStore[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function fixture(preset: "normal" | "practice" = "practice", count = 2) {
  const store = new GameStore(":memory:");
  stores.push(store);
  let now = 1000000;
  let nextDice: [number, number] = [1, 1];
  let authorizer: Authorizer = { decide: async () => ({ decision: true }) };
  const service = new GameService(store, {
    clock: () => now,
    dice: () => nextDice,
    authorize: { decide: (input) => authorizer.decide(input) },
  });
  let match = (
    await service.create(dina, { name: "Test match", preset }, randomUUID())
  ).match;
  async function run(
    actor: Actor,
    type: GameCommand["type"],
    payload: GameCommand["payload"] = {},
    key = randomUUID(),
    version?: number,
  ) {
    const result = await service.execute(
      actor,
      match.id,
      {
        type,
        payload,
        expectedVersion: version ?? match.version,
      } as GameCommand,
      key,
    );
    match = result.match;
    return result;
  }
  for (const actor of [amara, benoit, chloe].slice(0, count - 1))
    await run(actor, "join");
  await run(dina, "match.start");
  const seat = (index: number) => {
    const result = match.players[index];
    if (!result) throw new Error("Missing test player");
    return result;
  };
  // Test-only fixture changes use the same guarded persistence primitive, not a live API.
  function arrange(change: (snapshot: MatchSnapshot) => void) {
    const previous = match.version;
    change(match);
    match.version++;
    expect(
      store.commit(match, previous, randomUUID(), "test-fixture", {
        id: randomUUID(),
        actorId: "fixture",
        matchId: match.id,
        action: "match.create",
        requestId: "fixture",
        resultingVersion: match.version,
        at: now,
      }),
    ).toBe(true);
  }
  return {
    service,
    store,
    run,
    seat,
    arrange,
    get match() {
      return match;
    },
    time: (value: number) => {
      now = value;
    },
    advance: (value: number) => {
      now += value;
    },
    dice: (value: [number, number]) => {
      nextDice = value;
    },
    authorize: (value: Authorizer) => {
      authorizer = value;
    },
  };
}

describe("board and lifecycle", () => {
  it("defines all forty cells and the contract economy", () => {
    expect(BOARD.map((entry) => entry.index)).toEqual(
      Array.from({ length: 40 }, (_, index) => index),
    );
    expect(new Set(BOARD.map((entry) => entry.id)).size).toBe(40);
    expect(BOARD.filter((entry) => entry.kind === "property")).toHaveLength(24);
    expect(BOARD.filter((entry) => entry.kind === "service")).toHaveLength(8);
    expect(BOARD.filter((entry) => entry.kind === "neutral")).toHaveLength(8);
    expect(BOARD[1]).toMatchObject({
      name: "West Quay",
      group: "Harbor",
      price: 100,
      baseRent: 10,
      buildingCost: 50,
    });
    expect(BOARD[39]).toMatchObject({
      name: "Summit Court",
      price: 240,
      baseRent: 24,
      buildingCost: 120,
    });
    for (const service of BOARD.filter((entry) => entry.kind === "service"))
      expect(service).toMatchObject({
        price: 150,
        baseRent: 15,
        buildingCost: 0,
      });
  });
  it("requires two players, prevents duplicate seats, and caps the lobby at four", async () => {
    const store = new GameStore(":memory:");
    stores.push(store);
    const service = new GameService(store, {
      authorize: { decide: async () => ({ decision: true }) },
    });
    let match = (
      await service.create(
        dina,
        { name: "Lobby", preset: "normal" },
        randomUUID(),
      )
    ).match;
    const command = (type: GameCommand["type"]) =>
      ({ type, expectedVersion: match.version, payload: {} }) as GameCommand;
    await expect(
      service.execute(dina, match.id, command("match.start"), randomUUID()),
    ).rejects.toMatchObject({ code: "two_players_required" });
    await expect(
      service.execute(dina, match.id, command("join"), randomUUID()),
    ).rejects.toMatchObject({ code: "already_joined" });
    for (const actor of [amara, benoit, chloe])
      match = (
        await service.execute(actor, match.id, command("join"), randomUUID())
      ).match;
    await expect(
      service.execute(observer, match.id, command("join"), randomUUID()),
    ).rejects.toMatchObject({ code: "lobby_full" });
  });
  it("compacts seats at start and reserves the roster after start", async () => {
    const store = new GameStore(":memory:");
    stores.push(store);
    const service = new GameService(store, {
      authorize: { decide: async () => ({ decision: true }) },
    });
    let match = (
      await service.create(
        dina,
        { name: "Lobby", preset: "normal" },
        randomUUID(),
      )
    ).match;
    const run = async (actor: Actor, type: GameCommand["type"]) => {
      match = (
        await service.execute(
          actor,
          match.id,
          { type, expectedVersion: match.version, payload: {} } as GameCommand,
          randomUUID(),
        )
      ).match;
    };
    await run(amara, "join");
    await run(benoit, "join");
    await run(amara, "leave");
    await run(chloe, "join");
    await run(dina, "match.start");
    expect(match.players.map((entry) => entry.seat)).toEqual([1, 2, 3]);
    await expect(run(observer, "join")).rejects.toMatchObject({
      code: "lobby_closed",
    });
    await expect(run(benoit, "leave")).rejects.toMatchObject({
      code: "lobby_closed",
    });
  });
  it("maps practice assets to seats, starts mid-turn, and keeps extra seats empty", async () => {
    const game = await fixture("practice", 4);
    expect(game.match.phase).toBe("Manage");
    expect(game.match.lastDice).toBeNull();
    expect(game.match.players.map((entry) => entry.cash)).toEqual([
      1000, 1000, 1000, 1000,
    ]);
    expect(
      game.match.properties
        .filter((entry) => entry.ownerId === game.seat(0).id)
        .map((entry) => entry.id),
    ).toEqual(["space-1", "space-2", "space-4"]);
    expect(
      game.match.properties
        .filter((entry) => entry.ownerId === game.seat(1).id)
        .map((entry) => entry.id),
    ).toEqual(["space-6", "space-7", "space-9"]);
    expect(
      game.match.properties.filter(
        (entry) => entry.ownerId === game.seat(2).id,
      ),
    ).toHaveLength(0);
  });
  for (const count of [2, 3, 4])
    it(`finishes exactly ten rounds for ${count} players with shared winners`, async () => {
      const game = await fixture("normal", count);
      for (let turn = 0; turn < count * 10; turn++) {
        const activeId = game.match.activeSeatId;
        if (!activeId) throw new Error("Missing active seat");
        expect(game.match.round).toBe(Math.floor(turn / count) + 1);
        await game.run(dina, "turn.roll", { seatId: activeId });
        if (game.match.phase === "PurchaseDecision")
          await game.run(dina, "property.pass", { seatId: activeId });
        await game.run(dina, "turn.end", { seatId: activeId });
      }
      expect(game.match.status).toBe("finished");
      expect(game.match.finalScores).toHaveLength(count);
      expect(game.match.finalScores.every((entry) => entry.winner)).toBe(true);
      await expect(
        game.run(dina, "turn.roll", { seatId: game.seat(0).id }),
      ).rejects.toMatchObject({ code: "match_closed" });
    });
  it("abandonment closes offers without a winner", async () => {
    const game = await fixture();
    await game.run(dina, "trade.offer", {
      senderId: game.seat(0).id,
      recipientId: game.seat(1).id,
      senderProperties: ["space-1"],
      recipientProperties: [],
      senderCash: 0,
      recipientCash: 0,
    });
    await game.run(observer, "match.abandon");
    expect(game.match.status).toBe("abandoned");
    expect(game.match.offers[0]?.status).toBe("closed");
    expect(game.match.finalScores).toEqual([]);
  });
  it("closes pending offers at match completion and leaves the final snapshot read-only", async () => {
    const game = await fixture();
    await game.run(dina, "trade.offer", {
      senderId: game.seat(0).id,
      recipientId: game.seat(1).id,
      senderProperties: ["space-1"],
      recipientProperties: [],
      senderCash: 0,
      recipientCash: 0,
    });
    game.arrange((match) => {
      match.round = 10;
      match.activeSeatId = game.seat(1).id;
    });
    await game.run(amara, "turn.end", { seatId: game.seat(1).id });
    for (const player of game.match.players) {
      expect(
        game.match.finalScores.find((score) => score.playerId === player.id),
      ).toMatchObject(valueAssets(game.match, player));
    }
    expect(game.match.offers[0]?.status).toBe("closed");
    const before = game.service.get(game.match.id);
    await expect(
      game.run(amara, "trade.accept", {
        offerId: game.match.offers[0]?.id ?? "",
      }),
    ).rejects.toMatchObject({ code: "match_closed" });
    expect(game.service.get(game.match.id)).toEqual(before);
  });
});

describe("movement and property arithmetic", () => {
  it.each(BOARD)(
    "resolves a landing on $name using its actual board kind",
    async (space) => {
      const game = await fixture("normal");
      game.arrange((match) => {
        if (match.players[0])
          match.players[0].position = (space.index + 38) % 40;
      });
      await game.run(dina, "turn.roll", { seatId: game.seat(0).id });
      expect(game.seat(0).position).toBe(space.index);
      expect(game.match.phase).toBe(
        space.kind === "neutral" ? "Manage" : "PurchaseDecision",
      );
      expect(game.match.pendingPropertyId).toBe(
        space.kind === "neutral" ? null : space.id,
      );
      expect(game.seat(0).cash).toBe(space.index < 2 ? 1200 : 1000);
    },
  );
  it("starts without a grant, buys only at the pending landing, and rolls once", async () => {
    const game = await fixture("normal");
    const id = game.seat(0).id;
    expect(game.seat(0).cash).toBe(1000);
    await game.run(observer, "turn.roll", { seatId: id });
    expect(game.match.pendingPropertyId).toBe("space-2");
    await expect(
      game.run(dina, "turn.roll", { seatId: id }),
    ).rejects.toMatchObject({ code: "wrong_turn_phase" });
    await game.run(observer, "property.buy", { seatId: id });
    expect(game.seat(0).cash).toBe(900);
    expect(
      game.match.properties.find((entry) => entry.id === "space-2")?.ownerId,
    ).toBe(id);
  });
  it("pays the start grant once when passing or landing on Start", async () => {
    for (const position of [38, 39]) {
      const game = await fixture("normal");
      game.arrange((match) => {
        if (match.players[0]) match.players[0].position = position;
      });
      await game.run(dina, "turn.roll", { seatId: game.seat(0).id });
      expect(game.seat(0).cash).toBe(1200);
      expect(game.seat(0).position).toBe((position + 2) % 40);
    }
  });
  it("pays rent to the current owner and allows debt", async () => {
    const game = await fixture("normal");
    game.arrange((match) => {
      const owner = match.properties.find((entry) => entry.id === "space-2");
      if (owner) {
        owner.ownerId = game.seat(1).id;
        owner.level = 3;
      }
      if (match.players[0]) match.players[0].cash = 5;
    });
    await game.run(dina, "turn.roll", { seatId: game.seat(0).id });
    expect(game.seat(0).cash).toBe(-65);
    expect(game.seat(1).cash).toBe(1070);
    expect(game.match.phase).toBe("Manage");
  });
  it("pays the new owner after a property transfer, with fixed service rent", async () => {
    const game = await fixture("normal");
    game.arrange((match) => {
      if (match.players[0]) match.players[0].position = 1;
      const target = match.properties.find((entry) => entry.id === "space-3");
      if (target) target.ownerId = game.seat(0).id;
    });
    await game.run(dina, "trade.offer", {
      senderId: game.seat(0).id,
      recipientId: game.seat(1).id,
      senderProperties: ["space-3"],
      recipientProperties: [],
      senderCash: 0,
      recipientCash: 0,
    });
    await game.run(amara, "trade.accept", {
      offerId: game.match.offers[0]?.id ?? "",
    });
    await game.run(dina, "turn.roll", { seatId: game.seat(0).id });
    expect(game.seat(0).cash).toBe(985);
    expect(game.seat(1).cash).toBe(1015);
  });
  it("has no own-property rent and refuses unaffordable optional purchase", async () => {
    const game = await fixture("normal");
    game.arrange((match) => {
      const owned = match.properties.find((entry) => entry.id === "space-2");
      if (owned) owned.ownerId = game.seat(0).id;
    });
    await game.run(dina, "turn.roll", { seatId: game.seat(0).id });
    expect(game.seat(0).cash).toBe(1000);
    const poor = await fixture("normal");
    poor.arrange((match) => {
      if (match.players[0]) match.players[0].cash = 20;
    });
    await poor.run(dina, "turn.roll", { seatId: poor.seat(0).id });
    await expect(
      poor.run(dina, "property.buy", { seatId: poor.seat(0).id }),
    ).rejects.toMatchObject({ code: "insufficient_cash" });
  });
  it("enforces even construction and three levels, while leaving ownership to authorization", async () => {
    const game = await fixture();
    await game.run(amara, "property.build", {
      seatId: game.seat(0).id,
      propertyId: "space-6",
    });
    expect(game.seat(0).cash).toBe(940);
    expect(game.seat(1).cash).toBe(1000);
    await expect(
      game.run(dina, "property.build", {
        seatId: game.seat(0).id,
        propertyId: "space-6",
      }),
    ).rejects.toMatchObject({ code: "build_evenly" });
    game.arrange((match) => {
      for (const target of match.properties.filter((entry) =>
        ["space-1", "space-2", "space-4"].includes(entry.id),
      ))
        target.level = 3;
    });
    await expect(
      game.run(dina, "property.build", {
        seatId: game.seat(0).id,
        propertyId: "space-1",
      }),
    ).rejects.toMatchObject({ code: "cannot_build" });
    await expect(
      game.run(dina, "property.build", {
        seatId: game.seat(0).id,
        propertyId: "space-3",
      }),
    ).rejects.toMatchObject({ code: "cannot_build" });
  });
  it("values current assets and buildings with signed cash", async () => {
    const game = await fixture();
    game.arrange((match) => {
      if (match.players[0]) match.players[0].cash = -40;
      const target = match.properties.find((entry) => entry.id === "space-1");
      if (target) target.level = 2;
    });
    expect(valueAssets(game.match, game.seat(0)).netWorth).toBe(360);
  });
  it("retains negative net worth in final results", async () => {
    const game = await fixture();
    game.arrange((match) => {
      match.round = 10;
      match.activeSeatId = game.seat(1).id;
      if (match.players[0]) match.players[0].cash = -1000;
    });
    await game.run(amara, "turn.end", { seatId: game.seat(1).id });
    expect(
      game.match.finalScores.find(
        (entry) => entry.playerId === game.seat(0).id,
      ),
    ).toMatchObject({ netWorth: -700, winner: false });
  });
});

describe("trades and baseline permission gaps", () => {
  async function offer(
    game: Awaited<ReturnType<typeof fixture>>,
    overrides: Partial<{
      senderProperties: string[];
      recipientProperties: string[];
      senderCash: number;
      recipientCash: number;
    }> = {},
  ) {
    await game.run(dina, "trade.offer", {
      senderId: game.seat(0).id,
      recipientId: game.seat(1).id,
      senderProperties: ["space-2"],
      recipientProperties: ["space-7"],
      senderCash: 0,
      recipientCash: 0,
      ...overrides,
    });
    const result = game.match.offers.at(-1);
    if (!result) throw new Error("Missing offer");
    return result;
  }
  it("transfers cash, property and buildings atomically and only once", async () => {
    const game = await fixture();
    const trade = await offer(game, { senderCash: 20, recipientCash: 80 });
    game.arrange((match) => {
      const target = match.properties.find((entry) => entry.id === "space-2");
      if (target) target.level = 2;
    });
    await game.run(amara, "trade.accept", { offerId: trade.id });
    expect(
      game.match.properties.find((entry) => entry.id === "space-2"),
    ).toMatchObject({ ownerId: game.seat(1).id, level: 2 });
    expect(
      game.match.properties.find((entry) => entry.id === "space-7")?.ownerId,
    ).toBe(game.seat(0).id);
    expect(game.seat(0).cash).toBe(1060);
    expect(game.seat(1).cash).toBe(940);
    await expect(
      game.run(amara, "trade.accept", { offerId: trade.id }),
    ).rejects.toMatchObject({ code: "offer_closed" });
  });
  it("lets a debtor sell for cash, but never funds outgoing cash from incoming cash", async () => {
    const game = await fixture();
    game.arrange((match) => {
      if (match.players[0]) match.players[0].cash = -40;
    });
    const trade = await offer(game, {
      recipientProperties: [],
      recipientCash: 100,
    });
    await game.run(amara, "trade.accept", { offerId: trade.id });
    expect(game.seat(0).cash).toBe(60);
    const invalid = await fixture();
    invalid.arrange((match) => {
      if (match.players[0]) match.players[0].cash = 0;
    });
    const unfunded = await offer(invalid, {
      senderCash: 1,
      recipientCash: 100,
    });
    const before = invalid.service.get(invalid.match.id);
    await expect(
      invalid.run(amara, "trade.accept", { offerId: unfunded.id }),
    ).rejects.toMatchObject({ code: "insufficient_cash" });
    expect(invalid.service.get(invalid.match.id)).toEqual(before);
  });
  it("leaves expired acceptance reachable, with no expiry status rewrite", async () => {
    const game = await fixture();
    const trade = await offer(game);
    game.advance(120001);
    expect(game.service.get(game.match.id).offers[0]?.status).toBe("pending");
    await game.run(observer, "trade.accept", { offerId: trade.id });
    expect(game.match.offers[0]?.status).toBe("accepted");
  });
  it("reauthorizes a deadline crossed during an awaited decision", async () => {
    const game = await fixture();
    const trade = await offer(game);
    let calls = 0;
    game.authorize({
      decide: async ({ facts }) => {
        calls++;
        if (calls === 1) game.advance(120001);
        return { decision: facts.now < trade.expiresAt };
      },
    });
    await expect(
      game.run(amara, "trade.accept", { offerId: trade.id }),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls).toBe(2);
    expect(game.service.get(game.match.id).offers[0]?.status).toBe("pending");
  });
  it("redecides crossing expiry but keeps the permissive baseline", async () => {
    const game = await fixture();
    const trade = await offer(game);
    let calls = 0;
    game.authorize({
      decide: async () => {
        calls++;
        if (calls === 1) game.advance(120001);
        return { decision: true };
      },
    });
    await game.run(amara, "trade.accept", { offerId: trade.id });
    expect(calls).toBe(2);
    expect(game.match.offers[0]?.status).toBe("accepted");
  });
  it("demonstrates current-ownership and full-group gaps after a second trade", async () => {
    const game = await fixture();
    const a = await offer(game);
    const b = await offer(game, { recipientProperties: ["space-6"] });
    await game.run(amara, "trade.accept", { offerId: b.id });
    await game.run(amara, "trade.accept", { offerId: a.id });
    expect(
      game.match.properties.find((entry) => entry.id === "space-7")?.ownerId,
    ).toBe(game.seat(0).id);
    await game.run(dina, "property.build", {
      seatId: game.seat(0).id,
      propertyId: "space-1",
    });
    expect(
      game.match.properties.find((entry) => entry.id === "space-1")?.level,
    ).toBe(1);
  });
  it("protects an unowned pending landing from trade acceptance", async () => {
    const game = await fixture("normal");
    await game.run(dina, "turn.roll", { seatId: game.seat(0).id });
    const trade = await offer(game);
    await expect(
      game.run(amara, "trade.accept", { offerId: trade.id }),
    ).rejects.toMatchObject({ code: "purchase_pending" });
  });
  it("bounds offers, terms and match-scoped property references", async () => {
    const game = await fixture();
    for (let i = 0; i < 8; i++) await offer(game);
    await expect(offer(game)).rejects.toMatchObject({
      code: "active_offer_limit",
    });
    game.advance(120001);
    await offer(game);
    expect(game.match.offers).toHaveLength(9);
    await expect(
      offer(game, { senderProperties: ["space-2", "space-2"] }),
    ).rejects.toMatchObject({ code: "invalid_trade" });
    await expect(
      offer(game, { senderProperties: ["space-400"] }),
    ).rejects.toMatchObject({ code: "unknown_property" });
    await expect(offer(game, { senderCash: -1 })).rejects.toMatchObject({
      code: "invalid_cash",
    });
  });
  it("counts expired offers toward the lifetime cap but not the live cap", async () => {
    const game = await fixture();
    const trade = await offer(game);
    game.arrange((match) => {
      match.offers = Array.from({ length: 200 }, (_, index) => ({
        ...structuredClone(trade),
        id: `offer-${index}`,
      }));
    });
    await expect(offer(game)).rejects.toMatchObject({
      code: "match_offer_limit",
    });
    game.advance(120001);
    await expect(offer(game)).rejects.toMatchObject({
      code: "match_offer_limit",
    });
  });
});

describe("authorization and guarded effects", () => {
  it("supplies proposed trade terms before creating an offer", async () => {
    const game = await fixture();
    const decide = vi.fn(async (_input: DecisionInput) => ({
      decision: false,
    }));
    game.authorize({ decide });
    for (const [sender, recipient] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const payload = {
        senderId: game.seat(sender).id,
        recipientId: game.seat(recipient).id,
        senderProperties: ["space-2"],
        recipientProperties: ["space-7"],
        senderCash: 10,
        recipientCash: 20,
      };
      await expect(
        game.run(dina, "trade.offer", payload),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(decide).toHaveBeenLastCalledWith(
        expect.objectContaining({
          actor: dina,
          action: "trade.offer",
          resourceId: game.match.id,
          command: {
            type: "trade.offer",
            payload,
            expectedVersion: game.match.version,
          },
          facts: expect.objectContaining({
            match: expect.objectContaining({ offers: [] }),
          }),
        }),
      );
    }
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[0]?.[0].command).not.toEqual(
      decide.mock.calls[1]?.[0].command,
    );
    expect(game.service.get(game.match.id).offers).toEqual([]);
  });
  it("isolates adapter changes from the original command and current match", async () => {
    const game = await fixture();
    game.authorize({
      decide: async ({ command, facts }) => {
        if (command.type === "property.build")
          command.payload.propertyId = "space-1";
        const seat = facts.match.players[0];
        if (seat) seat.cash = 0;
        const target = facts.match.properties.find(
          (entry) => entry.id === "space-6",
        );
        if (target) target.level = 3;
        return { decision: true };
      },
    });
    await game.run(dina, "property.build", {
      seatId: game.seat(0).id,
      propertyId: "space-6",
    });
    expect(game.seat(0).cash).toBe(940);
    expect(
      game.match.properties.find((entry) => entry.id === "space-6")?.level,
    ).toBe(1);
    expect(
      game.match.properties.find((entry) => entry.id === "space-1")?.level,
    ).toBe(0);
  });
  it("binds current actor and current asset facts separately for the adapter", async () => {
    const game = await fixture();
    const decide = vi.fn(async (_input: DecisionInput) => ({ decision: true }));
    game.authorize({ decide });
    await game.run(amara, "property.build", {
      seatId: game.seat(0).id,
      propertyId: "space-6",
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: amara,
        action: "property.build",
        resourceId: "space-6",
        facts: expect.objectContaining({
          match: expect.objectContaining({ activeSeatId: game.seat(0).id }),
        }),
      }),
    );
    const evidence = decide.mock.calls[0]?.[0] as unknown as
      | { facts: { match: MatchSnapshot } }
      | undefined;
    expect(
      evidence?.facts.match.properties.find((entry) => entry.id === "space-6"),
    ).toMatchObject({ ownerId: game.seat(1).id, level: 0 });
  });
  async function capabilityCase(capability: Capability) {
    const game = await fixture(
      capability === "turn.roll" ||
        capability === "property.buy" ||
        capability === "property.pass"
        ? "normal"
        : "practice",
    );
    let payload: GameCommand["payload"] = {};
    if (
      ["turn.roll", "property.buy", "property.pass", "turn.end"].includes(
        capability,
      )
    )
      payload = { seatId: game.seat(0).id };
    if (capability === "property.build")
      payload = { seatId: game.seat(0).id, propertyId: "space-1" };
    if (capability === "property.buy" || capability === "property.pass")
      await game.run(dina, "turn.roll", { seatId: game.seat(0).id });
    if (capability === "trade.offer")
      payload = {
        senderId: game.seat(0).id,
        recipientId: game.seat(1).id,
        senderProperties: ["space-1"],
        recipientProperties: [],
        senderCash: 0,
        recipientCash: 0,
      };
    if (["trade.accept", "trade.reject", "trade.cancel"].includes(capability)) {
      await game.run(dina, "trade.offer", {
        senderId: game.seat(0).id,
        recipientId: game.seat(1).id,
        senderProperties: ["space-1"],
        recipientProperties: [],
        senderCash: 0,
        recipientCash: 0,
      });
      payload = { offerId: game.match.offers[0]?.id ?? "" };
    }
    if (capability === "match.start")
      game.arrange((match) => {
        match.status = "lobby";
      });
    return { game, payload };
  }
  for (const capability of CAPABILITIES) {
    for (const failure of ["deny", "malformed", "unavailable"] as const)
      it(`${capability}: ${failure} never commits`, async () => {
        const { game, payload } = await capabilityCase(capability);
        const before = game.service.get(game.match.id);
        const decide = vi.fn(async () => {
          if (failure === "unavailable") throw new Error("offline");
          return failure === "deny"
            ? { decision: false }
            : ({ decision: "true" } as unknown as { decision: boolean });
        });
        game.authorize({ decide });
        await expect(
          game.run(observer, capability, payload),
        ).rejects.toMatchObject({ status: failure === "deny" ? 403 : 503 });
        expect(decide).toHaveBeenCalledOnce();
        expect(game.service.get(game.match.id)).toEqual(before);
      });
    it(`${capability}: explicit allow reaches a mechanically valid effect`, async () => {
      const { game, payload } = await capabilityCase(capability);
      const version = game.match.version;
      const decide = vi.fn(async () => ({ decision: true }));
      game.authorize({ decide });
      await game.run(observer, capability, payload);
      expect(game.match.version).toBe(version + 1);
      expect(decide).toHaveBeenCalledOnce();
    });
  }
  it("rechecks session validity after authorization", async () => {
    const game = await fixture();
    let valid = true;
    game.authorize({
      decide: async () => {
        valid = false;
        return { decision: true };
      },
    });
    const before = game.service.get(game.match.id);
    await expect(
      game.run({ ...dina, sessionValid: () => valid }, "turn.end", {
        seatId: game.seat(0).id,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(game.service.get(game.match.id)).toEqual(before);
  });
  it("shares a receipt for concurrent retries of the identical command", async () => {
    const game = await fixture();
    const key = randomUUID();
    const version = game.match.version;
    const [first, second] = await Promise.all([
      game.run(
        dina,
        "property.build",
        { seatId: game.seat(0).id, propertyId: "space-1" },
        key,
        version,
      ),
      game.run(
        dina,
        "property.build",
        { seatId: game.seat(0).id, propertyId: "space-1" },
        key,
        version,
      ),
    ]);
    expect(first.receipt).toEqual(second.receipt);
    expect(game.service.get(game.match.id).players[0]?.cash).toBe(950);
  });
  it("replays a safe receipt without reauthorization and rejects changed input", async () => {
    const game = await fixture();
    const key = randomUUID();
    const version = game.match.version;
    const first = await game.run(
      amara,
      "property.build",
      { seatId: game.seat(0).id, propertyId: "space-1" },
      key,
      version,
    );
    game.authorize({
      decide: async () => {
        throw new Error("must not authorize a receipt replay");
      },
    });
    const replay = await game.run(
      amara,
      "property.build",
      { seatId: game.seat(0).id, propertyId: "space-1" },
      key,
      version,
    );
    expect(replay.receipt).toEqual(first.receipt);
    expect(replay.match.version).toBe(first.match.version);
    expect(game.seat(0).cash).toBe(950);
    await expect(
      game.run(
        amara,
        "property.build",
        { seatId: game.seat(0).id, propertyId: "space-2" },
        key,
        version,
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_conflict" });
  });
  it("allows at most one effect from concurrent commands and rejects stale versions", async () => {
    const game = await fixture();
    const version = game.match.version;
    const results = await Promise.allSettled([
      game.run(
        dina,
        "property.build",
        { seatId: game.seat(0).id, propertyId: "space-1" },
        randomUUID(),
        version,
      ),
      game.run(
        amara,
        "property.build",
        { seatId: game.seat(0).id, propertyId: "space-2" },
        randomUUID(),
        version,
      ),
    ]);
    expect(
      results.filter((entry) => entry.status === "fulfilled"),
    ).toHaveLength(1);
    const saved = game.service.get(game.match.id);
    expect(saved.version).toBe(version + 1);
    expect(saved.players[0]?.cash).toBe(950);
  });
  it("persists committed rolls and idempotency receipts across restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "capital-store-"));
    directories.push(directory);
    const path = join(directory, "game.sqlite");
    const store = new GameStore(path);
    let service = new GameService(store, {
      dice: () => [3, 4],
      authorize: { decide: async () => ({ decision: true }) },
    });
    let match = (
      await service.create(
        dina,
        { name: "Persist", preset: "normal" },
        randomUUID(),
      )
    ).match;
    match = (
      await service.execute(
        amara,
        match.id,
        { type: "join", expectedVersion: match.version, payload: {} },
        randomUUID(),
      )
    ).match;
    match = (
      await service.execute(
        dina,
        match.id,
        { type: "match.start", expectedVersion: match.version, payload: {} },
        randomUUID(),
      )
    ).match;
    const key = randomUUID();
    const command: GameCommand = {
      type: "turn.roll",
      expectedVersion: match.version,
      payload: { seatId: match.activeSeatId ?? "" },
    };
    const rolled = await service.execute(dina, match.id, command, key);
    store.close();
    const restarted = new GameStore(path);
    stores.push(restarted);
    service = new GameService(restarted, {
      dice: () => {
        throw new Error("must not reroll");
      },
    });
    const replay = await service.execute(dina, match.id, command, key);
    expect(replay.receipt).toEqual(rolled.receipt);
    expect(replay.match.lastDice).toEqual([3, 4]);
  });
  it("validates command shapes before reading resource properties", async () => {
    const game = await fixture();
    await expect(
      game.service.execute(
        dina,
        game.match.id,
        {
          type: "trade.offer",
          expectedVersion: game.match.version,
          payload: { senderId: "bad" },
        } as GameCommand,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      game.service.execute(
        dina,
        game.match.id,
        {
          type: "trade.offer",
          expectedVersion: game.match.version,
          payload: null,
        } as unknown as GameCommand,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "invalid_command" });
  });
});
