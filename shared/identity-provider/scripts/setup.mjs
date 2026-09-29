/** Generate one project's private IdP registration, preserving its credentials. */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { projectSettings, workloads } from "../src/projects.ts";
import {
  readProjectEnvironment,
  mergeProjectEnvironment,
  writePrivateEnvironment,
} from "./project-environment.mjs";

export function ensureProjectIdentity(
  selector,
  target = resolve(".local/idp/.env"),
) {
  const project = projectSettings(selector);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const current = readProjectEnvironment(target);
  if (
    current.environment.IDP_PROJECT &&
    current.environment.IDP_PROJECT !== selector
  )
    throw new Error("IdP configuration belongs to another project");
  const issuer = new URL(current.environment.IDP_ISSUER ?? project.issuer);
  const defaults = {
    IDP_PROJECT: project.prefix,
    IDP_ISSUER: project.issuer,
    IDP_HOST: "127.0.0.1",
    IDP_PORT: issuer.port || (issuer.protocol === "https:" ? "443" : "80"),
  };
  const resource = project.number === 3 ? "MCP" : "API";
  defaults[`${project.prefix}_${resource}_RESOURCE`] =
    `${project.origin}/${resource.toLowerCase()}`;
  const clients =
    project.number === 10
      ? workloads
      : [
          {
            prefix: project.prefix,
            id: project.id + (project.device ? "-cli" : ""),
          },
        ];
  for (const client of clients) {
    defaults[`${client.prefix}_CLIENT_ID`] = client.id;
    if (!project.device)
      defaults[`${client.prefix}_CLIENT_SECRET`] =
        randomBytes(32).toString("base64url");
  }
  if (!project.device && project.number !== 10) {
    defaults[`${project.prefix}_REDIRECT_URI`] =
      `${project.origin}/auth/callback`;
    defaults[`${project.prefix}_POST_LOGOUT_REDIRECT_URI`] = project.origin;
  }
  const merged = mergeProjectEnvironment(current.text, {
    managed: {},
    defaults,
  });
  writePrivateEnvironment(target, merged.text);
  return merged.environment;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  ensureProjectIdentity(
    process.argv[2],
    process.argv[3] ? resolve(process.argv[3]) : undefined,
  );
  console.info(
    `${process.argv[2]} identity configuration ready; existing credentials preserved.`,
  );
}
