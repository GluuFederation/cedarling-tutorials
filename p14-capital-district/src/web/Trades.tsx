import { type FormEvent, type ReactNode, useState } from "react";
import { BOARD } from "../shared/catalog";
import type {
  MatchSnapshot,
  TradeOffer,
  TradeTerms,
} from "../shared/contracts";
import { MAX_TRADE_CASH, MAX_TRADE_PROPERTIES } from "../shared/rules";
import type { CommandInput } from "./api";
import { credits, playerName, propertyName } from "./format";
import { Modal } from "./Modal";

interface Props {
  match: MatchSnapshot;
  busy: boolean;
  command: (command: CommandInput) => Promise<boolean>;
  onClose: () => void;
  recovery?: ReactNode;
}

function PropertyPicker({
  title,
  selected,
  excluded,
  onChange,
  match,
}: {
  title: string;
  selected: string[];
  excluded: string[];
  onChange: (values: string[]) => void;
  match: MatchSnapshot;
}) {
  return (
    <fieldset className="property-picker">
      <legend>
        {title}{" "}
        <small className="picker-limit">Up to {MAX_TRADE_PROPERTIES}</small>
      </legend>
      <div className="property-options">
        {BOARD.filter((cell) => cell.kind !== "neutral").map((cell) => {
          const property = match.properties.find(
            (entry) => entry.id === cell.id,
          );
          const checked = selected.includes(cell.id);
          return (
            <label key={cell.id}>
              <input
                type="checkbox"
                checked={checked}
                disabled={
                  excluded.includes(cell.id) ||
                  (!checked && selected.length >= MAX_TRADE_PROPERTIES)
                }
                onChange={() =>
                  onChange(
                    checked
                      ? selected.filter((id) => id !== cell.id)
                      : [...selected, cell.id],
                  )
                }
              />
              <span>
                <strong>{cell.name}</strong>
                <small>
                  {playerName(match, property?.ownerId ?? null)} · Level{" "}
                  {property?.level ?? 0}
                </small>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function NewTrade({
  match,
  busy,
  command,
  onClose,
  actorId,
  recovery,
}: Props & { actorId: string }) {
  const self =
    match.players.find((player) => player.actorId === actorId) ??
    match.players[0];
  const other = match.players.find((player) => player.id !== self?.id);
  const [terms, setTerms] = useState<TradeTerms>({
    senderId: self?.id ?? "",
    recipientId: other?.id ?? "",
    senderProperties: [],
    recipientProperties: [],
    senderCash: 0,
    recipientCash: 0,
  });
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !terms.senderProperties.length &&
      !terms.recipientProperties.length &&
      terms.senderCash === 0 &&
      terms.recipientCash === 0
    ) {
      setError("Include a property or a cash payment.");
      return;
    }
    setError("");
    if (!confirm) {
      setConfirm(true);
      return;
    }
    void command({ type: "trade.offer", payload: terms }).then((saved) => {
      if (saved) onClose();
    });
  }
  return (
    <Modal
      title={confirm ? "Confirm trade offer" : "Make a trade offer"}
      busy={busy}
      onClose={onClose}
    >
      {recovery}
      <form onSubmit={submit}>
        <p className="muted">
          Offers last 120 seconds. Property and cash stay available until
          someone accepts.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {confirm ? (
          <>
            <TradeSides match={match} terms={terms} />
            <p className="muted">
              Buildings transfer at their current level when accepted.
            </p>
          </>
        ) : (
          <div className="trade-columns">
            {(["sender", "recipient"] as const).map((side) => {
              const idKey = side === "sender" ? "senderId" : "recipientId";
              const propertiesKey =
                side === "sender" ? "senderProperties" : "recipientProperties";
              const otherProperties =
                side === "sender"
                  ? terms.recipientProperties
                  : terms.senderProperties;
              const cashKey =
                side === "sender" ? "senderCash" : "recipientCash";
              const otherId =
                side === "sender" ? terms.recipientId : terms.senderId;
              return (
                <section key={side} className="trade-side">
                  <h3>
                    {side === "sender" ? "Sender gives" : "Recipient gives"}
                  </h3>
                  <label>
                    Player
                    <select
                      value={terms[idKey]}
                      onChange={(event) => {
                        const id = event.currentTarget.value;
                        setTerms({
                          ...terms,
                          [idKey]: id,
                          ...(id === otherId
                            ? {
                                [side === "sender"
                                  ? "recipientId"
                                  : "senderId"]: terms[idKey],
                              }
                            : {}),
                        });
                      }}
                    >
                      {match.players.map((player) => (
                        <option value={player.id} key={player.id}>
                          {player.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Cash
                    <input
                      type="number"
                      min={0}
                      max={MAX_TRADE_CASH}
                      step={1}
                      value={terms[cashKey]}
                      onChange={(event) =>
                        setTerms({
                          ...terms,
                          [cashKey]: Number(event.currentTarget.value),
                        })
                      }
                      required
                    />
                  </label>
                  <PropertyPicker
                    title="Properties"
                    match={match}
                    selected={terms[propertiesKey]}
                    excluded={otherProperties}
                    onChange={(values) =>
                      setTerms({ ...terms, [propertiesKey]: values })
                    }
                  />
                </section>
              );
            })}
          </div>
        )}
        <div className="dialog-actions">
          {confirm && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Edit offer
            </button>
          )}
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Saving…" : confirm ? "Send offer" : "Review offer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TradeSides({
  match,
  terms,
}: {
  match: MatchSnapshot;
  terms: TradeTerms;
}) {
  return (
    <div className="trade-columns trade-summary">
      {(["sender", "recipient"] as const).map((side) => {
        const playerId = side === "sender" ? terms.senderId : terms.recipientId;
        const properties =
          side === "sender"
            ? terms.senderProperties
            : terms.recipientProperties;
        const cash = side === "sender" ? terms.senderCash : terms.recipientCash;
        return (
          <section key={side}>
            <h3>{playerName(match, playerId)} gives</h3>
            <p>{credits(cash)} credits</p>
            <ul>
              {properties.map((id) => {
                const property = match.properties.find(
                  (entry) => entry.id === id,
                );
                return (
                  <li key={id}>
                    <strong>{propertyName(id)}</strong>
                    <small>
                      Owner: {playerName(match, property?.ownerId ?? null)} ·
                      Level {property?.level ?? 0}
                    </small>
                  </li>
                );
              })}
            </ul>
            {!properties.length && <p className="muted">No property</p>}
          </section>
        );
      })}
    </div>
  );
}

export function OfferDetails({
  match,
  offer,
  now,
  busy,
  command,
  onClose,
  recovery,
}: Props & { offer: TradeOffer; now: number }) {
  const expired = offer.status === "pending" && offer.expiresAt <= now;
  const pending = offer.status === "pending" && match.status === "running";
  const blockedLanding =
    match.phase === "PurchaseDecision" &&
    [...offer.senderProperties, ...offer.recipientProperties].includes(
      match.pendingPropertyId ?? "",
    );
  const affordable = match.players.every(
    (player) =>
      (player.id !== offer.senderId ||
        offer.senderCash === 0 ||
        player.cash >= offer.senderCash) &&
      (player.id !== offer.recipientId ||
        offer.recipientCash === 0 ||
        player.cash >= offer.recipientCash),
  );
  const [accepting, setAccepting] = useState(false);
  function act(type: "trade.accept" | "trade.reject" | "trade.cancel") {
    if (type === "trade.accept" && !accepting) {
      setAccepting(true);
      return;
    }
    void command({ type, payload: { offerId: offer.id } }).then((saved) => {
      if (saved) onClose();
    });
  }
  return (
    <Modal
      title={accepting ? "Confirm this exchange" : "Trade offer"}
      busy={busy}
      onClose={onClose}
    >
      {recovery}
      <p className="offer-deadline">
        <span className={`status ${expired ? "expired" : ""}`}>
          {expired ? "Expired" : offer.status}
        </span>{" "}
        Deadline: {new Date(offer.expiresAt).toLocaleTimeString()}
      </p>
      <TradeSides match={match} terms={offer} />
      <p className="muted">
        These are the current owners and building levels. Accepting exchanges
        the listed assets and cash together.
      </p>
      {blockedLanding && (
        <p className="form-error">
          Finish the pending Buy/Pass decision before exchanging this property.
        </p>
      )}
      {!affordable && (
        <p className="form-error">
          A player does not have enough cash for their payment.
        </p>
      )}
      {pending && (
        <div className="dialog-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => act("trade.cancel")}
          >
            Cancel for {playerName(match, offer.senderId)}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act("trade.reject")}
          >
            Reject for {playerName(match, offer.recipientId)}
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || blockedLanding || !affordable}
            onClick={() => act("trade.accept")}
          >
            {accepting
              ? "Confirm exchange"
              : `Accept for ${playerName(match, offer.recipientId)}`}
          </button>
        </div>
      )}
    </Modal>
  );
}
