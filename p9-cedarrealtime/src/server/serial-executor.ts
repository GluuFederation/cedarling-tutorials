import { limits } from "./config.ts";
import { DomainError } from "./errors.ts";

type Lane = { tail: Promise<void>; pending: number };

export class RoomSerialExecutor {
  readonly #lanes = new Map<string, Lane>();

  async run<T>(roomId: string, work: () => T | Promise<T>): Promise<T> {
    const lane = this.#lanes.get(roomId) ?? {
      tail: Promise.resolve(),
      pending: 0,
    };
    if (lane.pending >= limits.roomQueue) {
      throw new DomainError("room_queue_full", 503);
    }
    lane.pending += 1;
    this.#lanes.set(roomId, lane);
    const previous = lane.tail;
    let release: () => void = () => undefined;
    lane.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      lane.pending -= 1;
      release();
      if (lane.pending === 0) this.#lanes.delete(roomId);
    }
  }
}
