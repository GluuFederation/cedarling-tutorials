export const ACCOUNTS = [
  { id: "dina", name: "Dina" },
  { id: "amara", name: "Amara" },
  { id: "benoit", name: "Benoit" },
  { id: "chloe", name: "Chloe" },
] as const;

export const MAX_GAME_NAME_LENGTH = 80;
export const MAX_TRADE_CASH = 5000;
export const MAX_TRADE_PROPERTIES = 3;
export const MAX_ACTIVE_OFFERS = 8;
export const MAX_MATCH_OFFERS = 200;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/u;

export function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value);
}
