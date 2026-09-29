import {
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
} from "jose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { deviceCodeGrantType, loadConfig } from "../src/config.js";
import { createProvider } from "../src/provider.js";

function localPath(location: string): string {
  const url = new URL(location, "http://localhost:18001");
  return `${url.pathname}${url.search}`;
}

function requiredLocation(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected redirect location");
  return value;
}

function formAction(html: string): string {
  const action = html.match(/<form[^>]*action="([^"]+)"/)?.[1];
  if (!action) throw new Error("Interaction form action was not found");
  return localPath(action);
}

function hiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of html.matchAll(/name="([^"]+)" value="([^"]*)"/g)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) fields[name] = value;
  }
  return fields;
}

describe("Device Authorization Grant", () => {
  it.each([
    ["P2", "p2-tenantrag", "api", "mallory", "leo"],
    ["P3", "p3-mcp-capability-governance", "mcp", "eve", "amir"],
  ])(
    "issues scoped JWTs and switches accounts for %s",
    async (project, id, resource, firstAccount, secondAccount) => {
      const config = loadConfig({ IDP_PROJECT: project });
      const p2 = config.applications.get(id);
      const api = p2?.resources.get(resource);
      if (!p2 || !api) throw new Error("P2 provider configuration is missing");
      expect(p2).toMatchObject({
        clientId: `${id}-cli`,
        clientType: "public",
        grantTypes: [deviceCodeGrantType],
        responseTypes: [],
        tokenEndpointAuthMethod: "none",
      });

      const provider = await createProvider(config);
      const agent = request.agent(createApp(provider));
      const deviceAuthorization = await agent
        .post("/device/auth")
        .type("form")
        .send({
          client_id: p2.clientId,
          login_hint: firstAccount,
          resource: api.audience,
          scope: ["openid", "profile", "email", ...api.scopes].join(" "),
        });
      expect(deviceAuthorization.status).toBe(200);
      const device = deviceAuthorization.body as {
        device_code: string;
        user_code: string;
        verification_uri_complete: string;
        expires_in: number;
      };
      expect(device.expires_in).toBe(600);

      const automaticSubmission = await agent.get(
        localPath(device.verification_uri_complete),
      );
      const confirmation = await agent
        .post("/device")
        .type("form")
        .send(hiddenFields(automaticSubmission.text));
      expect(confirmation.text).toContain("Device Login Confirmation");

      const interactionRedirect = await agent
        .post("/device")
        .type("form")
        .send(hiddenFields(confirmation.text));
      expect(interactionRedirect.status).toBe(303);
      const login = await agent.get(
        localPath(requiredLocation(interactionRedirect.headers.location)),
      );
      expect(login.text).toContain(`value="${firstAccount}"`);

      const loginSubmission = await agent
        .post(formAction(login.text))
        .type("form")
        .send({ login: firstAccount, password: "anything", prompt: "login" });
      const resumedLogin = await agent.get(
        localPath(requiredLocation(loginSubmission.headers.location)),
      );
      const consent = await agent.get(
        localPath(requiredLocation(resumedLogin.headers.location)),
      );
      for (const scope of ["profile", "email", ...api.scopes]) {
        expect(consent.text.split(`<li>${scope}</li>`)).toHaveLength(2);
      }
      expect(consent.text.split(`<li>${api.audience}:</li>`)).toHaveLength(2);

      const consentSubmission = await agent
        .post(formAction(consent.text))
        .type("form")
        .send({ prompt: "consent" });
      const success = await agent.get(
        localPath(requiredLocation(consentSubmission.headers.location)),
      );
      expect(success.text).toContain("Sign-in Success");

      const tokenResponse = await agent.post("/token").type("form").send({
        client_id: p2.clientId,
        device_code: device.device_code,
        grant_type: deviceCodeGrantType,
      });
      expect(tokenResponse.status).toBe(200);
      const accessToken = String(tokenResponse.body.access_token);
      expect(decodeProtectedHeader(accessToken).alg).toBe("RS256");
      const jwksResponse = await agent.get("/jwks");
      const verified = await jwtVerify(
        accessToken,
        createLocalJWKSet(jwksResponse.body as JSONWebKeySet),
        { issuer: config.issuer, audience: api.audience },
      );
      expect(verified.payload.sub).toBe(firstAccount);
      expect(String(verified.payload.scope).split(" ").sort()).toEqual(
        [...api.scopes].sort(),
      );
      expect(Number(verified.payload.exp) - Number(verified.payload.iat)).toBe(
        1_800,
      );

      const secondAuthorization = await agent
        .post("/device/auth")
        .type("form")
        .send({
          client_id: p2.clientId,
          login_hint: secondAccount,
          resource: api.audience,
          scope: ["openid", "profile", "email", ...api.scopes].join(" "),
        });
      const secondDevice = secondAuthorization.body as {
        device_code: string;
        verification_uri_complete: string;
      };
      const secondAutomaticSubmission = await agent.get(
        localPath(secondDevice.verification_uri_complete),
      );
      const secondConfirmation = await agent
        .post("/device")
        .type("form")
        .send(hiddenFields(secondAutomaticSubmission.text));
      const secondRedirect = await agent
        .post("/device")
        .type("form")
        .send(hiddenFields(secondConfirmation.text));
      const secondLogin = await agent.get(
        localPath(requiredLocation(secondRedirect.headers.location)),
      );
      expect(secondLogin.text).toContain(`value="${secondAccount}"`);

      const secondLoginSubmission = await agent
        .post(formAction(secondLogin.text))
        .type("form")
        .send({ login: secondAccount, password: "anything", prompt: "login" });
      const secondResumedLogin = await agent.get(
        localPath(requiredLocation(secondLoginSubmission.headers.location)),
      );
      const sessionSwitchSubmission = await agent
        .post(formAction(secondResumedLogin.text))
        .type("form")
        .send(hiddenFields(secondResumedLogin.text));
      const resumedSessionSwitch = await agent.get(
        localPath(requiredLocation(sessionSwitchSubmission.headers.location)),
      );
      const secondConsent =
        typeof resumedSessionSwitch.headers.location === "string"
          ? await agent.get(localPath(resumedSessionSwitch.headers.location))
          : resumedSessionSwitch;
      expect(secondConsent.text).toContain('name="prompt" value="consent"');
      const secondConsentSubmission = await agent
        .post(formAction(secondConsent.text))
        .type("form")
        .send({ prompt: "consent" });
      await agent.get(
        localPath(requiredLocation(secondConsentSubmission.headers.location)),
      );

      const secondTokenResponse = await agent.post("/token").type("form").send({
        client_id: p2.clientId,
        device_code: secondDevice.device_code,
        grant_type: deviceCodeGrantType,
      });
      const secondAccessToken = String(secondTokenResponse.body.access_token);
      const secondVerified = await jwtVerify(
        secondAccessToken,
        createLocalJWKSet(jwksResponse.body as JSONWebKeySet),
        { issuer: config.issuer, audience: api.audience },
      );
      expect(secondVerified.payload.sub).toBe(secondAccount);
    },
  );
});
