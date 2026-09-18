import type { P2Config } from "../config/project-config.js";
import { authorizeDevice, parsePersona } from "./device-flow.js";
import type { PersonaId } from "../rag/types.js";

type AuthDependencies = Readonly<{
  authorize?: typeof authorizeDevice;
  stderr?: (value: string) => void;
}>;

type AuthCliDependencies = AuthDependencies &
  Readonly<{ stdout?: (value: string) => void }>;

/** Accepts exactly one persona while tolerating an optional argument separator. */
export function authPersonaArgument(
  arguments_: readonly string[],
): string | undefined {
  const positional = arguments_.filter((argument) => argument !== "--");
  return positional.length === 1 ? positional[0] : undefined;
}

/** Runs Device Flow while keeping its short-lived token out of diagnostics. */
export async function authorizePersona(
  persona: PersonaId,
  config: P2Config,
  dependencies: AuthDependencies = {},
): Promise<string> {
  const stderr =
    dependencies.stderr ?? ((value) => process.stderr.write(value));
  return (dependencies.authorize ?? authorizeDevice)({
    issuer: config.issuer,
    clientId: config.clientId,
    resource: config.apiResource,
    persona,
    onVerification: ({
      userCode,
      verificationUri,
      verificationUriComplete,
    }) => {
      stderr(`Open: ${verificationUriComplete ?? verificationUri}\n`);
      stderr(`User code: ${userCode}\n`);
      stderr(`Sign in as ${persona}; waiting for approval...\n`);
    },
  });
}

export async function runAuthCli(
  argument: string | undefined,
  config: P2Config,
  dependencies: AuthCliDependencies = {},
): Promise<void> {
  const persona = parsePersona(argument);
  const stdout =
    dependencies.stdout ?? ((value) => process.stdout.write(value));
  const token = await authorizePersona(persona, config, dependencies);
  stdout(`${token}\n`);
}
