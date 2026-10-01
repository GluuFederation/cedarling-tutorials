/** Verifies signed Device Flow tokens and real Cedarling decisions inside the isolated Compose stack. */
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { ProtocolError, SdkHttpError } from "@modelcontextprotocol/client";
import {
  authorizeDevice,
  type DeviceVerification,
} from "../src/auth/device-flow.js";
import { IncidentChatHost } from "../src/chat/host.js";
import { ScriptedChatModel } from "../test/support/scripted-model.js";
import { loadConfig } from "../src/config/project-config.js";
import type { PersonaId } from "../src/incidents/types.js";
import { authorize } from "../src/mcp/authorization.js";
import { McpClientSession } from "../src/mcp/client.js";

const config = loadConfig({});
const endpoint = "http://127.0.0.1:17003/mcp";
const sessions: McpClientSession[] = [];

// Complete the tutorial IdP's actual login and consent forms, with a fresh browser session per caller.
async function approveDevice(
  verification: DeviceVerification,
  persona: PersonaId,
) {
  const cookies = new Map<string, string>();
  async function browser(path: string, fields?: Record<string, string>) {
    const response = await fetch(new URL(path, config.issuer), {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        cookie: [...cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join("; "),
      },
      ...(fields ? { method: "POST", body: new URLSearchParams(fields) } : {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      assert.ok(pair);
      const separator = pair.indexOf("=");
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    assert.ok(
      response.status < 400,
      `IdP interaction failed (${response.status})`,
    );
    return {
      html: await response.text(),
      location: response.headers.get("location"),
    };
  }
  function fields(html: string) {
    return Object.fromEntries(
      [...html.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((match) => {
        assert.ok(match[1]);
        assert.ok(typeof match[2] === "string");
        return [match[1], match[2]];
      }),
    );
  }
  function action(html: string) {
    const path = html.match(/<form[^>]*action="([^"]+)"/)?.[1];
    assert.ok(path, "Expected IdP interaction form");
    return path;
  }
  function redirect(page: { location: string | null }) {
    assert.ok(page.location, "Expected IdP redirect");
    return page.location;
  }
  assert.ok(verification.verificationUriComplete);
  const automatic = await browser(verification.verificationUriComplete);
  const confirmation = await browser("/device", fields(automatic.html));
  const interaction = await browser("/device", fields(confirmation.html));
  const login = await browser(redirect(interaction));
  const submitted = await browser(action(login.html), {
    login: persona,
    password: "anything",
    prompt: "login",
  });
  const resumed = await browser(redirect(submitted));
  const consent = await browser(redirect(resumed));
  const accepted = await browser(action(consent.html), { prompt: "consent" });
  const success = await browser(redirect(accepted));
  assert.match(success.html, /Sign-in Success/);
}

async function token(persona: PersonaId) {
  let approval: Promise<void> | undefined;
  return authorizeDevice({
    issuer: config.issuer,
    clientId: config.clientId,
    resource: config.mcpResource,
    persona,
    onVerification: (verification) => {
      approval = approveDevice(verification, persona);
    },
    sleep: async () => {
      await approval;
    },
  });
}

async function connect(accessToken: string) {
  const client = await McpClientSession.connect({ endpoint, accessToken });
  sessions.push(client);
  return client;
}

const input = createInterface({ input: process.stdin });
const acknowledgments = input[Symbol.asyncIterator]();

/** Waits for the host orchestrator to finish stopping or restarting the sidecar. */
async function checkpoint(marker: string, expected: string) {
  console.info(marker);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const acknowledgment = await Promise.race([
      acknowledgments.next(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Verifier checkpoint timed out")),
          90_000,
        );
      }),
    ]);
    assert.equal(acknowledgment.done, false, "Orchestrator closed input");
    assert.equal(acknowledgment.value, expected);
  } finally {
    clearTimeout(timer);
  }
}

try {
  const danaToken = await token("dana");
  const dana = await connect(danaToken);
  const search = (client: McpClientSession, query: string, limit = 5) =>
    client.callToolDirect("search_incidents", { query, limit });
  const initial = await search(dana, "INC-1002");
  assert.equal(initial.isError, undefined);
  assert.match(JSON.stringify(initial.structuredContent), /"version":1/);

  const amirToken = await token("amir");
  const amir = await connect(amirToken);
  const eve = await connect(await token("eve"));
  assert.equal((await dana.discover()).length, 4);
  assert.equal((await amir.discover()).length, 4);
  assert.deepEqual(await eve.discover(), []);
  const deniedHost = new IncidentChatHost({
    mcp: eve,
    model: new ScriptedChatModel([]),
    confirm: async () => true,
  });
  await deniedHost.connect();
  assert.match(
    await deniedHost.send("Find incidents"),
    /No incident operations/,
  );
  assert.match(JSON.stringify(await search(dana, "INC-2001")), /INC-2001/);
  assert.match(
    JSON.stringify((await search(amir, "INC-2001")).structuredContent),
    /"incidents":\[\]/,
  );
  const update = {
    incidentId: "INC-2001",
    expectedStatus: "mitigated",
    nextStatus: "resolved",
    confirmed: true,
    idempotencyKey: "denied-update",
  };
  const denied = await amir.callToolDirect("update_incident_status", update);
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied.content), /authorization_denied/);
  await assert.rejects(
    () => amir.invoke("triage_incident", { incidentId: "INC-2001" }),
    /authorization_denied/,
  );
  await assert.rejects(
    () => eve.callToolDirect("update_incident_status", update),
    (error: unknown) =>
      error instanceof ProtocolError &&
      error.code === -32602 &&
      error.message === "Tool update_incident_status not found",
  );
  assert.match(
    JSON.stringify((await search(dana, "INC-2001")).structuredContent),
    /"version":1/,
  );

  const host = new IncidentChatHost({
    mcp: amir,
    confirm: async () => true,
    model: new ScriptedChatModel([
      {
        name: "triage_incident",
        arguments: { incidentId: "INC-2001" },
      },
      {
        name: "search_incidents",
        arguments: { query: "payment", limit: 1 },
      },
      {
        name: "incident_response_runbook",
        arguments: {},
      },
      {
        name: "triage_incident",
        arguments: { incidentId: "INC-1001" },
      },
      {
        name: "update_incident_status",
        arguments: {
          incidentId: "INC-1001",
          expectedStatus: "open",
          nextStatus: "investigating",
        },
      },
    ]),
  });
  await host.connect();
  assert.equal(
    await host.send("Triage the audit incident"),
    "authorization_denied",
  );
  assert.match(await host.send("Find payment incident"), /INC-1001/);
  assert.match(await host.send("Read runbook"), /Incident response/);
  assert.match(await host.send("Prepare triage"), /Triage INC-1001/);
  assert.match(await host.send("Investigate"), /"version":2/);
  const retry = {
    incidentId: "INC-1001",
    expectedStatus: "investigating",
    nextStatus: "mitigated",
    confirmed: true,
    idempotencyKey: "same-retry",
  };
  for (let count = 0; count < 2; count++) {
    const result = await amir.callToolDirect("update_incident_status", retry);
    assert.notEqual(result.isError, true);
    assert.match(JSON.stringify(result.structuredContent), /"version":3/);
  }
  const stale = await amir.callToolDirect("update_incident_status", {
    ...retry,
    idempotencyKey: "stale-update",
  });
  assert.match(JSON.stringify(stale.content), /stale_incident_state/);
  const cancelled = new IncidentChatHost({
    mcp: amir,
    confirm: async () => false,
    model: new ScriptedChatModel([
      {
        name: "update_incident_status",
        arguments: {
          incidentId: "INC-1002",
          expectedStatus: "investigating",
          nextStatus: "mitigated",
        },
      },
    ]),
  });
  await cancelled.connect();
  assert.equal(await cancelled.send("Mitigate"), "Status change cancelled.");
  assert.match(
    JSON.stringify((await search(dana, "INC-1002")).structuredContent),
    /"version":1/,
  );

  // A valid Amir token must not authorize forged supervisor facts.
  assert.equal(
    await authorize(
      {
        token: amirToken,
        clientId: config.clientId,
        scopes: ["mcp.access"],
        extra: { subject: "dana" },
      },
      "Discover",
      { type: "Service", id: "incident-assistant" },
      "verify-subject-binding",
    ),
    false,
  );
  const parts = amirToken.split(".");
  const signature = parts[2];
  assert.ok(signature);
  parts[2] = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  await assert.rejects(() => connect(parts.join(".")));
  await assert.rejects(
    () =>
      authorize(
        {
          token: parts.join("."),
          clientId: config.clientId,
          scopes: ["mcp.access"],
          extra: { subject: "amir" },
        },
        "Discover",
        { type: "Service", id: "incident-assistant" },
        "verify-sidecar-signature",
      ),
    /authorization_unavailable/,
  );
  console.info(
    "Real signed-token policies, MCP operations, bypass denial, confirmation, and idempotency passed.",
  );

  const outageUpdate = {
    incidentId: "INC-1002",
    expectedStatus: "investigating",
    nextStatus: "mitigated",
    confirmed: true,
    idempotencyKey: "outage-proof",
  };
  await checkpoint("P3_VERIFY_STOP_SIDECAR", "stopped");
  await assert.rejects(
    () => amir.callToolDirect("update_incident_status", outageUpdate),
    (error: unknown) =>
      error instanceof SdkHttpError && error.data.status === 500,
  );
  await checkpoint("P3_VERIFY_START_SIDECAR", "started");
  const recovered = await search(amir, "INC-1002");
  assert.equal(recovered.isError, undefined);
  assert.partialDeepStrictEqual(recovered.structuredContent, {
    incidents: [{ id: "INC-1002", status: "investigating", version: 1 }],
  });
  const updated = await amir.callToolDirect(
    "update_incident_status",
    outageUpdate,
  );
  assert.equal(updated.isError, undefined);
  assert.partialDeepStrictEqual(updated.structuredContent, {
    incident: { id: "INC-1002", status: "mitigated", version: 2 },
  });
  console.info(
    "Existing client: outage blocked mutation; recovery preserved state and restored authorized updates.",
  );
} finally {
  input.close();
  await Promise.all(sessions.map((session) => session.close()));
}
