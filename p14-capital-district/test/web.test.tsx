import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BOARD, valueAssets } from "../src/shared/catalog";
import type { MatchSnapshot, TradeOffer } from "../src/shared/contracts";
import { ApiError, api } from "../src/web/api";
import { Board } from "../src/web/Board";
import { ringPosition } from "../src/web/format";
import { loadPending, savePending } from "../src/web/pending";
import { OfferDetails } from "../src/web/Trades";

function fixture(): MatchSnapshot {
  return {
    id: "match-1",
    name: "Practice",
    preset: "practice",
    status: "running",
    version: 1,
    hostId: "dina",
    createdAt: 0,
    serverTime: 1000,
    players: [
      {
        id: "seat-1",
        actorId: "dina",
        name: "Dina",
        seat: 1,
        cash: 1000,
        position: 0,
        color: "#145a9c",
      },
      {
        id: "seat-2",
        actorId: "amara",
        name: "Amara",
        seat: 2,
        cash: 1000,
        position: 0,
        color: "#a43970",
      },
    ],
    properties: BOARD.filter((cell) => cell.kind !== "neutral").map((cell) => ({
      id: cell.id,
      ownerId: cell.index === 1 ? "seat-1" : cell.index === 6 ? "seat-2" : null,
      level: 0,
    })),
    phase: "Manage",
    round: 1,
    activeSeatId: "seat-1",
    pendingPropertyId: null,
    lastDice: null,
    offers: [],
    events: [],
    finalScores: [],
  };
}
const offer: TradeOffer = {
  id: "offer-1",
  senderId: "seat-1",
  recipientId: "seat-2",
  senderCash: 0,
  recipientCash: 0,
  senderProperties: ["space-1"],
  recipientProperties: ["space-6"],
  status: "pending",
  version: 1,
  createdAt: 0,
  expiresAt: 120_000,
};

describe("board presentation", () => {
  it("places every space on a unique perimeter position with the four corner indices", () => {
    const positions = BOARD.map((cell) => ringPosition(cell.index));
    expect(
      new Set(
        positions.map(({ gridRow, gridColumn }) => `${gridRow}:${gridColumn}`),
      ).size,
    ).toBe(40);
    for (const position of positions)
      expect(
        position.gridRow === 1 ||
          position.gridRow === 11 ||
          position.gridColumn === 1 ||
          position.gridColumn === 11,
      ).toBe(true);
    expect([0, 10, 20, 30].map(ringPosition)).toEqual([
      { gridRow: 11, gridColumn: 11 },
      { gridRow: 11, gridColumn: 1 },
      { gridRow: 1, gridColumn: 1 },
      { gridRow: 1, gridColumn: 11 },
    ]);
  });
  it("renders keyboard-accessible deeds with owner names and numbered tokens", () => {
    const html = renderToStaticMarkup(
      <Board match={fixture()} selected="space-1" select={() => {}}>
        Current turn
      </Board>,
    );
    expect(html.match(/type="button"/g)).toHaveLength(40);
    expect(html).toContain("West Quay, owned by Dina");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Dina, Amara here");
    expect(html).toContain("Current turn");
  });
  it("keeps expired acceptance reachable while preserving native purchase protection", () => {
    const match = fixture();
    const render = () =>
      renderToStaticMarkup(
        <OfferDetails
          match={match}
          offer={offer}
          now={121_000}
          busy={false}
          command={async () => true}
          onClose={() => {}}
        />,
      );
    const expired = render();
    expect(expired).toContain("Expired");
    expect(expired).toMatch(/class="primary">Accept for Amara/);
    match.phase = "PurchaseDecision";
    match.pendingPropertyId = "space-1";
    expect(render()).toMatch(/class="primary" disabled="">Accept for Amara/);
  });
});

describe("request recovery", () => {
  it("restores an 80-character game name and a 100-character request key", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    try {
      const pending = {
        kind: "create",
        name: "a".repeat(80),
        preset: "normal",
        key: "k".repeat(100),
      } as const;
      savePending("dina", pending);
      expect(loadPending("dina")).toEqual(pending);
      savePending("dina", { ...pending, key: "k".repeat(101) });
      expect(loadPending("dina")).toBeNull();
      savePending("dina", { ...pending, name: "a".repeat(81) });
      expect(loadPending("dina")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it.each([
    [
      "active_offer_limit",
      "Resolve an open offer or wait for it to expire before creating another.",
    ],
    [
      "match_offer_limit",
      "This game has reached its lifetime trade-offer limit. Start a new game to make more offers.",
    ],
  ])("explains %s", async (code, message) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: code }), { status: 409 }),
        ),
    );
    try {
      await expect(api.match("match-1")).rejects.toThrow(message);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("keeps pending public commands scoped by identity without storing credentials", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    try {
      const pending = {
        kind: "command",
        key: "request-123",
        matchId: "match-1",
        command: {
          type: "turn.end",
          expectedVersion: 4,
          payload: { seatId: "seat-1" },
        },
      } as const;
      savePending("dina", pending);
      expect(loadPending("dina")).toEqual(pending);
      expect(loadPending("amara")).toBeNull();
      expect([...values.values()].join()).not.toMatch(/csrf|token|cookie/i);
      savePending("dina", null);
      expect(loadPending("dina")).toBeNull();
      values.set("p14:unconfirmed:dina", '{"key":"x","kind":"command"}');
      expect(loadPending("dina")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("shows readable domain errors even when the server message repeats its code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "insufficient_cash",
            message: "insufficient_cash",
          }),
          { status: 409 },
        ),
      ),
    );
    try {
      await expect(api.match("match-1")).rejects.toThrow(
        "The paying player does not have enough cash.",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("preserves HTTP status for session and conflict handling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "stale_match" }), {
          status: 409,
        }),
      ),
    );
    try {
      await expect(api.match("match-1")).rejects.toMatchObject({
        status: 409,
        constructor: ApiError,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("asset valuation", () => {
  it("values current owners, buildings, service properties and debt", () => {
    const match = fixture();
    const player = match.players[0];
    const first = match.properties.find((entry) => entry.id === "space-1");
    const service = match.properties.find((entry) => entry.id === "space-3");
    if (!player || !first || !service)
      throw new Error("Missing valuation fixture");
    player.cash = -200;
    first.level = 2;
    service.ownerId = player.id;
    expect(valueAssets(match, player)).toEqual({
      cash: -200,
      propertyValue: 250,
      buildingValue: 100,
      netWorth: 150,
    });
    first.ownerId = match.players[1]?.id ?? null;
    expect(valueAssets(match, player)).toEqual({
      cash: -200,
      propertyValue: 150,
      buildingValue: 0,
      netWorth: -50,
    });
  });
});
