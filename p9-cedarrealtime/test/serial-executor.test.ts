import { describe, expect, it } from "vitest";
import { limits } from "../src/server/config.ts";
import { RoomSerialExecutor } from "../src/server/serial-executor.ts";

describe("per-room ordering and backpressure", () => {
  it("serializes effects and rejects work beyond the queue bound", async () => {
    const executor = new RoomSerialExecutor();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const observed: number[] = [];
    const pending = Array.from({ length: limits.roomQueue }, (_, index) =>
      executor.run("room-a-general", async () => {
        if (index === 0) await gate;
        observed.push(index);
      }),
    );
    await expect(
      executor.run("room-a-general", () => undefined),
    ).rejects.toThrow("room_queue_full");
    release();
    await Promise.all(pending);
    expect(observed).toEqual(
      Array.from({ length: limits.roomQueue }, (_, index) => index),
    );
  });
});
