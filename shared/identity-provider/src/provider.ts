import { randomBytes } from "node:crypto";
import { exportJWK, generateKeyPair } from "jose";
import Provider, {
  errors,
  interactionPolicy,
  type ClientMetadata,
  type Configuration,
} from "oidc-provider";
import { findAccount } from "./accounts.js";
import type {
  IdentityProviderConfig,
  TutorialApplicationConfig,
  TutorialResourceConfig,
} from "./config.js";

const signingKeyId = "tutorial-ephemeral-signing-key";

type IndexedResource = Readonly<{
  application: TutorialApplicationConfig;
  resource: TutorialResourceConfig;
}>;

function resourceKey(clientId: string, audience: string): string {
  return `${clientId}\u0000${audience}`;
}

function indexRegistry(config: IdentityProviderConfig): {
  clients: readonly ClientMetadata[];
  resources: ReadonlyMap<string, IndexedResource>;
} {
  if (config.applications.size === 0) {
    throw new Error("At least one tutorial application is required");
  }

  const clientIds = new Set<string>();
  const resources = new Map<string, IndexedResource>();
  const clients: ClientMetadata[] = [];

  for (const [applicationId, application] of config.applications) {
    if (clientIds.has(application.clientId)) {
      throw new Error(`Duplicate tutorial client ID: ${application.clientId}`);
    }
    clientIds.add(application.clientId);
    if (application.resources.size === 0) {
      throw new Error(`${applicationId} must declare at least one resource`);
    }

    const client: ClientMetadata = {
      client_id: application.clientId,
      client_name: application.name,
      grant_types: [...application.grantTypes],
      response_types: [...application.responseTypes],
      token_endpoint_auth_method: application.tokenEndpointAuthMethod,
    };
    if (application.redirectUris.length > 0) {
      client.redirect_uris = [...application.redirectUris];
    }
    if (application.postLogoutRedirectUris.length > 0) {
      client.post_logout_redirect_uris = [
        ...application.postLogoutRedirectUris,
      ];
    }
    if (application.clientType === "confidential") {
      client.client_secret = application.clientSecret;
    }
    clients.push(client);

    for (const resource of application.resources.values()) {
      const key = resourceKey(application.clientId, resource.audience);
      if (resources.has(key)) {
        throw new Error(
          `Duplicate resource audience for ${application.clientId}: ${resource.audience}`,
        );
      }
      resources.set(key, { application, resource });
    }
  }

  return { clients, resources };
}

export async function createProvider(
  config: IdentityProviderConfig,
): Promise<Provider> {
  // Build and validate the registry before generating ephemeral runtime keys.
  const registry = indexRegistry(config);
  const secureCookies = new URL(config.issuer).protocol === "https:";
  const { privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const clientCredentialsEnabled = [...config.applications.values()].some(
    (application) => application.grantTypes.includes("client_credentials"),
  );
  const policy = interactionPolicy.base();
  const loginPrompt = policy.get("login");
  if (!loginPrompt) throw new Error("Default login interaction is unavailable");
  loginPrompt.checks.add(
    new interactionPolicy.Check(
      "login_hint_mismatch",
      "The requested tutorial account differs from the active session",
      (ctx) => {
        const loginHint = ctx.oidc.params?.login_hint;
        const accountId = ctx.oidc.session?.accountId;
        const submittedAccount = ctx.oidc.result?.login?.accountId;
        return (
          typeof loginHint === "string" &&
          typeof accountId === "string" &&
          loginHint !== accountId &&
          submittedAccount !== loginHint
        );
      },
    ),
  );

  const jwk = await exportJWK(privateKey);
  Object.assign(jwk, {
    alg: "RS256",
    use: "sig",
    kid: signingKeyId,
  });

  const providerConfig: Configuration = {
    clients: registry.clients,
    claims: {
      openid: ["sub"],
      profile: ["name", "preferred_username"],
      email: ["email", "email_verified"],
    },
    cookies: {
      keys: [randomBytes(32).toString("base64url")],
      long: {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
        signed: true,
      },
      short: {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
        signed: true,
      },
    },
    extraTokenClaims: (_ctx, token) => token.extra,
    features: {
      deviceFlow: { enabled: true },
      clientCredentials: { enabled: clientCredentialsEnabled },
      registration: { enabled: false },
      resourceIndicators: {
        enabled: true,
        getResourceServerInfo: (_ctx, resourceIndicator, client) => {
          const indexed = registry.resources.get(
            resourceKey(client.clientId, resourceIndicator),
          );
          // A registered client can request only the resources assigned to it.
          if (!indexed) {
            throw new errors.InvalidTarget(
              "The requested resource is not registered for this tutorial application",
            );
          }
          return {
            scope: indexed.resource.scopes.join(" "),
            audience: indexed.resource.audience,
            accessTokenFormat: "jwt",
            accessTokenTTL: indexed.resource.accessTokenTtlSeconds,
            jwt: { sign: { alg: "RS256", kid: signingKeyId } },
          };
        },
        useGrantedResource: () => true,
      },
      revocation: { enabled: false },
      userinfo: { enabled: false },
    },
    interactions: { policy },
    findAccount,
    jwks: { keys: [jwk] },
    pkce: {
      required: (_ctx, client) => client.grantTypeAllowed("authorization_code"),
    },
    responseTypes: ["code"],
    rotateRefreshToken: true,
    scopes: ["openid", "profile", "email", "offline_access"],
    ttl: {
      AccessToken: (_ctx, token) => token.resourceServer?.accessTokenTTL ?? 300,
      AuthorizationCode: 120,
      DeviceCode: 600,
      Grant: 1_200,
      IdToken: 300,
      Interaction: 120,
      RefreshToken: 1_200,
      Session: 1_200,
    },
  };

  const provider = new Provider(config.issuer, providerConfig);
  provider.proxy = false;
  return provider;
}
