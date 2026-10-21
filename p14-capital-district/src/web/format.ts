import { BOARD } from "../shared/catalog";
import type { MatchSnapshot } from "../shared/contracts";

export function credits(amount: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    amount,
  );
}

export function propertyName(id: string): string {
  return BOARD.find((cell) => cell.id === id)?.name ?? id;
}

export function playerName(match: MatchSnapshot, id: string | null): string {
  return match.players.find((player) => player.id === id)?.name ?? "Bank";
}

export function phaseLabel(phase: MatchSnapshot["phase"]): string {
  return {
    AwaitingRoll: "Roll the dice",
    PurchaseDecision: "Buy or pass",
    Manage: "Improve or end turn",
    Finished: "Match ended",
  }[phase];
}

export function ringPosition(index: number): {
  gridRow: number;
  gridColumn: number;
} {
  if (index <= 10) return { gridRow: 11, gridColumn: 11 - index };
  if (index <= 20) return { gridRow: 21 - index, gridColumn: 1 };
  if (index <= 30) return { gridRow: 1, gridColumn: index - 19 };
  return { gridRow: index - 29, gridColumn: 11 };
}
