import { z } from "zod";
import type { PersonaId } from "../incidents/types.js";

const discoverySchema = z.object({
  device_authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
});

const deviceResponseSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().url(),
  verification_uri_complete: z.string().url().optional(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive().optional(),
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
});

const tokenErrorSchema = z.object({ error: z.string().min(1) });

export type DeviceVerification = Readonly<{
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
}>;

type DeviceFlowOptions = Readonly<{
  issuer: string;
  clientId: string;
  resource: string;
  persona: PersonaId;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  onVerification: (verification: DeviceVerification) => void;
}>;

const p3Scopes = ["openid", "profile", "email", "mcp.access"] as const;
const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Completes Device Flow and retains only the returned access token in memory. */
export async function authorizeDevice(
  options: DeviceFlowOptions,
): Promise<string> {
  const request = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const discoveryResponse = await request(
    `${options.issuer}/.well-known/openid-configuration`,
  );
  if (!discoveryResponse.ok)
    throw new Error("Identity-provider discovery failed");
  const discovery = discoverySchema.parse(await discoveryResponse.json());

  const deviceResponse = await request(
    discovery.device_authorization_endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: options.clientId,
        login_hint: options.persona,
        resource: options.resource,
        scope: p3Scopes.join(" "),
      }),
    },
  );
  if (!deviceResponse.ok) throw new Error("Device authorization failed");
  const device = deviceResponseSchema.parse(await deviceResponse.json());
  options.onVerification({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    ...(device.verification_uri_complete
      ? { verificationUriComplete: device.verification_uri_complete }
      : {}),
  });

  const expiresAt = now() + device.expires_in * 1_000;
  let intervalMs = (device.interval ?? 5) * 1_000;
  while (now() < expiresAt) {
    await sleep(intervalMs);
    const tokenResponse = await request(discovery.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: options.clientId,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        resource: options.resource,
      }),
    });
    const body: unknown = await tokenResponse.json();
    if (tokenResponse.ok) return tokenResponseSchema.parse(body).access_token;

    const error = tokenErrorSchema.parse(body).error;
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      intervalMs += 5_000;
      continue;
    }
    if (error === "access_denied")
      throw new Error("Device authorization denied");
    if (error === "expired_token")
      throw new Error("Device authorization expired");
    throw new Error(`Device token request failed: ${error}`);
  }
  throw new Error("Device authorization expired");
}
