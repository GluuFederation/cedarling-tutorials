import { randomUUID } from "node:crypto";
import { BOARD, PLAYER_COLORS, valueAssets } from "../../shared/catalog.ts";
import type {
  Actor,
  GameCommand,
  MatchSnapshot,
  Player,
  TradeOffer,
  TradeTerms,
} from "../../shared/contracts.ts";
import {
  MAX_ACTIVE_OFFERS,
  MAX_MATCH_OFFERS,
  MAX_TRADE_CASH,
  MAX_TRADE_PROPERTIES,
} from "../../shared/rules.ts";
import { DomainError } from "./errors.ts";

function requireThat(
  condition: unknown,
  status: number,
  code: string,
): asserts condition {
  if (!condition) throw new DomainError(status, code);
}
function player(match: MatchSnapshot, id: string): Player {
  const result = match.players.find((entry) => entry.id === id);
  requireThat(result, 400, "unknown_seat");
  return result;
}
function property(match: MatchSnapshot, id: string) {
  const result = match.properties.find((entry) => entry.id === id);
  requireThat(result, 400, "unknown_property");
  return result;
}
function cell(id: string) {
  const result = BOARD.find((entry) => entry.id === id);
  requireThat(result, 400, "unknown_property");
  return result;
}
function cashAvailable(seat: Player, amount: number): void {
  requireThat(amount === 0 || seat.cash >= amount, 409, "insufficient_cash");
}
function active(
  match: MatchSnapshot,
  id: string,
  phase: MatchSnapshot["phase"],
): Player {
  requireThat(match.activeSeatId === id, 409, "target_is_not_active_seat");
  requireThat(match.phase === phase, 409, "wrong_turn_phase");
  return player(match, id);
}
function scores(match: MatchSnapshot) {
  const totals = match.players
    .map((seat) => ({
      playerId: seat.id,
      name: seat.name,
      ...valueAssets(match, seat),
      winner: false,
    }))
    .sort((a, b) => b.netWorth - a.netWorth);
  const highest = totals[0]?.netWorth;
  return totals.map((entry) => ({
    ...entry,
    winner: entry.netWorth === highest,
  }));
}

/** Pure game mechanics: the caller supplies current facts and commits the result. */
export class GameEngine {
  private readonly clock: () => number;
  private readonly dice: () => [number, number];
  constructor(clock: () => number, dice: () => [number, number]) {
    this.clock = clock;
    this.dice = dice;
  }
  event(match: MatchSnapshot, actor: Actor, text: string): void {
    match.events.push({
      id: randomUUID(),
      at: this.clock(),
      actorId: actor.id,
      text,
    });
    match.events = match.events.slice(-100);
  }
  validateEffect(match: MatchSnapshot, command: GameCommand): void {
    requireThat(
      match.status !== "finished" && match.status !== "abandoned",
      409,
      "match_closed",
    );
    if (
      command.type === "join" ||
      command.type === "leave" ||
      command.type === "match.start"
    ) {
      requireThat(match.status === "lobby", 409, "lobby_closed");
      if (command.type === "match.start")
        requireThat(match.players.length >= 2, 409, "two_players_required");
      return;
    }
    if (command.type === "match.abandon") return;
    requireThat(match.status === "running", 409, "match_not_started");
    switch (command.type) {
      case "turn.roll":
        active(match, command.payload.seatId, "AwaitingRoll");
        break;
      case "property.buy": {
        const seat = active(match, command.payload.seatId, "PurchaseDecision");
        requireThat(match.pendingPropertyId, 409, "no_pending_purchase");
        requireThat(
          property(match, match.pendingPropertyId).ownerId === null,
          409,
          "property_owned",
        );
        cashAvailable(seat, cell(match.pendingPropertyId).price);
        break;
      }
      case "property.pass":
        active(match, command.payload.seatId, "PurchaseDecision");
        break;
      case "turn.end":
        active(match, command.payload.seatId, "Manage");
        break;
      case "property.build": {
        const seat = active(match, command.payload.seatId, "Manage");
        const target = property(match, command.payload.propertyId);
        const space = cell(target.id);
        requireThat(space.group && target.level < 3, 409, "cannot_build");
        const group = match.properties.filter(
          (entry) => cell(entry.id).group === space.group,
        );
        requireThat(
          target.level === Math.min(...group.map((entry) => entry.level)),
          409,
          "build_evenly",
        );
        cashAvailable(seat, space.buildingCost);
        break;
      }
      case "trade.offer":
        this.validateTerms(match, command.payload);
        break;
      case "trade.accept":
      case "trade.reject":
      case "trade.cancel": {
        const offer = match.offers.find(
          (entry) => entry.id === command.payload.offerId,
        );
        requireThat(offer, 404, "offer_not_found");
        requireThat(offer.status === "pending", 409, "offer_closed");
        if (command.type === "trade.accept") {
          requireThat(
            !match.pendingPropertyId ||
              ![
                ...offer.senderProperties,
                ...offer.recipientProperties,
              ].includes(match.pendingPropertyId),
            409,
            "purchase_pending",
          );
          cashAvailable(player(match, offer.senderId), offer.senderCash);
          cashAvailable(player(match, offer.recipientId), offer.recipientCash);
        }
        break;
      }
    }
  }
  private validateTerms(match: MatchSnapshot, terms: TradeTerms): void {
    player(match, terms.senderId);
    player(match, terms.recipientId);
    requireThat(
      terms.senderId !== terms.recipientId,
      400,
      "different_recipient_required",
    );
    for (const amount of [terms.senderCash, terms.recipientCash])
      requireThat(
        Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_TRADE_CASH,
        400,
        "invalid_cash",
      );
    for (const list of [terms.senderProperties, terms.recipientProperties])
      requireThat(
        Array.isArray(list) &&
          list.length <= MAX_TRADE_PROPERTIES &&
          list.every((entry) => typeof entry === "string"),
        400,
        "invalid_properties",
      );
    const ids = [...terms.senderProperties, ...terms.recipientProperties];
    requireThat(
      new Set(ids).size === ids.length &&
        (ids.length > 0 || terms.senderCash > 0 || terms.recipientCash > 0),
      400,
      "invalid_trade",
    );
    for (const id of ids) property(match, id);
    requireThat(
      match.offers.length < MAX_MATCH_OFFERS,
      409,
      "match_offer_limit",
    );
    requireThat(
      match.offers.filter(
        (entry) => entry.status === "pending" && entry.expiresAt > this.clock(),
      ).length < MAX_ACTIVE_OFFERS,
      409,
      "active_offer_limit",
    );
  }
  apply(match: MatchSnapshot, actor: Actor, command: GameCommand): void {
    this.validateEffect(match, command);
    switch (command.type) {
      case "join": {
        requireThat(
          !match.players.some((entry) => entry.actorId === actor.id),
          409,
          "already_joined",
        );
        requireThat(match.players.length < 4, 409, "lobby_full");
        const seat =
          Math.max(0, ...match.players.map((entry) => entry.seat)) + 1;
        const color =
          PLAYER_COLORS.find(
            (entry) =>
              !match.players.some((existing) => existing.color === entry),
          ) ?? PLAYER_COLORS[0];
        match.players.push({
          id: randomUUID(),
          actorId: actor.id,
          name: actor.name,
          seat,
          cash: 1000,
          position: 0,
          color,
        });
        this.event(match, actor, `${actor.name} joined the lobby.`);
        break;
      }
      case "leave": {
        requireThat(
          match.players.some((entry) => entry.actorId === actor.id),
          409,
          "not_seated",
        );
        if (actor.id === match.hostId) this.finish(match, "abandoned");
        else
          match.players = match.players.filter(
            (entry) => entry.actorId !== actor.id,
          );
        this.event(match, actor, `${actor.name} left the lobby.`);
        break;
      }
      case "match.start": {
        match.players.forEach((entry, index) => {
          entry.seat = index + 1;
          entry.cash = 1000;
          entry.position = 0;
        });
        match.status = "running";
        match.activeSeatId = match.players[0]?.id ?? null;
        match.phase = match.preset === "practice" ? "Manage" : "AwaitingRoll";
        if (match.preset === "practice")
          for (const target of match.properties) {
            const group = cell(target.id).group;
            if (group === "Harbor")
              target.ownerId = match.players[0]?.id ?? null;
            if (group === "Market")
              target.ownerId = match.players[1]?.id ?? null;
          }
        this.event(
          match,
          actor,
          `${actor.name} started the ${match.preset === "practice" ? "practice position" : "game"}.`,
        );
        break;
      }
      case "match.abandon":
        this.finish(match, "abandoned");
        this.event(match, actor, `${actor.name} abandoned the match.`);
        break;
      case "turn.roll": {
        const seat = player(match, command.payload.seatId);
        const dice = this.dice();
        requireThat(
          Array.isArray(dice) &&
            dice.length === 2 &&
            dice.every(
              (value) => Number.isInteger(value) && value >= 1 && value <= 6,
            ),
          500,
          "invalid_server_dice",
        );
        const total = seat.position + dice[0] + dice[1];
        seat.position = total % 40;
        match.lastDice = dice;
        if (total >= 40) seat.cash += 200;
        const space = BOARD[seat.position];
        requireThat(space, 500, "invalid_board");
        const landed = match.properties.find((entry) => entry.id === space.id);
        match.phase = "Manage";
        match.pendingPropertyId = null;
        this.event(
          match,
          actor,
          `${seat.name} rolled ${dice[0]} + ${dice[1]} and landed on ${space.name}${total >= 40 ? ", collecting 200" : ""}.`,
        );
        if (landed?.ownerId && landed.ownerId !== seat.id) {
          const owner = player(match, landed.ownerId);
          const rent = space.baseRent * (1 + 2 * landed.level);
          seat.cash -= rent;
          owner.cash += rent;
          this.event(
            match,
            actor,
            `${seat.name} paid ${rent} rent to ${owner.name}.`,
          );
        } else if (landed && !landed.ownerId) {
          match.phase = "PurchaseDecision";
          match.pendingPropertyId = landed.id;
        }
        break;
      }
      case "property.buy": {
        const seat = player(match, command.payload.seatId);
        const id = match.pendingPropertyId;
        requireThat(id, 409, "no_pending_purchase");
        property(match, id).ownerId = seat.id;
        seat.cash -= cell(id).price;
        match.pendingPropertyId = null;
        match.phase = "Manage";
        this.event(
          match,
          actor,
          `${seat.name} bought ${cell(id).name} for ${cell(id).price}.`,
        );
        break;
      }
      case "property.pass":
        match.pendingPropertyId = null;
        match.phase = "Manage";
        this.event(
          match,
          actor,
          `${player(match, command.payload.seatId).name} passed on the purchase.`,
        );
        break;
      case "property.build": {
        const seat = player(match, command.payload.seatId);
        const target = property(match, command.payload.propertyId);
        seat.cash -= cell(target.id).buildingCost;
        target.level++;
        this.event(
          match,
          actor,
          `${seat.name} paid ${cell(target.id).buildingCost} to improve ${cell(target.id).name} to level ${target.level}.`,
        );
        break;
      }
      case "turn.end": {
        const index = match.players.findIndex(
          (entry) => entry.id === match.activeSeatId,
        );
        if (index === match.players.length - 1 && match.round === 10)
          this.finish(match, "finished");
        else {
          if (index === match.players.length - 1) match.round++;
          match.activeSeatId =
            match.players[(index + 1) % match.players.length]?.id ?? null;
          match.phase = "AwaitingRoll";
          match.lastDice = null;
        }
        this.event(
          match,
          actor,
          match.status === "finished"
            ? "The final turn ended. Results are ready."
            : `${player(match, command.payload.seatId).name} ended their turn.`,
        );
        break;
      }
      case "trade.offer": {
        const offer: TradeOffer = {
          ...structuredClone(command.payload),
          id: randomUUID(),
          version: 1,
          status: "pending",
          createdAt: this.clock(),
          expiresAt: this.clock() + 120000,
        };
        match.offers.push(offer);
        this.event(
          match,
          actor,
          `${player(match, offer.senderId).name} offered a trade to ${player(match, offer.recipientId).name}.`,
        );
        break;
      }
      case "trade.accept":
      case "trade.reject":
      case "trade.cancel": {
        const offer = match.offers.find(
          (entry) => entry.id === command.payload.offerId,
        );
        requireThat(offer, 404, "offer_not_found");
        if (command.type === "trade.accept") {
          const sender = player(match, offer.senderId);
          const recipient = player(match, offer.recipientId);
          sender.cash += offer.recipientCash - offer.senderCash;
          recipient.cash += offer.senderCash - offer.recipientCash;
          for (const id of offer.senderProperties)
            property(match, id).ownerId = recipient.id;
          for (const id of offer.recipientProperties)
            property(match, id).ownerId = sender.id;
          offer.status = "accepted";
        } else
          offer.status =
            command.type === "trade.reject" ? "rejected" : "cancelled";
        offer.version++;
        this.event(
          match,
          actor,
          `${actor.name} ${offer.status} the trade between ${player(match, offer.senderId).name} and ${player(match, offer.recipientId).name}.`,
        );
        break;
      }
    }
  }
  private finish(match: MatchSnapshot, status: "finished" | "abandoned"): void {
    match.status = status;
    match.phase = "Finished";
    match.pendingPropertyId = null;
    for (const offer of match.offers)
      if (offer.status === "pending") {
        offer.status = "closed";
        offer.version++;
      }
    match.finalScores = status === "finished" ? scores(match) : [];
  }
}
