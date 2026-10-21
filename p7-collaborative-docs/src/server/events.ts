import { type DocumentEvent, streamReadyEvent } from "../shared/types.ts";

export type EventSink = {
  write(chunk: string): unknown;
  end(): unknown;
};

type Subscription = Readonly<{
  response: EventSink;
  canObserve: (event: DocumentEvent) => Promise<boolean>;
}>;

export class DocumentEvents {
  private readonly byDocument = new Map<string, Set<Subscription>>();
  private readonly heartbeat: NodeJS.Timeout;
  private closed = false;

  constructor() {
    this.heartbeat = setInterval(() => {
      for (const subscriptions of this.byDocument.values()) {
        for (const subscription of subscriptions) {
          subscription.response.write(": keep-alive\n\n");
        }
      }
    }, 20_000);
    this.heartbeat.unref();
  }

  hasCapacity(documentId: string): boolean {
    return !this.closed && (this.byDocument.get(documentId)?.size ?? 0) < 20;
  }

  subscribe(
    documentId: string,
    response: EventSink,
    canObserve: (event: DocumentEvent) => Promise<boolean>,
  ): () => void {
    if (this.closed) {
      response.end();
      return () => {};
    }
    const subscriptions = this.byDocument.get(documentId) ?? new Set();
    const subscription = { response, canObserve };
    subscriptions.add(subscription);
    this.byDocument.set(documentId, subscriptions);
    writeEvent(response, streamReadyEvent, { documentId });
    return () => {
      subscriptions.delete(subscription);
      if (
        subscriptions.size === 0 &&
        this.byDocument.get(documentId) === subscriptions
      )
        this.byDocument.delete(documentId);
    };
  }

  async publish(event: DocumentEvent): Promise<void> {
    const active = this.byDocument.get(event.documentId);
    for (const subscription of [...(active ?? [])]) {
      try {
        const allowed = await subscription.canObserve(event);
        if (this.closed || !active?.has(subscription)) continue;
        if (!allowed) {
          active?.delete(subscription);
          subscription.response.end();
          continue;
        }
        writeEvent(subscription.response, event.kind, event);
      } catch {
        active?.delete(subscription);
        subscription.response.end();
      }
    }
    if (active?.size === 0 && this.byDocument.get(event.documentId) === active)
      this.byDocument.delete(event.documentId);
  }

  close(): void {
    this.closed = true;
    clearInterval(this.heartbeat);
    for (const subscriptions of this.byDocument.values()) {
      for (const subscription of subscriptions) subscription.response.end();
    }
    this.byDocument.clear();
  }
}

function writeEvent(
  response: EventSink,
  event: string,
  data: Readonly<Record<string, unknown>>,
): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
