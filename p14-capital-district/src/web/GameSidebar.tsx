import type { CSSProperties } from "react";
import { valueAssets } from "../shared/catalog";
import type { MatchSnapshot } from "../shared/contracts";
import type { CommandInput } from "./api";
import { Deed } from "./Deed";
import { credits, playerName, propertyName } from "./format";

export function GameSidebar({
  match,
  selected,
  busy,
  command,
  actorId,
  now,
  select,
  onNewTrade,
  onOffer,
}: {
  match: MatchSnapshot;
  selected: string | null;
  busy: boolean;
  command: (input: CommandInput) => Promise<boolean>;
  actorId: string;
  now: number;
  select: (id: string) => void;
  onNewTrade: () => void;
  onOffer: (id: string) => void;
}) {
  return (
    <aside className="game-sidebar" aria-label="Game details">
      <section className="players">
        <h2>Players</h2>
        <ol>
          {match.players.map((player) => (
            <li
              className={
                player.id === match.activeSeatId && match.status === "running"
                  ? "active-player"
                  : ""
              }
              key={player.id}
            >
              <details>
                <summary>
                  <span
                    className="token"
                    style={
                      {
                        "--player-color": player.color,
                      } as CSSProperties
                    }
                  >
                    {player.seat}
                  </span>
                  <span className="player-name">
                    <strong>{player.name}</strong>
                    <small>
                      {player.id === match.activeSeatId &&
                      match.status === "running"
                        ? "Current turn"
                        : player.actorId === actorId
                          ? "You"
                          : `Seat ${player.seat}`}
                    </small>
                  </span>
                  <span className="player-money">
                    <strong>{credits(player.cash)}</strong>
                    <small>
                      {credits(valueAssets(match, player).netWorth)} net worth
                    </small>
                  </span>
                </summary>
                <div className="player-properties">
                  {match.properties
                    .filter((property) => property.ownerId === player.id)
                    .map((property) => (
                      <button
                        type="button"
                        key={property.id}
                        className="text-button"
                        onClick={() => select(property.id)}
                      >
                        {propertyName(property.id)}
                        {property.level ? ` · L${property.level}` : ""}
                      </button>
                    ))}
                  {!match.properties.some(
                    (property) => property.ownerId === player.id,
                  ) && <span className="muted">No property yet</span>}
                </div>
              </details>
            </li>
          ))}
        </ol>
      </section>
      <Deed match={match} selected={selected} busy={busy} command={command} />
      <section className="offers">
        <div className="section-heading">
          <h2>Trade offers</h2>
          {match.status === "running" && (
            <button type="button" disabled={busy} onClick={() => onNewTrade()}>
              New offer
            </button>
          )}
        </div>
        {!match.offers.length ? (
          <p className="muted">Make an offer to exchange property or cash.</p>
        ) : (
          <ul>
            {[...match.offers].reverse().map((offer) => (
              <li key={offer.id}>
                <button
                  type="button"
                  className="offer-row"
                  onClick={() => onOffer(offer.id)}
                >
                  <span>
                    <strong>
                      {playerName(match, offer.senderId)} →{" "}
                      {playerName(match, offer.recipientId)}
                    </strong>
                    <small>
                      {offer.senderProperties.length +
                        offer.recipientProperties.length}{" "}
                      properties ·{" "}
                      {credits(offer.senderCash + offer.recipientCash)} credits
                    </small>
                  </span>
                  <span
                    className={`status ${offer.status === "pending" && now >= offer.expiresAt ? "expired" : ""}`}
                  >
                    {offer.status === "pending"
                      ? now >= offer.expiresAt
                        ? "Expired"
                        : `${Math.ceil((offer.expiresAt - now) / 1000)}s`
                      : offer.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="activity" aria-labelledby="activity-title">
        <h2 id="activity-title">Recent activity</h2>
        <ol>
          {match.events
            .slice(-6)
            .reverse()
            .map((event) => (
              <li key={event.id}>
                <time dateTime={new Date(event.at).toISOString()}>
                  {new Date(event.at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                <span>{event.text}</span>
              </li>
            ))}
        </ol>
      </section>
    </aside>
  );
}
