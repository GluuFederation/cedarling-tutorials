import { PaperPlane, X } from "./icons.tsx";
import { TransientNotice, type Notice } from "./TransientNotice.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { realtimeEvents } from "../shared/protocol.ts";
import type {
  Ack,
  ClientToServerEvents,
  DeleteResult,
  MemberView,
  MessageView,
  OperationOutcome,
  PublishResult,
  RemoveResult,
  RoomSnapshot,
  RoomView,
  ServerToClientEvents,
  SessionView,
} from "../shared/protocol.ts";
import { connectionTicket, loadSession, logout } from "./api.ts";
import {
  applyMembership,
  applyMessage,
  applySnapshot,
  emptyRoom,
  type RoomState,
} from "./room-state.ts";
import {
  BrandRail,
  LoadingShell,
  LoginShell,
  ProgramFooter,
} from "./shell.tsx";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 6;

class TransportFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportFailure";
  }
}

function emitWithAck<T>(
  socket: ChatSocket,
  operation: (ack: (result: Ack<T>) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("disconnect", onDisconnect);
      result();
    };
    const onDisconnect = () =>
      finish(() => reject(new TransportFailure("Connection interrupted")));
    const timer = window.setTimeout(
      () => finish(() => reject(new TransportFailure("Operation timed out"))),
      ACK_TIMEOUT_MS,
    );
    socket.once("disconnect", onDisconnect);
    operation((result) => {
      finish(() => {
        if (result.ok) resolve(result.value);
        else reject(new Error(result.error.code));
      });
    });
  });
}
const accounts = [
  { id: "mei", initials: "ME", name: "Mei", context: "Member" },
  { id: "kwame", initials: "KW", name: "Kwame", context: "Moderator" },
  { id: "yuki", initials: "YU", name: "Yuki", context: "Removed member" },
] as const;

function commandId(): string {
  return `cmd_${crypto.randomUUID()}`;
}

function Login(): React.JSX.Element {
  return (
    <LoginShell
      accounts={accounts}
      title="P9 - Securing Realtime Chat Rooms and Events with Cedarling"
      subtitle="Authorize every room and recipient at delivery time."
    />
  );
}

function Outcome({ value }: { value: OperationOutcome | undefined }) {
  if (!value) {
    return <p className="outcome muted">No protected effect yet.</p>;
  }
  return (
    <div
      className="outcome"
      role="status"
      aria-label="Latest authorization outcome"
    >
      <strong>{value.decision}</strong>
      <span>
        {value.capability} · {value.effect}
      </span>
      <code>{value.requestId}</code>
    </div>
  );
}

export default function App(): React.JSX.Element {
  const [session, setSession] = useState<SessionView>();
  const [loaded, setLoaded] = useState(false);
  const [connection, setConnection] = useState("connecting");
  const [rooms, setRooms] = useState<RoomView[]>([]);
  const [selected, setSelected] = useState<RoomView>();
  const [roomState, setRoomState] = useState<RoomState>({});
  const { members, messages } = selected
    ? (roomState[selected.id] ?? emptyRoom)
    : emptyRoom;
  const [roomId, setRoomId] = useState("room-a-general");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [memberDrawer, setMemberDrawer] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(
    "Connecting to chat…",
  );
  const dismissNotice = useCallback(() => setNotice(null), []);
  const showNotice = useCallback(
    (text: string, kind: Notice["kind"] = "success") =>
      setNotice({ text, kind }),
    [],
  );
  const operationPending = useRef(false);
  const [outcome, setOutcome] = useState<OperationOutcome>();
  const memberCloseRef = useRef<HTMLButtonElement>(null);
  const lastSequences = useRef(new Map<string, number>());
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const shouldReconnect = useRef(true);
  const activeSocket = useRef<ChatSocket | undefined>(undefined);
  const connectRef = useRef<(current: SessionView) => void>(() => undefined);
  const desiredRooms = useRef(new Set<string>());
  const reconnectAttempts = useRef(0);
  const pendingCommands = useRef(
    new Map<
      string,
      Readonly<{ commandId: string }> & Record<string, unknown>
    >(),
  );
  const acceptSnapshot = useCallback((snapshot: RoomSnapshot) => {
    setRooms((items) => {
      const index = items.findIndex((item) => item.id === snapshot.room.id);
      if (index < 0) return [...items, snapshot.room];
      const next = [...items];
      next[index] = snapshot.room;
      return next;
    });
    setRoomState((current) => applySnapshot(current, snapshot));
    const previous = lastSequences.current.get(snapshot.room.id) ?? 0;
    lastSequences.current.set(
      snapshot.room.id,
      Math.max(previous, snapshot.nextSequence),
    );
    setOutcome(snapshot.outcome);
  }, []);

  const replayRoom = useCallback(
    async (currentSocket: ChatSocket, target: string): Promise<RoomView> => {
      try {
        const snapshot = await emitWithAck<RoomSnapshot>(currentSocket, (ack) =>
          currentSocket.emit(
            realtimeEvents.client.enterRoom,
            {
              roomId: target,
              lastSequence: lastSequences.current.get(target) ?? 0,
              refresh: true,
            },
            ack,
          ),
        );
        if (activeSocket.current !== currentSocket)
          throw new Error("Connection changed during history refresh");
        acceptSnapshot(snapshot);
        return snapshot.room;
      } catch (error) {
        if (activeSocket.current === currentSocket) {
          setRoomState((current) => {
            const next = { ...current };
            delete next[target];
            return next;
          });
        }
        throw error;
      }
    },
    [acceptSnapshot],
  );

  const connect = useCallback(
    async (current: SessionView) => {
      const schedule = (reason: string) => {
        if (!shouldReconnect.current) return;
        const attempt = reconnectAttempts.current + 1;
        reconnectAttempts.current = attempt;
        if (attempt > MAX_RECONNECT_ATTEMPTS) {
          setConnection("unavailable");
          setConnectionNotice(`Realtime unavailable: ${reason}`);
          return;
        }
        setConnection("reconnecting");
        setConnectionNotice(`Reconnecting: ${reason}`);
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(
          () => connectRef.current(current),
          Math.min(500 * 2 ** (attempt - 1), 5_000),
        );
      };

      let next: ChatSocket | undefined;
      try {
        setConnection("connecting");
        const ticket = await connectionTicket(current.csrfToken);
        next = io({
          auth: { ticket },
          reconnection: false,
          transports: ["websocket", "polling"],
        }) as ChatSocket;
        const previous = activeSocket.current;
        activeSocket.current = next;
        previous?.disconnect();
        let reconnectScheduled = false;
        const fail = (reason: string) => {
          if (activeSocket.current !== next || reconnectScheduled) return;
          reconnectScheduled = true;
          activeSocket.current = undefined;
          next?.disconnect();
          schedule(reason);
        };
        const socket = next;
        next.on("connect", () => {
          void Promise.all(
            [...desiredRooms.current].map((id) => replayRoom(socket, id)),
          )
            .then(() => {
              if (activeSocket.current !== next) return;
              reconnectAttempts.current = 0;
              setConnection("connected");
              setConnectionNotice(null);
              showNotice("Realtime connection established");
            })
            .catch((error) =>
              fail(error instanceof Error ? error.message : "Recovery failed"),
            );
        });
        next.on("connect_error", (error) => fail(error.message));
        next.on("disconnect", (reason) => fail(`Disconnected: ${reason}`));
        next.on(realtimeEvents.server.messageCreated, (event) => {
          setRoomState((state) => applyMessage(state, event.message));
          const seen = lastSequences.current.get(event.message.roomId) ?? 0;
          lastSequences.current.set(
            event.message.roomId,
            Math.max(seen, event.message.sequence),
          );
          setOutcome(event.outcome);
          showNotice(`Message ${event.message.sequence} delivered`);
        });
        next.on(realtimeEvents.server.membershipRemoved, (event) => {
          setRoomState((state) =>
            applyMembership(state, event.roomId, event.membership),
          );
          if (event.membership.userId === current.user.id) {
            desiredRooms.current.delete(event.roomId);
            lastSequences.current.delete(event.roomId);
            setRooms((items) =>
              items.filter((item) => item.id !== event.roomId),
            );
            setSelected((value) =>
              value?.id === event.roomId ? undefined : value,
            );
            setMemberDrawer(false);
            showNotice(`Access to ${event.roomId} was removed`, "error");
          } else showNotice(`${event.membership.name} was removed`);
          setOutcome(event.outcome);
        });
        next.on(realtimeEvents.server.messageDeleted, (event) => {
          setRoomState((state) => applyMessage(state, event.message));
          setOutcome(event.outcome);
          showNotice(`Message ${event.message.sequence} was deleted`);
        });
        next.on(realtimeEvents.server.operationError, (error) => {
          if (
            ["session_revoked", "authentication_required"].includes(error.code)
          ) {
            shouldReconnect.current = false;
            setConnection("unavailable");
            setConnectionNotice(error.message);
          } else {
            showNotice(error.message, "error");
          }
        });
      } catch (error) {
        if (activeSocket.current === next) activeSocket.current = undefined;
        schedule(error instanceof Error ? error.message : "Connection failed");
      }
    },
    [replayRoom, showNotice],
  );
  connectRef.current = connect;

  useEffect(() => {
    shouldReconnect.current = true;
    void loadSession()
      .then((value) => {
        setLoaded(true);
        setSession(value);
        if (!value) return;
        setRooms([...value.rooms]);
        void connect(value);
      })
      .catch((error) => {
        setLoaded(true);
        showNotice(
          error instanceof Error ? error.message : "Session failed",
          "error",
        );
      });
    return () => {
      shouldReconnect.current = false;
      clearTimeout(reconnectTimer.current);
      activeSocket.current?.disconnect();
      activeSocket.current = undefined;
    };
  }, [connect, showNotice]);

  useEffect(() => {
    const resume = () => {
      if (!session || connection !== "unavailable" || !shouldReconnect.current)
        return;
      reconnectAttempts.current = 0;
      clearTimeout(reconnectTimer.current);
      void connectRef.current(session);
    };
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
  }, [session, connection]);

  useEffect(() => {
    if (!memberDrawer) return;
    const previous = document.activeElement;
    memberCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMemberDrawer(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [memberDrawer]);

  async function runCommand<
    Input extends Readonly<{ commandId: string }> & Record<string, unknown>,
    Result,
  >(
    key: string,
    create: () => Input,
    send: (input: Input) => Promise<Result>,
  ): Promise<Result> {
    const input =
      (pendingCommands.current.get(key) as Input | undefined) ?? create();
    pendingCommands.current.set(key, input);
    try {
      const result = await send(input);
      pendingCommands.current.delete(key);
      return result;
    } catch (error) {
      if (!(error instanceof TransportFailure))
        pendingCommands.current.delete(key);
      throw error;
    }
  }

  async function run(work: () => Promise<void>): Promise<void> {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "Operation failed",
        "error",
      );
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  }

  async function enter(target = roomId): Promise<void> {
    const currentSocket = activeSocket.current;
    if (!currentSocket) return;
    await run(async () => {
      const alreadyDesired = desiredRooms.current.has(target);
      desiredRooms.current.add(target);
      try {
        const entered = await replayRoom(currentSocket, target);
        setSelected(entered);
        setRoomId(target);
        showNotice("Room entered and history synchronized");
      } catch (error) {
        if (!alreadyDesired) desiredRooms.current.delete(target);
        throw error;
      }
    });
  }

  async function publish(): Promise<void> {
    const currentSocket = activeSocket.current;
    const targetRoom = selected;
    const content = draft;
    if (
      !currentSocket ||
      !targetRoom ||
      !content.trim() ||
      connection !== "connected"
    )
      return;
    await run(async () => {
      const result = await runCommand(
        `publish:${targetRoom.id}`,
        () => ({
          roomId: targetRoom.id,
          commandId: commandId(),
          content,
        }),
        (input) =>
          emitWithAck<PublishResult>(currentSocket, (ack) =>
            currentSocket.emit(
              realtimeEvents.client.publishMessage,
              input,
              ack,
            ),
          ),
      );
      setDraft((value) => (value === content ? "" : value));
      setOutcome(result.outcome);
      showNotice(
        result.duplicate
          ? "Message already saved; current state returned"
          : "Message persisted",
      );
    });
  }

  async function removeMember(member: MemberView): Promise<void> {
    const currentSocket = activeSocket.current;
    const targetRoom = selected;
    if (!currentSocket || !targetRoom) return;
    await run(async () => {
      const result = await runCommand(
        `remove:${targetRoom.id}:${member.userId}`,
        () => ({
          roomId: targetRoom.id,
          userId: member.userId,
          commandId: commandId(),
          expectedVersion: member.version,
        }),
        (input) =>
          emitWithAck<RemoveResult>(currentSocket, (ack) =>
            currentSocket.emit(realtimeEvents.client.removeMember, input, ack),
          ),
      );
      setOutcome(result.outcome);
    });
  }

  async function deleteMessage(message: MessageView): Promise<void> {
    const currentSocket = activeSocket.current;
    const targetRoom = selected;
    if (!currentSocket || !targetRoom) return;
    await run(async () => {
      const result = await runCommand(
        `delete:${targetRoom.id}:${message.id}`,
        () => ({
          roomId: targetRoom.id,
          messageId: message.id,
          commandId: commandId(),
          expectedVersion: message.version,
        }),
        (input) =>
          emitWithAck<DeleteResult>(currentSocket, (ack) =>
            currentSocket.emit(realtimeEvents.client.deleteMessage, input, ack),
          ),
      );
      setOutcome(result.outcome);
    });
  }

  if (!loaded) {
    return (
      <LoadingShell
        title="P9 - Securing Realtime Chat Rooms and Events with Cedarling"
        subtitle="Authorize every room and recipient at delivery time."
      />
    );
  }
  if (!session) return <Login />;

  return (
    <div className="app-shell">
      <BrandRail
        title="P9 - Securing Realtime Chat Rooms and Events with Cedarling"
        subtitle="Authorize every room and recipient at delivery time."
        identity={{
          initials: session.user.name.slice(0, 2).toUpperCase(),
          name: session.user.name,
          detail: session.authzMode,
        }}
        onSwitchAccount={() => {
          shouldReconnect.current = false;
          void logout(session.csrfToken).then(() => window.location.reload());
        }}
      />

      <main className="workspace">
        <aside className="room-rail" aria-label="Rooms">
          <div className="section-heading">
            <h2>Rooms</h2>
            <span className={`connection ${connection}`}>{connection}</span>
          </div>
          <nav>
            {rooms.map((room) => (
              <button
                type="button"
                className={selected?.id === room.id ? "room active" : "room"}
                onClick={() => void enter(room.id)}
                key={room.id}
                disabled={busy || connection !== "connected"}
              >
                <strong># {room.name}</strong>
                <small>{room.tenantId}</small>
              </button>
            ))}
          </nav>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void enter();
            }}
            className="room-id-form"
          >
            <label htmlFor="room-id">Enter by room ID</label>
            <input
              id="room-id"
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
            />
            <button
              className="secondary"
              type="submit"
              disabled={busy || connection !== "connected"}
            >
              Enter room
            </button>
          </form>
        </aside>

        <section className="conversation" aria-label="Selected room">
          <header className="conversation-header">
            <div>
              <p className="tenant-label">
                {selected?.tenantId ?? "No room selected"}
              </p>
              <h2>{selected ? `# ${selected.name}` : "Choose a room"}</h2>
              {selected && <small>Latest 100 messages</small>}
            </div>
            <button
              aria-controls="room-members"
              aria-expanded={memberDrawer}
              className="secondary members-toggle"
              type="button"
              onClick={() => setMemberDrawer(true)}
              disabled={!selected}
            >
              Members
            </button>
          </header>
          <ol className="timeline" aria-label="Message timeline">
            {!selected && (
              <li className="empty-state">
                Enter a room to load its persisted history.
              </li>
            )}
            {selected && messages.length === 0 && (
              <li className="empty-state">
                No messages yet. Start the conversation.
              </li>
            )}
            {messages.map((message) => (
              <li
                className={message.deleted ? "message deleted" : "message"}
                key={message.id}
              >
                <div>
                  <strong>{message.authorName}</strong>
                  <span>#{message.sequence}</span>
                </div>
                <p>{message.deleted ? "Message deleted" : message.content}</p>
                {!message.deleted && (
                  <button
                    className="text-danger"
                    type="button"
                    onClick={() => void deleteMessage(message)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ol>
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void publish();
            }}
          >
            <label className="sr-only" htmlFor="message">
              Message
            </label>
            <div className="composer-input">
              <textarea
                id="message"
                maxLength={4096}
                rows={2}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-describedby="message-keyboard-hint"
                onKeyDown={(event) => {
                  if (
                    event.key !== "Enter" ||
                    event.shiftKey ||
                    event.ctrlKey ||
                    event.altKey ||
                    event.metaKey ||
                    event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229
                  )
                    return;
                  event.preventDefault();
                  if (!event.repeat) void publish();
                }}
                placeholder="Write a message"
                disabled={!selected || busy || connection !== "connected"}
              />
              <button
                className="primary send-message"
                aria-label="Send message"
                title="Send message"
                type="submit"
                disabled={
                  !selected ||
                  !draft.trim() ||
                  busy ||
                  connection !== "connected"
                }
              >
                <PaperPlane size={20} aria-hidden="true" />
              </button>
            </div>
            <small id="message-keyboard-hint" className="composer-hint">
              Enter to send · Shift+Enter for a new line
            </small>
          </form>
        </section>

        <aside
          id="room-members"
          className={memberDrawer ? "member-panel open" : "member-panel"}
          aria-label="Room members"
        >
          <div className="section-heading">
            <h2>Members</h2>
            <button
              ref={memberCloseRef}
              className="icon-button"
              type="button"
              onClick={() => setMemberDrawer(false)}
              aria-label="Close members"
            >
              <X aria-hidden="true" size={18} weight="bold" />
            </button>
          </div>
          {!selected && <p className="muted">Select a room.</p>}
          {members.map((member) => (
            <article className="member" key={member.userId}>
              <span className="identity-avatar">
                {member.name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <strong>{member.name}</strong>
                <small>
                  {member.role} · {member.active ? "active" : "removed"} · v
                  {member.version}
                </small>
              </div>
              {member.active && member.userId !== session.user.id && (
                <button
                  className="text-danger"
                  type="button"
                  onClick={() => void removeMember(member)}
                  disabled={busy}
                >
                  Remove
                </button>
              )}
            </article>
          ))}
          <h3>Latest protected effect</h3>
          <Outcome value={outcome} />
        </aside>
      </main>

      <div className="status-strip">
        {connectionNotice ? (
          <p role="status">{connectionNotice}</p>
        ) : notice ? (
          <TransientNotice notice={notice} onDismiss={dismissNotice} />
        ) : null}
      </div>
      <ProgramFooter />
    </div>
  );
}
