import type { FastifyReply } from "fastify";
import type { MatchSnapshot } from "../../shared/contracts.ts";
import type { AuthStore, Session } from "../auth/auth-store.ts";
import { HttpError } from "./errors.ts";

/** Each delivery revalidates the session; no cached identity outlives logout. */
export class MatchStreams {
  private readonly entries = new Map<
    symbol,
    {
      sessionHash: string;
      matchId: string;
      send: () => void;
      close: () => void;
    }
  >();
  private readonly auth: AuthStore;
  private readonly snapshot: (id: string) => MatchSnapshot;
  constructor(auth: AuthStore, snapshot: (id: string) => MatchSnapshot) {
    this.auth = auth;
    this.snapshot = snapshot;
  }

  open(reply: FastifyReply, session: Session, matchId: string): void {
    if (
      this.entries.size >= 64 ||
      [...this.entries.values()].filter(
        (item) => item.sessionHash === session.idHash,
      ).length >= 3
    )
      throw new HttpError(
        "too_many_connections",
        429,
        "Close another match tab and try again.",
      );
    const initial = this.snapshot(matchId);
    if (!this.auth.getSessionByHash(session.idHash))
      throw new HttpError(
        "authentication_required",
        401,
        "Sign in to continue.",
      );
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders()))
      if (value !== undefined) reply.raw.setHeader(name, value);
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.flushHeaders();
    const key = Symbol("match-stream");
    let closed = false;
    let version = -1;
    let heartbeat = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      clearTimeout(expiry);
      this.entries.delete(key);
      reply.raw.end();
    };
    const send = (snapshot?: MatchSnapshot) => {
      if (closed) return;
      if (!this.auth.getSessionByHash(session.idHash)) {
        close();
        return;
      }
      try {
        const match = snapshot ?? this.snapshot(matchId);
        if (version !== match.version) {
          version = match.version;
          if (
            !reply.raw.write(
              `event: snapshot\ndata: ${JSON.stringify(match)}\n\n`,
            )
          )
            close();
        } else if (++heartbeat >= 15) {
          heartbeat = 0;
          if (!reply.raw.write(": connected\n\n")) close();
        }
      } catch {
        close();
      }
    };
    this.entries.set(key, {
      sessionHash: session.idHash,
      matchId,
      send,
      close,
    });
    reply.raw.once("close", close);
    send(initial);
    if (!closed) {
      timer = setInterval(send, 1_000);
      timer.unref();
      expiry = setTimeout(close, Math.max(1, session.expiresAt - Date.now()));
      expiry.unref();
    }
  }

  publish(matchId: string): void {
    for (const item of this.entries.values())
      if (item.matchId === matchId) item.send();
  }
  closeSession(hash: string): void {
    for (const item of [...this.entries.values()])
      if (item.sessionHash === hash) item.close();
  }
  close(): void {
    for (const item of [...this.entries.values()]) item.close();
  }
}
