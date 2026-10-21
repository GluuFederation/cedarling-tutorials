import type {
  CommandResult,
  GameCommand,
  MatchSnapshot,
  Preset,
} from "../shared/contracts";
import { MAX_TRADE_CASH, MAX_TRADE_PROPERTIES } from "../shared/rules";

export interface Session {
  user: { id: string; name: string } | null;
  csrfToken?: string;
}

export type CommandInput = GameCommand extends infer Command
  ? Command extends { expectedVersion: number }
    ? Omit<Command, "expectedVersion">
    : never
  : never;

export class ApiError extends Error {
  public status: number;
  public code: string;
  constructor(status: number, message: string, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const messages: Record<string, string> = {
  authentication_required: "Your session has ended. Sign in again.",
  forbidden: "This action is not allowed.",
  authorization_unavailable:
    "Authorization is unavailable. No action was confirmed.",
  stale_match: "The game changed. Review the latest board, then try again.",
  facts_changed:
    "The game changed during your request. Review the board and try again.",
  command_conflict:
    "Another request changed this game. Review the board and try again.",
  insufficient_cash: "The paying player does not have enough cash.",
  session_expired: "Your session has ended. Sign in again.",
  idempotency_key_conflict:
    "This request key was already used. Refresh the game before continuing.",
  already_joined: "This account already has a seat in this game.",
  build_evenly: "Improve a lower-level property in this group first.",
  cannot_build: "This property cannot receive another improvement.",
  different_recipient_required: "Choose two different players for this trade.",
  lobby_closed:
    "This game has started. You can watch or return to the game list.",
  lobby_full: "All four seats are occupied. You can still watch the game.",
  match_closed: "This game has ended. Its board is available to view.",
  match_not_started: "Start the game before taking this action.",
  no_pending_purchase: "There is no property waiting for a Buy/Pass decision.",
  not_seated: "This account does not have a seat in the lobby.",
  offer_closed:
    "This offer has already been resolved. Review the latest offers.",
  active_offer_limit:
    "Resolve an open offer or wait for it to expire before creating another.",
  match_offer_limit:
    "This game has reached its lifetime trade-offer limit. Start a new game to make more offers.",
  offer_not_found: "This trade offer could not be found. Refresh the game.",
  property_owned: "This property now has an owner. Review its deed.",
  purchase_pending:
    "Finish the Buy/Pass decision before exchanging this property.",
  target_is_not_active_seat: "Choose the player whose turn is active.",
  two_players_required: "A second player must join before the game can start.",
  wrong_turn_phase:
    "This action belongs to a different turn phase. Review the current turn.",
  invalid_cash: `Cash payments must be whole numbers from 0 to ${MAX_TRADE_CASH.toLocaleString("en-US")}.`,
  invalid_properties: `Choose up to ${MAX_TRADE_PROPERTIES} different properties on each side.`,
  invalid_trade: "Include a property or a cash payment in the offer.",
  invalid_command:
    "This request could not be read. Refresh the game and try again.",
  invalid_payload: "Check the form values, then try again.",
  match_not_found: "This game could not be found. Return to the game list.",
  unknown_property: "This property is not part of the game. Refresh the board.",
  unknown_seat: "This player is not seated in the game. Refresh the board.",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error =
      body && typeof body === "object" && "error" in body
        ? body.error
        : undefined;
    const detail =
      body && typeof body === "object" && "message" in body
        ? body.message
        : undefined;
    throw new ApiError(
      response.status,
      typeof error === "string" && messages[error]
        ? messages[error]
        : typeof detail === "string" && !/^[a-z_]+$/.test(detail)
          ? detail
          : `The request could not be completed (${response.status}). Refresh the game and try again.`,
      typeof error === "string" ? error : "",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function mutation(csrfToken: string, key: string, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  };
}

export const api = {
  session: () => request<Session>("/api/session"),
  matches: () => request<MatchSnapshot[]>("/api/matches"),
  match: (id: string) =>
    request<MatchSnapshot>(`/api/matches/${encodeURIComponent(id)}`),
  create: (name: string, preset: Preset, csrf: string, key: string) =>
    request<CommandResult>(
      "/api/matches",
      mutation(csrf, key, { name, preset }),
    ),
  command: (id: string, command: GameCommand, csrf: string, key: string) =>
    request<CommandResult>(
      `/api/matches/${encodeURIComponent(id)}/commands`,
      mutation(csrf, key, command),
    ),
  logout: (csrf: string) =>
    request<void>("/auth/logout", mutation(csrf, crypto.randomUUID(), {})),
};
