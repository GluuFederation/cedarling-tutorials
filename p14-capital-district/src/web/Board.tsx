import type { CSSProperties, ReactNode } from "react";
import { BOARD } from "../shared/catalog";
import type { MatchSnapshot } from "../shared/contracts";
import { credits, ringPosition } from "./format";

export function Board({
  match,
  selected,
  select,
  children,
}: {
  match: MatchSnapshot;
  selected: string | null;
  select: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <section
      className="board-scroll"
      aria-label="Game board. Scroll to see every space."
    >
      <div className="board">
        {BOARD.map((cell) => {
          const property = match.properties.find(
            (entry) => entry.id === cell.id,
          );
          const owner = match.players.find(
            (player) => player.id === property?.ownerId,
          );
          const visitors = match.players.filter(
            (player) => player.position === cell.index,
          );
          return (
            <button
              type="button"
              key={cell.id}
              className={`board-cell ${cell.kind} ${selected === cell.id ? "selected" : ""} ${match.pendingPropertyId === cell.id ? "landing" : ""}`}
              style={
                {
                  ...ringPosition(cell.index),
                  "--group-color": cell.color ?? "#e4ece9",
                } as CSSProperties
              }
              aria-label={`${cell.index}. ${cell.name}${owner ? `, owned by ${owner.name}` : property ? ", unowned" : ""}${property?.level ? `, level ${property.level}` : ""}${visitors.length ? `, ${visitors.map((player) => player.name).join(", ")} here` : ""}`}
              aria-pressed={selected === cell.id}
              onClick={() => select(cell.id)}
            >
              <span className="cell-number">{cell.index}</span>
              <span className="cell-name">{cell.name}</span>
              {cell.price > 0 && (
                <span className="cell-price">{credits(cell.price)}</span>
              )}
              {owner && (
                <span
                  className="owner-mark"
                  style={{ "--player-color": owner.color } as CSSProperties}
                  title={`Owned by ${owner.name}`}
                >
                  {owner.seat}
                </span>
              )}
              {!!property?.level && (
                <span
                  className="cell-level"
                  title={`${property.level} building levels`}
                >
                  L{property.level}
                </span>
              )}
              <span className="tokens">
                {visitors.map((player) => (
                  <span
                    className="token"
                    title={player.name}
                    key={player.id}
                    style={{ "--player-color": player.color } as CSSProperties}
                  >
                    {player.seat}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
        <div className="board-center">{children}</div>
      </div>
    </section>
  );
}

export function Dice({ values }: { values: [number, number] }) {
  const positions = [
    [5, 5],
    [12, 5],
    [19, 5],
    [5, 12],
    [12, 12],
    [19, 12],
    [5, 19],
    [12, 19],
    [19, 19],
  ] as const;
  const faces: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  return (
    <div
      className="dice"
      role="img"
      aria-label={`Last roll: ${values[0]} and ${values[1]}, total ${values[0] + values[1]}`}
    >
      {[
        { id: "first", value: values[0] },
        { id: "second", value: values[1] },
      ].map(({ id, value }) => (
        <svg viewBox="0 0 24 24" key={id} aria-hidden="true">
          <rect x=".5" y=".5" width="23" height="23" rx="4" />
          {faces[value]?.map((point) => (
            <circle
              key={point}
              cx={positions[point]?.[0]}
              cy={positions[point]?.[1]}
              r="1.5"
            />
          ))}
        </svg>
      ))}
    </div>
  );
}
