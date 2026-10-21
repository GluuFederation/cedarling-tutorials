import { type CSSProperties, type FormEvent, useState } from "react";
import type { MatchSnapshot, Preset } from "../shared/contracts";
import { ACCOUNTS, MAX_GAME_NAME_LENGTH } from "../shared/rules";
import type { CommandInput } from "./api";
import { Avatar } from "./Shell";

export function Login() {
  return (
    <main className="landing">
      <section className="login-panel" aria-labelledby="login-title">
        <h2 id="login-title">Choose a tutorial identity</h2>
        <nav className="account-choices" aria-label="Tutorial identities">
          {ACCOUNTS.map((account) => (
            <a
              key={account.id}
              className="account-choice"
              href={`/auth/login?login_hint=${account.id}`}
            >
              <Avatar name={account.name} />
              <strong>{account.name}</strong>
            </a>
          ))}
        </nav>
      </section>
    </main>
  );
}

export function Lobby({
  matches,
  actorId,
  busy,
  create,
  reload,
}: {
  matches: MatchSnapshot[];
  actorId: string;
  busy: boolean;
  create: (name: string, preset: Preset) => Promise<boolean>;
  reload: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<Preset>("normal");
  function submit(event: FormEvent) {
    event.preventDefault();
    void create(name.trim() || "Capital District", preset);
  }
  return (
    <main className="lobby">
      <section className="match-list">
        <div className="section-heading">
          <div>
            <h2>Games</h2>
            <p className="muted">Join a lobby or watch a game in progress.</p>
          </div>
          <button type="button" onClick={() => void reload()} disabled={busy}>
            Refresh
          </button>
        </div>
        {!matches.length && (
          <div className="empty">
            <p>Create a game and share its link with another player.</p>
          </div>
        )}
        <ul>
          {matches.map((match) => (
            <li key={match.id}>
              <a className="match-row" href={`#match/${match.id}`}>
                <span>
                  <strong>{match.name}</strong>
                  <small>
                    {match.preset === "practice"
                      ? "Practice position"
                      : "New game"}{" "}
                    · {match.players.map((player) => player.name).join(", ")}
                  </small>
                </span>
                <span className="match-row-end">
                  <span className="status">{match.status}</span>
                  <small>
                    {match.players.some((player) => player.actorId === actorId)
                      ? "Your seat is saved"
                      : `${match.players.length}/4 players`}
                  </small>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
      <section className="create-game">
        <h2>Start a game</h2>
        <form onSubmit={submit}>
          <label>
            Game name
            <input
              value={name}
              maxLength={MAX_GAME_NAME_LENGTH}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Capital District"
              disabled={busy}
            />
          </label>
          <fieldset className="preset-options">
            <legend>Starting position</legend>
            <label>
              <input
                type="radio"
                name="preset"
                value="normal"
                checked={preset === "normal"}
                onChange={() => setPreset("normal")}
                disabled={busy}
              />
              <span>
                <strong>New game</strong>
                <small>Start with 1,000 credits and an empty board.</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="preset"
                value="practice"
                checked={preset === "practice"}
                onChange={() => setPreset("practice")}
                disabled={busy}
              />
              <span>
                <strong>Practice position</strong>
                <small>
                  Seat 1 owns Harbor; seat 2 owns Market. Seat 1 starts in
                  Manage, ready to improve or trade. Each player has 1,000
                  credits.
                </small>
              </span>
            </label>
          </fieldset>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create lobby"}
          </button>
        </form>
        <p className="muted">
          Two to four human players. Each player signs in separately and opens
          the same game link.
        </p>
      </section>
    </main>
  );
}

export function WaitingRoom({
  match,
  actorId,
  busy,
  command,
}: {
  match: MatchSnapshot;
  actorId: string;
  busy: boolean;
  command: (command: CommandInput) => Promise<boolean>;
}) {
  const seated = match.players.some((player) => player.actorId === actorId);
  return (
    <main className="waiting-room">
      <section>
        <h2>{match.name}</h2>
        <p>
          Invite another player using this game’s link. Start when everyone has
          joined.
        </p>
        <ol className="seats">
          {match.players.map((player) => (
            <li key={player.id}>
              <span
                className="token"
                style={{ "--player-color": player.color } as CSSProperties}
              >
                {player.seat}
              </span>
              <strong>{player.name}</strong>
              <span>{player.actorId === match.hostId ? "Host" : "Player"}</span>
            </li>
          ))}
        </ol>
        {match.preset === "practice" && (
          <p className="practice-note">
            Practice position: seat 1 starts with Harbor and the current turn in
            Manage; seat 2 owns Market. All players start with 1,000 credits and
            no buildings.
          </p>
        )}
        <div className="button-row">
          {!seated && (
            <button
              type="button"
              className="primary"
              disabled={busy || match.players.length >= 4}
              onClick={() => void command({ type: "join", payload: {} })}
            >
              Join game
            </button>
          )}
          {seated && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void command({ type: "leave", payload: {} })}
            >
              Leave lobby
            </button>
          )}
          <button
            type="button"
            className="primary"
            disabled={busy || match.players.length < 2}
            onClick={() => void command({ type: "match.start", payload: {} })}
          >
            Start game
          </button>
        </div>
        <p className="muted">
          {match.players.length < 2
            ? "Waiting for a second player."
            : `${match.players.length} players are ready.`}{" "}
        </p>
      </section>
    </main>
  );
}
