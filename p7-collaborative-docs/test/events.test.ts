import { afterEach, describe, expect, it } from "vitest";
import { DocumentEvents, type EventSink } from "../src/server/events.ts";
import { documentEventKinds, streamReadyEvent } from "../src/shared/types.ts";

class Sink implements EventSink {
  readonly writes: string[] = [];
  ended = false;

  write(chunk: unknown): boolean {
    this.writes.push(String(chunk));
    return true;
  }

  end(): this {
    this.ended = true;
    return this;
  }
}

const hubs: DocumentEvents[] = [];

function eventHub(): DocumentEvents {
  const hub = new DocumentEvents();
  hubs.push(hub);
  return hub;
}

afterEach(() => {
  for (const hub of hubs.splice(0)) hub.close();
});

describe("document event delivery", () => {
  it("sends only bounded metadata after delivery authorization", async () => {
    const hub = eventHub();
    const sink = new Sink();
    hub.subscribe("doc-1", sink, async () => true);

    expect(sink.writes).toEqual([
      `event: ${streamReadyEvent}\ndata: {"documentId":"doc-1"}\n\n`,
    ]);

    await hub.publish({
      documentId: "doc-1",
      kind: documentEventKinds.updated,
    });

    expect(sink.writes[1]).toBe(
      `event: ${documentEventKinds.updated}\ndata: {"documentId":"doc-1","kind":"${documentEventKinds.updated}"}\n\n`,
    );
    expect(sink.writes.join("")).not.toContain("content");
  });

  it("closes a stream instead of delivering a denied event", async () => {
    const hub = eventHub();
    const sink = new Sink();
    hub.subscribe("doc-1", sink, async () => false);

    await hub.publish({
      documentId: "doc-1",
      kind: documentEventKinds.accessChanged,
    });

    expect(sink.ended).toBe(true);
    expect(sink.writes).toHaveLength(1);
  });

  it("reports capacity before a twenty-first subscription", () => {
    const hub = eventHub();
    for (let index = 0; index < 20; index += 1) {
      hub.subscribe("doc-1", new Sink(), async () => true);
    }

    expect(hub.hasCapacity("doc-1")).toBe(false);
    expect(hub.hasCapacity("doc-2")).toBe(true);
  });
});
