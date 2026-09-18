import { io, type Socket as ClientSocket } from "socket.io-client";
import type { AppConfig } from "../src/server/config.ts";
import { realtimeEvents } from "../src/shared/protocol.ts";
import type {
  Ack,
  ClientToServerEvents,
  DeleteResult,
  PublishResult,
  RemoveResult,
  RoomSnapshot,
  ServerToClientEvents,
  SessionView,
} from "../src/shared/protocol.ts";

type Socket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

class CookieJar {
  readonly #cookies = new Map<string, string>();

  header(): string {
    return [...this.#cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  has(name: string): boolean {
    return this.#cookies.has(name);
  }

  async request(url: URL | string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.#cookies.size > 0) headers.set("cookie", this.header());
    const response = await fetch(url, { ...init, headers, redirect: "manual" });
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";");
      const equals = pair?.indexOf("=") ?? -1;
      if (equals < 1 || !pair) continue;
      const name = pair.slice(0, equals).trim();
      const value = pair.slice(equals + 1).trim();
      const deleted = attributes.some(
        (item) => item.trim().toLowerCase() === "max-age=0",
      );
      if (!value || deleted) this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
    return response;
  }
}

function status(response: Response, expected: number, step: string): void {
  if (response.status !== expected) {
    throw new Error(`${step} failed with ${response.status}`);
  }
}

function redirect(response: Response, base: string): URL {
  if (![302, 303, 307, 308].includes(response.status)) {
    throw new Error(`Expected redirect, received ${response.status}`);
  }
  const location = response.headers.get("location");
  if (!location) throw new Error("Redirect location is missing");
  return new URL(location, base);
}

function sameOrigin(response: Response, base: string): URL {
  const location = redirect(response, base);
  if (location.origin !== new URL(base).origin) {
    throw new Error("Redirect origin changed unexpectedly");
  }
  return location;
}

function formAction(html: string, base: string): URL {
  const action = html.match(/<form[^>]*action="([^"]+)"/u)?.[1];
  if (!action) throw new Error("IdP interaction form action is missing");
  const target = new URL(action.replaceAll("&amp;", "&"), base);
  if (target.origin !== new URL(base).origin) {
    throw new Error("IdP interaction form changed origin");
  }
  return target;
}

async function form(
  jar: CookieJar,
  target: URL,
  values: Record<string, string>,
): Promise<Response> {
  return jar.request(target, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
}

async function authenticatedSession(
  config: AppConfig,
  persona: "mei" | "kwame" | "yuki",
): Promise<{ app: CookieJar; session: SessionView }> {
  const app = new CookieJar();
  const issuer = new CookieJar();
  const started = await app.request(
    `${config.baseUrl}/auth/login?login_hint=${persona}`,
  );
  const authorization = redirect(started, config.baseUrl);
  if (authorization.origin !== new URL(config.issuer).origin) {
    throw new Error("Authorization endpoint changed origin");
  }
  const interaction = await issuer.request(authorization);
  const loginPage = await issuer.request(
    sameOrigin(interaction, config.issuer),
  );
  status(loginPage, 200, `${persona} login page`);
  const loginSubmission = await form(
    issuer,
    formAction(await loginPage.text(), config.issuer),
    { login: persona, password: "tutorial", prompt: "login" },
  );
  const loginResume = await issuer.request(
    sameOrigin(loginSubmission, config.issuer),
  );
  const consentPage = await issuer.request(
    sameOrigin(loginResume, config.issuer),
  );
  status(consentPage, 200, `${persona} consent page`);
  const consentSubmission = await form(
    issuer,
    formAction(await consentPage.text(), config.issuer),
    { prompt: "consent" },
  );
  const consentResume = await issuer.request(
    sameOrigin(consentSubmission, config.issuer),
  );
  const callbackUrl = redirect(consentResume, config.issuer);
  if (callbackUrl.origin !== new URL(config.baseUrl).origin) {
    throw new Error("OIDC callback changed application origin");
  }
  const callback = await app.request(callbackUrl);
  status(callback, 302, `${persona} OIDC callback`);
  if (!app.has("p9_session")) {
    throw new Error("Application callback did not rotate an opaque session");
  }
  const sessionResponse = await app.request(`${config.baseUrl}/api/session`);
  status(sessionResponse, 200, `${persona} application session`);
  const session = (await sessionResponse.json()) as SessionView;
  if (session.user.id !== `user-${persona}` || !session.csrfToken) {
    throw new Error(`${persona} identity was not mapped to the P9 session`);
  }
  return { app, session };
}

function connected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket timeout")), 5_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emit<T>(send: (ack: (result: Ack<T>) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    send((result) => {
      if (result.ok) resolve(result.value);
      else reject(new Error(result.error.code));
    });
  });
}

type ScenarioClient = Readonly<{
  session: SessionView;
  socket: Socket;
  enter(roomId: string, lastSequence?: number): Promise<RoomSnapshot>;
  publish(
    roomId: string,
    commandId: string,
    content: string,
  ): Promise<PublishResult>;
  remove(
    roomId: string,
    userId: string,
    commandId: string,
    expectedVersion: number,
  ): Promise<RemoveResult>;
  delete(
    roomId: string,
    messageId: string,
    commandId: string,
    expectedVersion: number,
  ): Promise<DeleteResult>;
  close(): void;
}>;

export async function openScenarioClient(
  config: AppConfig,
  persona: "mei" | "kwame" | "yuki",
): Promise<ScenarioClient> {
  const { app, session } = await authenticatedSession(config, persona);
  const ticketResponse = await app.request(
    `${config.baseUrl}/api/connection-ticket`,
    {
      method: "POST",
      headers: {
        origin: config.baseUrl,
        "sec-fetch-site": "same-origin",
        "x-csrf-token": session.csrfToken,
      },
    },
  );
  status(ticketResponse, 201, `${persona} connection ticket`);
  const ticket = (await ticketResponse.json()) as { ticket: string };
  const socket = io(config.baseUrl, {
    auth: { ticket: ticket.ticket },
    extraHeaders: { Cookie: app.header(), Origin: config.baseUrl },
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
  }) as Socket;
  await connected(socket);
  return {
    session,
    socket,
    enter: (roomId, lastSequence = 0) =>
      emit((ack) =>
        socket.emit(
          realtimeEvents.client.enterRoom,
          { roomId, lastSequence },
          ack,
        ),
      ),
    publish: (roomId, commandId, content) =>
      emit((ack) =>
        socket.emit(
          realtimeEvents.client.publishMessage,
          { roomId, commandId, content },
          ack,
        ),
      ),
    remove: (roomId, userId, commandId, expectedVersion) =>
      emit((ack) =>
        socket.emit(
          realtimeEvents.client.removeMember,
          { roomId, userId, commandId, expectedVersion },
          ack,
        ),
      ),
    delete: (roomId, messageId, commandId, expectedVersion) =>
      emit((ack) =>
        socket.emit(
          realtimeEvents.client.deleteMessage,
          { roomId, messageId, commandId, expectedVersion },
          ack,
        ),
      ),
    close: () => socket.disconnect(),
  };
}

export function nextEvent<Event extends keyof ServerToClientEvents>(
  socket: Socket,
  event: Event,
): Promise<Parameters<ServerToClientEvents[Event]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${event} timeout`)),
      5_000,
    );
    socket.once(event, ((value: Parameters<ServerToClientEvents[Event]>[0]) => {
      clearTimeout(timer);
      resolve(value);
    }) as never);
  });
}
