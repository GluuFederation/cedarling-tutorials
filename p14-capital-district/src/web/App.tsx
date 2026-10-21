import { useEffect, useState } from "react";
import { Board } from "./Board";
import { GameSidebar } from "./GameSidebar";
import { Help } from "./Help";
import { Lobby, Login, WaitingRoom } from "./Lobby";
import { Modal } from "./Modal";
import { Footer, Header } from "./Shell";
import { NewTrade, OfferDetails } from "./Trades";
import { TurnControls } from "./TurnControls";
import { useGame } from "./useGame";

export default function App() {
  const game = useGame();
  const [help, setHelp] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [newTrade, setNewTrade] = useState(false);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [abandon, setAbandon] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const match = game.match;
  const user = game.session?.user;
  const disabled = game.busy || !!game.uncertain;
  const serverTime = match?.serverTime;
  const contextKey = `${match?.id ?? ""}:${user?.id ?? ""}`;
  useEffect(() => {
    const offset = serverTime ? serverTime - Date.now() : 0;
    setNow(Date.now() + offset);
    const timer = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(timer);
  }, [serverTime]);
  useEffect(() => {
    if (contextKey) {
      setSelected(null);
      setOfferId(null);
      setNewTrade(false);
      setAbandon(false);
    }
  }, [contextKey]);
  useEffect(() => {
    if (match?.pendingPropertyId) setSelected(match.pendingPropertyId);
  }, [match?.pendingPropertyId]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 3000);
    return () => clearTimeout(timer);
  }, [copied]);
  const currentOffer = match?.offers.find((offer) => offer.id === offerId);
  const feedback = (
    <>
      {game.busy && (
        <p className="notice pending" role="status">
          Processing request…
        </p>
      )}
      {game.notice && (
        <div
          className={`notice ${game.notice.kind}`}
          role={game.notice.kind === "error" ? "alert" : "status"}
        >
          <span>{game.notice.text}</span>
          {!game.uncertain && (
            <button
              className="text-button"
              type="button"
              onClick={game.dismissNotice}
            >
              Dismiss
            </button>
          )}
        </div>
      )}
      {game.uncertain && (
        <div className="recovery">
          {game.notice?.kind !== "error" && (
            <span>
              A previous request needs confirmation before you continue.
            </span>
          )}
          <button
            type="button"
            disabled={game.busy}
            onClick={() => void game.reload()}
          >
            Refresh board
          </button>
          <button
            type="button"
            className="primary"
            disabled={game.busy}
            onClick={() => void game.retry()}
          >
            Confirm previous request
          </button>
        </div>
      )}
    </>
  );
  return (
    <div className="app-shell">
      <Header
        user={user}
        busy={disabled}
        onHelp={() => setHelp(true)}
        onLogout={game.logout}
      />
      <div className="app-body">
        {game.loading ? (
          <main className="loading" aria-busy="true">
            Loading Capital District…
          </main>
        ) : game.loadingError ? (
          <main className="loading">
            <h2>Could not load the game</h2>
            <p role="alert">{game.loadingError}</p>
            <button type="button" onClick={() => void game.reload()}>
              Try again
            </button>
            <a href="#games">Back to games</a>
          </main>
        ) : !user ? (
          <Login />
        ) : (
          <>
            {match && (
              <div className="match-toolbar">
                <a href="#games">All games</a>
                <strong>{match.name}</strong>
                <div className="toolbar-actions">
                  <span
                    className={`connection ${game.connection === "Connected" ? "connected" : ""}`}
                  >
                    {game.connection}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(window.location.href)
                        .then(() => setCopied(true))
                        .catch(() => setCopied(false));
                    }}
                  >
                    {copied ? "Link copied" : "Copy game link"}
                  </button>
                  <details className="match-menu">
                    <summary>Game options</summary>
                    <div>
                      <button
                        type="button"
                        onClick={() => void game.reload()}
                        disabled={game.busy}
                      >
                        Refresh game
                      </button>
                      {["lobby", "running"].includes(match.status) && (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => setAbandon(true)}
                        >
                          Abandon game
                        </button>
                      )}
                    </div>
                  </details>
                </div>
              </div>
            )}
            <div className="feedback-area">
              {!newTrade && !currentOffer && !abandon && feedback}
            </div>
            {!match ? (
              <Lobby
                matches={game.matches}
                actorId={user.id}
                busy={disabled}
                create={game.create}
                reload={game.reload}
              />
            ) : match.status === "lobby" ? (
              <WaitingRoom
                match={match}
                actorId={user.id}
                busy={disabled}
                command={game.command}
              />
            ) : (
              <main className="game-workspace" aria-busy={game.busy}>
                <section className="board-area" aria-label="Game table">
                  <Board match={match} selected={selected} select={setSelected}>
                    <TurnControls
                      match={match}
                      busy={disabled}
                      command={game.command}
                    />
                  </Board>
                </section>
                <GameSidebar
                  match={match}
                  selected={selected}
                  busy={disabled}
                  command={game.command}
                  actorId={user.id}
                  now={now}
                  select={setSelected}
                  onNewTrade={() => setNewTrade(true)}
                  onOffer={setOfferId}
                />
              </main>
            )}
          </>
        )}
      </div>
      <Footer />
      {help && <Help onClose={() => setHelp(false)} />}
      {newTrade && match && user && (
        <NewTrade
          match={match}
          actorId={user.id}
          busy={disabled}
          command={game.command}
          onClose={() => setNewTrade(false)}
          recovery={feedback}
        />
      )}
      {currentOffer && match && (
        <OfferDetails
          match={match}
          offer={currentOffer}
          now={now}
          busy={disabled}
          command={game.command}
          onClose={() => setOfferId(null)}
          recovery={feedback}
        />
      )}
      {abandon && match && (
        <Modal
          title="Abandon this game?"
          busy={disabled}
          onClose={() => setAbandon(false)}
        >
          {feedback}
          <p>
            The game ends for everyone, without a winner. The board remains
            available to view.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setAbandon(false)}
            >
              Keep playing
            </button>
            <button
              type="button"
              className="danger"
              disabled={disabled}
              onClick={() =>
                void game
                  .command({ type: "match.abandon", payload: {} })
                  .then((saved) => {
                    if (saved) setAbandon(false);
                  })
              }
            >
              Abandon game
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
