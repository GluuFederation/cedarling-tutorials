import assert from "node:assert/strict";
import { loadConfig } from "../src/server/config.ts";
import { realtimeEvents } from "../src/shared/protocol.ts";
import { nextEvent, openScenarioClient } from "./scenario-session.ts";

const phase = process.argv[2];
if (phase !== "--exercise" && phase !== "--after-restart") {
  throw new Error("The permissive runner must execute inside the P9 container");
}
const config = loadConfig();
assert.equal(config.dataRoot, "/data");

async function exercise(): Promise<void> {
  const mei = await openScenarioClient(config, "mei");
  const kwame = await openScenarioClient(config, "kwame");
  const yuki = await openScenarioClient(config, "yuki");
  try {
    assert.equal(mei.session.authzMode, "permissive");
    console.log(
      "✓ real IdP login, consent, callback, opaque session and tickets",
    );

    await Promise.all([
      mei.enter("room-a-general"),
      kwame.enter("room-a-general"),
      yuki.enter("room-a-general"),
    ]);
    const positiveDelivery = nextEvent(
      yuki.socket,
      realtimeEvents.server.messageCreated,
    );
    const persisted = await mei.publish(
      "room-a-general",
      "scenario-publish-persist",
      "P9 restart persistence proof",
    );
    assert.equal((await positiveDelivery).message.id, persisted.message.id);
    const duplicate = await mei.publish(
      "room-a-general",
      "scenario-publish-persist",
      "P9 restart persistence proof",
    );
    assert.equal(duplicate.duplicate, true);
    console.log("✓ positive delivery and one-effect command retry");

    const restricted = await mei.enter("room-a-restricted");
    const crossTenant = await mei.enter("room-b-general");
    assert.equal(restricted.outcome.decision, "FAKE ALLOW");
    assert.equal(crossTenant.room.tenantId, "tenant-b");
    console.log("✓ gap 1: swapped room and tenant IDs enter permissively");

    await kwame.remove(
      "room-a-general",
      "user-yuki",
      "scenario-remove-yuki",
      1,
    );
    const staleDelivery = nextEvent(
      yuki.socket,
      realtimeEvents.server.messageCreated,
    );
    await mei.publish(
      "room-a-general",
      "scenario-publish-after-removal",
      "Yuki remains a transport candidate",
    );
    assert.match((await staleDelivery).message.content ?? "", /candidate/u);
    yuki.close();
    const yukiAgain = await openScenarioClient(config, "yuki");
    try {
      const reentered = await yukiAgain.enter("room-a-general");
      assert.equal(reentered.outcome.decision, "FAKE ALLOW");
    } finally {
      yukiAgain.close();
    }
    console.log("✓ gap 2: removed member receives and re-enters");

    const moderatorMessage = await kwame.publish(
      "room-a-general",
      "scenario-publish-moderator",
      "Moderator-authored deletion target",
    );
    const removed = await mei.remove(
      "room-a-general",
      "user-kwame",
      "scenario-remove-kwame",
      1,
    );
    assert.equal(removed.membership.active, false);
    const deleted = await mei.delete(
      "room-a-general",
      moderatorMessage.message.id,
      "scenario-delete-moderator-message",
      1,
    );
    assert.equal(deleted.message.deleted, true);
    await assert.rejects(
      mei.delete(
        "room-a-general",
        moderatorMessage.message.id,
        "scenario-delete-stale",
        1,
      ),
      /message_already_deleted|stale_message_version/u,
    );
    console.log(
      "✓ gap 3: member removes another member and deletes their message",
    );
    console.log("P9 live permissive exercise passed");
  } finally {
    mei.close();
    kwame.close();
    yuki.close();
  }
}

async function afterRestart(): Promise<void> {
  const mei = await openScenarioClient(config, "mei");
  try {
    const snapshot = await mei.enter("room-a-general");
    const persisted = snapshot.messages.find(
      (message) => message.content === "P9 restart persistence proof",
    );
    assert.ok(persisted, "persisted message must survive restart");
    assert.ok(snapshot.nextSequence >= persisted.sequence);
    const duplicate = await mei.publish(
      "room-a-general",
      "scenario-publish-persist",
      "P9 restart persistence proof",
    );
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.message.id, persisted.id);
    const replay = await mei.enter("room-a-general", persisted.sequence);
    assert.equal(replay.replayed, true);
    assert.equal(
      new Set(replay.messages.map((message) => message.id)).size,
      replay.messages.length,
    );
    console.log(
      "P9 restart proof passed: effects, sequence, retry and replay persist",
    );
  } finally {
    mei.close();
  }
}

if (phase === "--exercise") await exercise();
else await afterRestart();
