import type { CSSProperties } from "react";
import { BOARD } from "../shared/catalog";
import type { MatchSnapshot } from "../shared/contracts";
import type { CommandInput } from "./api";
import { credits, playerName } from "./format";

export function Deed({
  match,
  selected,
  busy,
  command,
}: {
  match: MatchSnapshot;
  selected: string | null;
  busy: boolean;
  command: (command: CommandInput) => Promise<boolean>;
}) {
  const cell = BOARD.find((entry) => entry.id === selected);
  const property = match.properties.find((entry) => entry.id === selected);
  const active = match.players.find(
    (player) => player.id === match.activeSeatId,
  );
  if (!cell)
    return (
      <section className="deed empty-deed">
        <h2>Property deed</h2>
        <p className="muted">
          Select a space to see its owner, rent, and improvements.
        </p>
      </section>
    );
  const groupMembers = BOARD.filter(
    (entry) => entry.group && entry.group === cell.group,
  );
  const lowestLevel = Math.min(
    ...groupMembers.map(
      (entry) =>
        match.properties.find((value) => value.id === entry.id)?.level ?? 0,
    ),
  );
  const buildReason =
    !active || match.status !== "running" || match.phase !== "Manage"
      ? "Improvements happen in Manage."
      : (property?.level ?? 0) >= 3
        ? "Maximum level reached."
        : (property?.level ?? 0) !== lowestLevel
          ? "Improve a lower-level property in this group first."
          : active.cash < cell.buildingCost
            ? `${active.name} needs ${credits(cell.buildingCost)} credits.`
            : "";
  return (
    <section className="deed">
      <div
        className="deed-title"
        style={{ "--group-color": cell.color ?? "#c3d2ce" } as CSSProperties}
      >
        <span className="group-swatch" aria-hidden="true" />
        <div>
          <small>
            {cell.group ??
              (cell.kind === "service" ? "Service" : "Public space")}{" "}
            · Space {cell.index}
          </small>
          <h2>{cell.name}</h2>
        </div>
      </div>
      {cell.kind === "neutral" ? (
        <p className="muted">
          {cell.index === 0
            ? "Passing or landing here grants 200 credits. Starting here grants nothing."
            : "Take a break. This space has no landing payment."}
        </p>
      ) : (
        <>
          <dl className="deed-facts">
            <div>
              <dt>Owner</dt>
              <dd>{playerName(match, property?.ownerId ?? null)}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{credits(cell.price)}</dd>
            </div>
            <div>
              <dt>Rent</dt>
              <dd>
                {credits(cell.baseRent * (1 + 2 * (property?.level ?? 0)))}
              </dd>
            </div>
            {cell.kind === "property" && (
              <div>
                <dt>Buildings</dt>
                <dd>{property?.level ?? 0} / 3</dd>
              </div>
            )}
          </dl>
          {cell.kind === "property" && (
            <div className="deed-build">
              <button
                type="button"
                disabled={busy || !!buildReason}
                onClick={() =>
                  active &&
                  void command({
                    type: "property.build",
                    payload: { seatId: active.id, propertyId: cell.id },
                  })
                }
              >
                Improve for {credits(cell.buildingCost)}
              </button>
              <small>
                {buildReason ||
                  `${active?.name ?? "Active player"} pays. Adds one building level.`}
              </small>
            </div>
          )}
        </>
      )}
    </section>
  );
}
