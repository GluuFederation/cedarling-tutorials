import { createServer, type Server as HttpServer } from "node:http";
import {
  io as createClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Ack,
  ClientToServerEvents,
  ServerToClientEvents,
} from "../src/shared/protocol.ts";
import { attachRealtime } from "../src/server/realtime.ts";
import { createHarness } from "./harness.ts";

type Socket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
type ClientEvent = keyof ClientToServerEvents;
type ServerEvent = keyof ServerToClientEvents;
type ClientInput<Event extends ClientEvent> = Parameters<
  ClientToServerEvents[Event]
>[0];
type ClientResult<Event extends ClientEvent> = Parameters<
  ClientToServerEvents[Event]
>[1] extends (result: Ack<infer Result>) => void
  ? Result
  : never;
type ServerResult<Event extends ServerEvent> = Parameters<
  ServerToClientEvents[Event]
>[0];

async function listening(server: HttpServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  return address.port;
}

function connected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket timeout")), 3_000);
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

function event<Event extends ServerEvent>(
  socket: Socket,
  name: Event,
): Promise<ServerResult<Event>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} timeout`)), 3_000);
    const receive = (value: ServerResult<Event>) => {
      clearTimeout(timer);
      resolve(value);
    };
    socket.once(name, receive as never);
  });
}

function emit<Event extends ClientEvent>(
  socket: Socket,
  name: Event,
  payload: ClientInput<Event>,
): Promise<ClientResult<Event>> {
  return new Promise((resolve, reject) => {
    const receive = (result: Ack<ClientResult<Event>>) => {
      if (result.ok) resolve(result.value);
      else reject(new Error(result.error.code));
    };
    const send = socket.emit.bind(socket) as (
      event: Event,
      input: ClientInput<Event>,
      ack: (result: Ack<ClientResult<Event>>) => void,
    ) => Socket;
    send(name, payload, receive);
  });
}

afterEach(() => vi.restoreAllMocks());

describe("Socket.IO authorization boundaries", () => {
  it("reproduces only the three marked permissive gaps through live clients", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const harness = createHarness();
    const server = createServer();
    const port = await listening(server);
    const baseUrl = `http://127.0.0.1:${port}`;
    const config = { ...harness.config, baseUrl };
    const realtime = attachRealtime(server, {
      config,
      chat: harness.database.chat,
      sessions: harness.sessions,
      authorization: harness.authorization,
    });
    const clients: Socket[] = [];

    async function client(userId: string): Promise<Socket> {
      const created = harness.session(userId);
      const session = harness.sessions.getSession(created.rawId, config);
      const ticket = harness.sessions.createTicket(session?.idHash ?? "");
      const socket = createClient(baseUrl, {
        auth: { ticket: ticket.ticket },
        extraHeaders: { Origin: baseUrl },
        forceNew: true,
        reconnection: false,
        transports: ["websocket"],
      }) as Socket;
      clients.push(socket);
      await connected(socket);
      return socket;
    }

    try {
      const mei = await client("user-mei");
      const kwame = await client("user-kwame");
      const yuki = await client("user-yuki");
      for (const socket of [mei, kwame, yuki]) {
        await emit(socket, "room:enter", {
          roomId: "room-a-general",
          lastSequence: 0,
        });
      }

      const restricted = await emit(mei, "room:enter", {
        roomId: "room-a-restricted",
        lastSequence: 0,
      });
      const crossTenant = await emit(mei, "room:enter", {
        roomId: "room-b-general",
        lastSequence: 0,
      });
      expect(restricted.outcome.decision).toBe("FAKE ALLOW");
      expect(crossTenant.room.tenantId).toBe("tenant-b");

      const firstDelivery = event(yuki, "message:created");
      const first = await emit(mei, "message:publish", {
        roomId: "room-a-general",
        commandId: "scenario_publish_1",
        content: "positive delivery",
      });
      expect((await firstDelivery).message.id).toBe(first.message.id);

      await emit(kwame, "member:remove", {
        roomId: "room-a-general",
        userId: "user-yuki",
        commandId: "scenario_remove_1",
        expectedVersion: 1,
      });
      const staleDelivery = event(yuki, "message:created");
      await emit(mei, "message:publish", {
        roomId: "room-a-general",
        commandId: "scenario_publish_2",
        content: "delivered after removal",
      });
      expect((await staleDelivery).message.content).toBe(
        "delivered after removal",
      );

      const moderatorMessage = await emit(kwame, "message:publish", {
        roomId: "room-a-general",
        commandId: "scenario_publish_3",
        content: "moderator-owned",
      });
      const removedModerator = await emit(mei, "member:remove", {
        roomId: "room-a-general",
        userId: "user-kwame",
        commandId: "scenario_remove_2",
        expectedVersion: 1,
      });
      expect(removedModerator.membership.active).toBe(false);
      const deletion = await emit(mei, "message:delete", {
        roomId: "room-a-general",
        messageId: moderatorMessage.message.id,
        commandId: "scenario_delete_1",
        expectedVersion: 1,
      });
      expect(deletion.message.deleted).toBe(true);
      await expect(
        emit(mei, "message:delete", {
          roomId: "room-a-general",
          messageId: moderatorMessage.message.id,
          commandId: "scenario_delete_stale",
          expectedVersion: 1,
        }),
      ).rejects.toThrow("message_already_deleted");

      const retry = await emit(mei, "message:publish", {
        roomId: "room-a-general",
        commandId: "scenario_publish_2",
        content: "delivered after removal",
      });
      expect(retry.duplicate).toBe(true);
      await expect(
        emit(mei, "message:publish", {
          roomId: "room-a-general",
          commandId: "scenario_publish_2",
          content: "same key, different request",
        }),
      ).rejects.toThrow("command_id_reused");

      const unknown = event(mei, "operation:error");
      const emitUnknown = mei.emit.bind(mei) as (
        name: string,
        payload: unknown,
      ) => void;
      emitUnknown("unknown:event", {});
      expect((await unknown).code).toBe("unknown_event");

      for (let index = 0; index < 8; index += 1) {
        await emit(mei, "message:publish", {
          roomId: "room-a-general",
          commandId: `scenario_rate_${index}`,
          content: `bounded rate ${index}`,
        });
      }
      await expect(
        emit(mei, "message:publish", {
          roomId: "room-a-general",
          commandId: "scenario_rate_rejected",
          content: "one message too many",
        }),
      ).rejects.toThrow("rate_limited");

      yuki.disconnect();
      const yukiReconnected = await client("user-yuki");
      const replay = await emit(yukiReconnected, "room:enter", {
        roomId: "room-a-general",
        lastSequence: first.message.sequence,
      });
      expect(replay.replayed).toBe(true);
      expect(new Set(replay.messages.map((message) => message.id)).size).toBe(
        replay.messages.length,
      );
    } finally {
      for (const client of clients) client.disconnect();
      await realtime.close();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      harness.close();
    }
  });

  it("rejects ticket replay, wrong origins, and unavailable authorization", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const harness = createHarness("unavailable");
    const server = createServer();
    const port = await listening(server);
    const baseUrl = `http://127.0.0.1:${port}`;
    const config = { ...harness.config, baseUrl };
    const realtime = attachRealtime(server, {
      config,
      chat: harness.database.chat,
      sessions: harness.sessions,
      authorization: harness.authorization,
    });
    const created = harness.session("user-mei");
    const session = harness.sessions.getSession(created.rawId, config);
    const ticket = harness.sessions.createTicket(session?.idHash ?? "");
    const first = createClient(baseUrl, {
      auth: { ticket: ticket.ticket },
      extraHeaders: { Origin: baseUrl },
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    }) as Socket;
    try {
      await expect(connected(first)).rejects.toThrow(
        "authorization_unavailable",
      );
      const replay = createClient(baseUrl, {
        auth: { ticket: ticket.ticket },
        extraHeaders: { Origin: baseUrl },
        forceNew: true,
        reconnection: false,
        transports: ["websocket"],
      }) as Socket;
      await expect(connected(replay)).rejects.toThrow(
        "invalid_connection_ticket",
      );
      replay.disconnect();

      const fresh = harness.sessions.createTicket(session?.idHash ?? "");
      const wrongOrigin = createClient(baseUrl, {
        auth: { ticket: fresh.ticket },
        extraHeaders: { Origin: "http://attacker.invalid" },
        forceNew: true,
        reconnection: false,
        transports: ["websocket"],
      }) as Socket;
      await expect(connected(wrongOrigin)).rejects.toThrow();
      wrongOrigin.disconnect();
    } finally {
      first.disconnect();
      await realtime.close();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      harness.close();
    }
  });
});
