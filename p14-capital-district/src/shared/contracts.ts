export const CAPABILITIES = [
  "match.start",
  "match.abandon",
  "turn.roll",
  "property.buy",
  "property.pass",
  "property.build",
  "turn.end",
  "trade.offer",
  "trade.accept",
  "trade.reject",
  "trade.cancel",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type MatchStatus = "lobby" | "running" | "finished" | "abandoned";
export type Phase = "AwaitingRoll" | "PurchaseDecision" | "Manage" | "Finished";
export type Preset = "normal" | "practice";
export interface Actor {
  id: string;
  name: string;
  sessionValid?: () => boolean;
}
export interface BoardCell {
  id: string;
  index: number;
  name: string;
  kind: "neutral" | "property" | "service";
  group: string | null;
  color: string | null;
  price: number;
  baseRent: number;
  buildingCost: number;
}
export interface Player {
  id: string;
  actorId: string;
  name: string;
  seat: number;
  cash: number;
  position: number;
  color: string;
}
export interface Property {
  id: string;
  ownerId: string | null;
  level: number;
}
export interface TradeTerms {
  senderId: string;
  recipientId: string;
  senderProperties: string[];
  recipientProperties: string[];
  senderCash: number;
  recipientCash: number;
}
export interface TradeOffer extends TradeTerms {
  id: string;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "closed";
  version: number;
  createdAt: number;
  expiresAt: number;
}
export interface GameEvent {
  id: string;
  at: number;
  actorId: string;
  text: string;
}
export interface FinalScore {
  playerId: string;
  name: string;
  cash: number;
  propertyValue: number;
  buildingValue: number;
  netWorth: number;
  winner: boolean;
}
export interface MatchSnapshot {
  id: string;
  name: string;
  preset: Preset;
  status: MatchStatus;
  version: number;
  hostId: string;
  createdAt: number;
  serverTime: number;
  players: Player[];
  properties: Property[];
  phase: Phase;
  round: number;
  activeSeatId: string | null;
  pendingPropertyId: string | null;
  lastDice: [number, number] | null;
  offers: TradeOffer[];
  events: GameEvent[];
  finalScores: FinalScore[];
}
type Command<T extends string, P> = {
  type: T;
  expectedVersion: number;
  payload: P;
};
export type GameCommand =
  | Command<
      "join" | "leave" | "match.start" | "match.abandon",
      Record<string, never>
    >
  | Command<
      "turn.roll" | "property.buy" | "property.pass" | "turn.end",
      { seatId: string }
    >
  | Command<"property.build", { seatId: string; propertyId: string }>
  | Command<"trade.offer", TradeTerms>
  | Command<
      "trade.accept" | "trade.reject" | "trade.cancel",
      { offerId: string }
    >;
export interface CommandReceipt {
  id: string;
  actorId: string;
  matchId: string;
  action: "match.create" | GameCommand["type"];
  requestId: string;
  resultingVersion: number;
  at: number;
}
export interface CommandResult {
  receipt: CommandReceipt;
  match: MatchSnapshot;
}
export interface DecisionInput {
  actor: Actor;
  action: Capability;
  command: GameCommand;
  resourceId: string;
  requestId: string;
  facts: { match: MatchSnapshot; now: number };
}
export interface Authorizer {
  decide(input: DecisionInput): Promise<{ decision: boolean }>;
}
