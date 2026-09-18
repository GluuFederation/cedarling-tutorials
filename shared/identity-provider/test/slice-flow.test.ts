import { createHash } from "node:crypto";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import request from "supertest";
import { expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createProvider } from "../src/provider.js";

const secret = "isolated-provider-flow-secret-for-tests";

function location(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected redirect");
  const url = new URL(value, "http://idp.localhost:4000");
  return `${url.pathname}${url.search}`;
}

function action(html: string): string {
  const value = html.match(/<form[^>]*action="([^"]+)"/)?.[1];
  if (!value) throw new Error("Expected interaction form");
  return location(value);
}

it.each([
  ["P12", "p12-hr-access-governance", "lin"],
  ["P13", "p13-student-records", "sam"],
  ["P14", "p14-ai-scheduling-assistant", "benoit"],
  ["P14", "p14-ai-scheduling-assistant", "amara"],
  ["P15", "p15-marketplace", "bao"],
  ["P15", "p15-marketplace", "sela"],
  ["P15", "p15-marketplace", "diego"],
  ["P15", "p15-marketplace", "nia"],
] as const)(
  "issues a signed isolated %s grant for %s / %s",
  async (prefix, id, subject) => {
    const config = loadConfig({
      P1_CLIENT_SECRET: secret,
      P4_CLIENT_SECRET: secret,
      P5_CLIENT_SECRET: secret,
      P6_CLIENT_SECRET: secret,
      P7_CLIENT_SECRET: secret,
      P8_CLIENT_SECRET: secret,
      P9_CLIENT_SECRET: secret,
      P10_TRANSFER_PLANNER_CLIENT_SECRET: secret,
      P10_WAREHOUSE_NORTH_CLIENT_SECRET: secret,
      P10_WAREHOUSE_SOUTH_CLIENT_SECRET: secret,
      P10_INVENTORY_AUDITOR_CLIENT_SECRET: secret,
      P11_CLIENT_SECRET: secret,
      [`${prefix}_CLIENT_SECRET`]: secret,
    });
    const client = config.applications.get(id);
    const resource = client?.resources.get("api");
    const redirect = client?.redirectUris[0];
    if (!client || !resource || !redirect)
      throw new Error("Missing slice registration");
    const provider = await createProvider(config);
    const agent = request.agent(createApp(provider));
    const verifier = "a-long-isolated-slice-verifier-for-real-pkce-s256";
    const authorization = await agent.get("/auth").query({
      client_id: client.clientId,
      redirect_uri: redirect,
      resource: resource.audience,
      response_type: "code",
      scope: `openid profile ${resource.scopes.join(" ")}`,
      login_hint: subject,
      prompt: "login consent",
      state: "slice-state",
      nonce: "slice-nonce",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    expect(authorization.status).toBe(303);
    const login = await agent.get(location(authorization.headers.location));
    expect(login.status).toBe(200);
    const signedIn = await agent
      .post(action(login.text))
      .type("form")
      .send({ login: subject, password: "tutorial", prompt: "login" });
    expect(signedIn.status).toBe(303);
    const resume = await agent.get(location(signedIn.headers.location));
    expect(resume.status).toBe(303);
    const consent = await agent.get(location(resume.headers.location));
    expect(consent.status).toBe(200);
    const accepted = await agent
      .post(action(consent.text))
      .type("form")
      .send({ prompt: "consent" });
    expect(accepted.status).toBe(303);
    const callback = await agent.get(location(accepted.headers.location));
    expect(callback.status).toBe(303);
    const callbackUrl = new URL(String(callback.headers.location));
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(redirect);
    expect(callbackUrl.searchParams.get("state")).toBe("slice-state");
    const tokens = await agent
      .post("/token")
      .auth(client.clientId, secret, { type: "basic" })
      .type("form")
      .send({
        grant_type: "authorization_code",
        code: callbackUrl.searchParams.get("code"),
        code_verifier: verifier,
        redirect_uri: redirect,
        resource: resource.audience,
      });
    expect(tokens.status).toBe(200);
    const idToken: unknown = tokens.body.id_token;
    const accessToken: unknown = tokens.body.access_token;
    if (typeof idToken !== "string" || typeof accessToken !== "string") {
      throw new Error("Expected ID and access tokens");
    }
    const jwks = await agent.get("/jwks");
    const keys = createLocalJWKSet(jwks.body as JSONWebKeySet);
    const identity = await jwtVerify(idToken, keys, {
      issuer: config.issuer,
      audience: client.clientId,
      algorithms: ["RS256"],
    });
    expect(identity.payload.sub).toBe(subject);
    expect(identity.payload.nonce).toBe("slice-nonce");
    expect(identity.payload).not.toHaveProperty("tutorial_assurance");
    expect(identity.payload).not.toHaveProperty("role");
    const access = await jwtVerify(accessToken, keys, {
      issuer: config.issuer,
      audience: resource.audience,
      algorithms: ["RS256"],
    });
    expect(access.payload.sub).toBe(subject);
    expect(access.payload.scope).toBe(resource.scopes.join(" "));
    const forbidden = await agent.get("/auth").query({
      client_id: client.clientId,
      redirect_uri: redirect,
      resource: "http://p1.localhost:3000/api",
      response_type: "code",
      scope: "openid task.view",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    expect(forbidden.status).toBe(303);
    expect(
      new URL(String(forbidden.headers.location)).searchParams.get("error"),
    ).toBe("invalid_target");
  },
);
