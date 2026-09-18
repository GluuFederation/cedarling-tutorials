import { createHash } from "node:crypto";
import {
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
} from "jose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  p1TaskScopes,
  type IdentityProviderConfig,
  type TutorialApplicationConfig,
} from "../src/config.js";
import { createProvider } from "../src/provider.js";

const p1Application = {
  name: "P1 Task Manager",
  clientId: "p1-task-manager",
  clientType: "confidential",
  clientSecret: "p1-client-secret-for-provider-tests",
  grantTypes: ["authorization_code", "refresh_token"],
  responseTypes: ["code"],
  tokenEndpointAuthMethod: "client_secret_basic",
  redirectUris: ["http://p1.localhost:3000/auth/callback"],
  postLogoutRedirectUris: ["http://p1.localhost:3000"],
  resources: new Map([
    [
      "api",
      {
        audience: "http://p1.localhost:3000/api",
        scopes: p1TaskScopes,
        accessTokenTtlSeconds: 300,
      },
    ],
  ]),
} satisfies TutorialApplicationConfig;

const config: IdentityProviderConfig = {
  profile: "default",
  host: "127.0.0.1",
  port: 4000,
  issuer: "http://idp.localhost:4000",
  applications: new Map([["p1-task-manager", p1Application]]),
};

const p1Api = p1Application.resources.get("api");
const p1RedirectUri = p1Application.redirectUris[0];
if (!p1Api || !p1RedirectUri) {
  throw new Error("P1 test configuration is incomplete");
}

function requiredLocation(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected a redirect location");
  }
  return value;
}

function localPath(location: string): string {
  const url = new URL(location, config.issuer);
  return `${url.pathname}${url.search}`;
}

function formAction(html: string): string {
  const action = html.match(/<form[^>]*action="([^"]+)"/)?.[1];
  if (!action) throw new Error("Interaction form action was not found");
  return action;
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("development interactions", () => {
  it("issues the P1 JWT token set after default login and explicit consent", async () => {
    const provider = await createProvider(config);
    const agent = request.agent(createApp(provider));
    const verifier = "tutorial-verifier-that-is-long-enough-for-pkce-s256";
    const authorization = await agent.get("/auth").query({
      client_id: p1Application.clientId,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      nonce: "tutorial-nonce",
      login_hint: "mina",
      prompt: "login consent",
      redirect_uri: p1RedirectUri,
      resource: p1Api.audience,
      response_type: "code",
      scope: [
        "openid",
        "profile",
        "email",
        "offline_access",
        ...p1TaskScopes,
      ].join(" "),
      state: "tutorial-state",
    });

    expect(authorization.status).toBe(303);
    const login = await agent.get(
      localPath(requiredLocation(authorization.headers.location)),
    );
    expect(login.status).toBe(200);
    expect(login.text).toContain('name="login"');
    expect(login.text).toContain('value="mina"');
    expect(login.text).toContain('name="password"');
    expect(login.text).not.toContain('name="account_id"');

    const loginSubmission = await agent
      .post(localPath(formAction(login.text)))
      .type("form")
      .send({ login: "mina", password: "anything", prompt: "login" });
    expect(loginSubmission.status).toBe(303);

    const resumedLogin = await agent.get(
      localPath(requiredLocation(loginSubmission.headers.location)),
    );
    expect(resumedLogin.status).toBe(303);
    const consent = await agent.get(
      localPath(requiredLocation(resumedLogin.headers.location)),
    );
    expect(consent.status).toBe(200);
    expect(consent.text).toContain('name="prompt" value="consent"');
    for (const scope of p1TaskScopes) {
      expect(consent.text.split(`<li>${scope}</li>`)).toHaveLength(2);
    }

    const consentSubmission = await agent
      .post(localPath(formAction(consent.text)))
      .type("form")
      .send({ prompt: "consent" });
    expect(consentSubmission.status).toBe(303);

    const resumedConsent = await agent.get(
      localPath(requiredLocation(consentSubmission.headers.location)),
    );
    expect(resumedConsent.status).toBe(303);
    const callback = new URL(requiredLocation(resumedConsent.headers.location));
    expect(callback.origin + callback.pathname).toBe(p1RedirectUri);
    expect(callback.searchParams.get("state")).toBe("tutorial-state");
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenResponse = await agent
      .post("/token")
      .auth(p1Application.clientId, p1Application.clientSecret, {
        type: "basic",
      })
      .type("form")
      .send({
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: p1RedirectUri,
        resource: p1Api.audience,
      });
    expect(tokenResponse.status).toBe(200);

    const { access_token, id_token, refresh_token } = tokenResponse.body as {
      access_token: string;
      id_token: string;
      refresh_token: string;
    };
    expect(decodeProtectedHeader(access_token).alg).toBe("RS256");
    expect(decodeProtectedHeader(id_token).alg).toBe("RS256");
    expect(() => decodeJwt(refresh_token)).toThrow();

    const jwksResponse = await agent.get("/jwks");
    expect(jwksResponse.status).toBe(200);
    const keySet = createLocalJWKSet(jwksResponse.body as JSONWebKeySet);
    const access = await jwtVerify(access_token, keySet, {
      issuer: config.issuer,
      audience: p1Api.audience,
    });
    expect(access.payload.sub).toBe("mina");
    expect(String(access.payload.scope).split(" ").sort()).toEqual(
      [...p1TaskScopes].sort(),
    );
    expect(Number(access.payload.exp) - Number(access.payload.iat)).toBe(300);

    const identity = await jwtVerify(id_token, keySet, {
      issuer: config.issuer,
      audience: p1Application.clientId,
    });
    expect(identity.payload).toMatchObject({
      sub: "mina",
      name: "Mina Okafor",
      preferred_username: "mina",
      email: "mina@tutorial.test",
      email_verified: true,
    });
    expect(Number(identity.payload.exp) - Number(identity.payload.iat)).toBe(
      300,
    );

    const refreshResponse = await agent
      .post("/token")
      .auth(p1Application.clientId, p1Application.clientSecret, {
        type: "basic",
      })
      .type("form")
      .send({
        grant_type: "refresh_token",
        refresh_token,
        resource: p1Api.audience,
      });
    expect(refreshResponse.status).toBe(200);
    const refreshed = refreshResponse.body as {
      access_token: string;
      refresh_token: string;
    };
    expect(refreshed.refresh_token).not.toBe(refresh_token);
    await expect(
      jwtVerify(refreshed.access_token, keySet, {
        issuer: config.issuer,
        audience: p1Api.audience,
      }),
    ).resolves.toBeTruthy();

    const discovery = await agent.get("/.well-known/openid-configuration");
    expect(discovery.body.userinfo_endpoint).toBeUndefined();
  });

  it("rejects an unregistered resource indicator", async () => {
    const provider = await createProvider(config);
    const response = await request(createApp(provider))
      .get("/auth")
      .query({
        client_id: p1Application.clientId,
        code_challenge: pkceChallenge(
          "another-tutorial-verifier-long-enough-for-pkce",
        ),
        code_challenge_method: "S256",
        nonce: "tutorial-nonce",
        redirect_uri: p1RedirectUri,
        resource: "https://untrusted.example/api",
        response_type: "code",
        scope: "openid task.view",
        state: "tutorial-state",
      });

    expect(response.status).toBe(303);
    const callback = new URL(requiredLocation(response.headers.location));
    expect(callback.origin + callback.pathname).toBe(p1RedirectUri);
    expect(callback.searchParams.get("error")).toBe("invalid_target");
  });

  it("keeps each tutorial client isolated to its registered resources", async () => {
    const p2Application = {
      name: "P2 Test Application",
      clientId: "p2-test",
      clientType: "confidential",
      clientSecret: "p2-client-secret-for-provider-tests",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "client_secret_basic",
      redirectUris: ["http://p2.localhost:3000/auth/callback"],
      postLogoutRedirectUris: ["http://p2.localhost:3000"],
      resources: new Map([
        [
          "api",
          {
            audience: "http://p2.localhost:3000/api",
            scopes: ["message.view"],
            accessTokenTtlSeconds: 300,
          },
        ],
      ]),
    } satisfies TutorialApplicationConfig;
    const provider = await createProvider({
      ...config,
      applications: new Map([
        ...config.applications,
        ["p2-test", p2Application],
      ]),
    });
    const response = await request(createApp(provider))
      .get("/auth")
      .query({
        client_id: p2Application.clientId,
        code_challenge: pkceChallenge(
          "p2-tutorial-verifier-long-enough-for-pkce",
        ),
        code_challenge_method: "S256",
        nonce: "tutorial-nonce",
        redirect_uri: p2Application.redirectUris[0],
        resource: p1Api.audience,
        response_type: "code",
        scope: "openid task.view",
        state: "tutorial-state",
      });

    expect(response.status).toBe(303);
    const callback = new URL(requiredLocation(response.headers.location));
    expect(callback.origin + callback.pathname).toBe(
      p2Application.redirectUris[0],
    );
    expect(callback.searchParams.get("error")).toBe("invalid_target");
  });

  it("rejects duplicate client IDs and permits client-scoped shared audiences", async () => {
    const duplicateClient: TutorialApplicationConfig = {
      ...p1Application,
      name: "Duplicate client",
      resources: new Map([
        [
          "api",
          {
            audience: "http://duplicate.localhost/api",
            scopes: ["read"],
            accessTokenTtlSeconds: 300,
          },
        ],
      ]),
    };
    await expect(
      createProvider({
        ...config,
        applications: new Map([
          ...config.applications,
          ["duplicate-client", duplicateClient],
        ]),
      }),
    ).rejects.toThrow("Duplicate tutorial client ID");

    const sharedAudience: TutorialApplicationConfig = {
      ...p1Application,
      name: "Shared audience client",
      clientId: "different-client",
      resources: new Map([
        [
          "api",
          {
            audience: p1Api.audience,
            scopes: ["read"],
            accessTokenTtlSeconds: 300,
          },
        ],
      ]),
    };
    await expect(
      createProvider({
        ...config,
        applications: new Map([
          ...config.applications,
          ["shared-audience", sharedAudience],
        ]),
      }),
    ).resolves.toBeTruthy();
  });
});
