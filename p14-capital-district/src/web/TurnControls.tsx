import { BOARD } from "../shared/catalog";
import type { MatchSnapshot } from "../shared/contracts";
import type { CommandInput } from "./api";
import { Dice } from "./Board";
import { credits, phaseLabel } from "./format";

export function TurnControls({
  match,
  busy,
  command,
}: {
  match: MatchSnapshot;
  busy: boolean;
  command: (command: CommandInput) => Promise<boolean>;
}) {
  const active = match.players.find(
    (player) => player.id === match.activeSeatId,
  );
  if (match.status === "finished")
    return (
      <div className="results">
        <h2>
          {match.finalScores
            .filter((score) => score.winner)
            .map((score) => score.name)
            .join(" & ")}{" "}
          {match.finalScores.filter((score) => score.winner).length > 1
            ? "share the win"
            : "wins"}
        </h2>
        <ol>
          {match.finalScores.map((score) => (
            <li key={score.playerId}>
              <strong>{score.name}</strong>
              <span>{credits(score.netWorth)} net worth</span>
            </li>
          ))}
        </ol>
        <p className="muted">Cash + property values + improvements</p>
      </div>
    );
  if (match.status === "abandoned")
    return (
      <>
        <h2>Game abandoned</h2>
        <p>This board is saved for viewing.</p>
      </>
    );
  if (!active) return null;
  const landing = BOARD.find((cell) => cell.id === match.pendingPropertyId);
  return (
    <>
      <span className="round-label">Round {match.round} of 10</span>
      <h2>{active.name}’s turn</h2>
      <p className="turn-phase">{phaseLabel(match.phase)}</p>
      {match.lastDice && <Dice values={match.lastDice} />}
      {match.phase === "AwaitingRoll" && (
        <button
          type="button"
          className="primary turn-button"
          disabled={busy}
          onClick={() =>
            void command({
              type: "turn.roll",
              payload: { seatId: active.id },
            })
          }
        >
          Roll for {active.name}
        </button>
      )}
      {match.phase === "PurchaseDecision" && landing && (
        <>
          <h3>{landing.name}</h3>
          <p>
            {active.name} can buy this property for {credits(landing.price)}{" "}
            credits.
          </p>
          <div className="button-row center">
            <button
              type="button"
              className="primary"
              disabled={busy || active.cash < landing.price}
              onClick={() =>
                void command({
                  type: "property.buy",
                  payload: { seatId: active.id },
                })
              }
            >
              Buy for {active.name}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void command({
                  type: "property.pass",
                  payload: { seatId: active.id },
                })
              }
            >
              Pass
            </button>
          </div>
          {active.cash < landing.price && (
            <p className="muted">{active.name} needs more cash to buy.</p>
          )}
        </>
      )}
      {match.phase === "Manage" && (
        <button
          type="button"
          className="primary turn-button"
          disabled={busy}
          onClick={() =>
            void command({ type: "turn.end", payload: { seatId: active.id } })
          }
        >
          End {active.name}’s turn
        </button>
      )}
    </>
  );
}
