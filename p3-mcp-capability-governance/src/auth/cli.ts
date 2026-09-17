import type { P3Config } from "../config/project-config.js";
import type { PersonaId } from "../incidents/types.js";
import { authorizeDevice } from "./device-flow.js";
import {
  createP3AccessTokenVerifier,
  type VerifiedP3AccessToken,
} from "./token-verifier.js";

/** Runs Device Flow and verifies the chosen persona without persisting the token. */
export async function authorizePersona(
  persona: PersonaId,
  config: P3Config,
  dependencies: Readonly<{
    authorize?: typeof authorizeDevice;
    output?: (value: string) => void;
    verify?: (token: string) => Promise<VerifiedP3AccessToken>;
  }> = {},
): Promise<string> {
  const output = dependencies.output ?? console.error;
  const token = await (dependencies.authorize ?? authorizeDevice)({
    issuer: config.issuer,
    clientId: config.clientId,
    resource: config.mcpResource,
    persona,
    onVerification: ({
      userCode,
      verificationUri,
      verificationUriComplete,
    }) => {
      output(`Open: ${verificationUriComplete ?? verificationUri}`);
      output(`User code: ${userCode}`);
      output(`Sign in as ${persona}; waiting for approval...`);
    },
  });
  const verify =
    dependencies.verify ??
    createP3AccessTokenVerifier({
      issuer: config.issuer,
      audience: config.mcpResource,
      clientId: config.clientId,
    });
  const authenticated = await verify(token);
  if (authenticated.subject !== persona) {
    throw new Error(
      `Authenticated as ${authenticated.subject}; rerun and sign in as ${persona}`,
    );
  }
  output(`Authenticated as ${authenticated.subject}.`);
  return token;
}
