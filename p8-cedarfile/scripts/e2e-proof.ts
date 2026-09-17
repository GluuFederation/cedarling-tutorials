import assert from "node:assert/strict";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/server/config.ts";
import { AppDatabase, databasePath } from "../src/server/database.ts";
import type { OidcTokens } from "../src/server/oidc.ts";
import { SafeStorage } from "../src/server/storage.ts";

type Credentials = Readonly<{ cookie: string; csrf: string }>;
type ResourceSummary = Readonly<{ id: string; name: string; version: number }>;
type ResourceResponse = Readonly<{ resource: ResourceSummary }>;

const phase = process.argv[2];
if (phase !== "--exercise" && phase !== "--after-restart") {
  throw new Error("The permissive runner must execute inside the P8 container");
}

const config = loadConfig();
assert.equal(
  config.dataRoot,
  "/data",
  "scenario must use the isolated /data mount",
);
const storage = new SafeStorage(config.dataRoot);
const database = new AppDatabase(
  databasePath(config.dataRoot),
  config.issuer,
  storage,
);
const origin = `http://127.0.0.1:${config.port}`;
const tokens: OidcTokens = {
  issuer: config.issuer,
  subject: "p8-permissive-scenario",
  accessToken: "scenario-access-token",
  accessTokenExpiresAt: Date.now() + 600_000,
  refreshToken: "scenario-refresh-token",
  refreshTokenExpiresAt: Date.now() + 600_000,
  idToken: "scenario-id-token",
  idTokenExpiresAt: Date.now() + 600_000,
  tokenType: "Bearer",
  scope: "file.access",
};

function session(userId: string): Credentials {
  const created = database.sessions.createSession(userId, tokens, config);
  return {
    cookie: `p8_session=${created.rawId}`,
    csrf: created.csrfToken,
  };
}

async function request(
  target: string,
  credentials: Credentials,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${origin}${target}`, {
    ...init,
    headers: {
      Cookie: credentials.cookie,
      Origin: config.baseUrl,
      "Sec-Fetch-Site": "same-origin",
      "X-CSRF-Token": credentials.csrf,
      ...init.headers,
    },
  });
}

async function resource(
  response: Response,
  status: number,
  message: string,
): Promise<ResourceSummary> {
  assert.equal(response.status, status, message);
  return ((await response.json()) as ResourceResponse).resource;
}

async function exercise(): Promise<void> {
  const jordan = session("user-jordan");
  const upload = await request(
    "/api/files?parentId=res_01K3ROOTAAAA&name=scenario-proof.txt",
    jordan,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: "Permissive upload.\n",
    },
  );
  const uploaded = await resource(upload, 201, "container upload must succeed");
  const objectPath = path.join(config.dataRoot, "objects", uploaded.id);
  const stored = lstatSync(objectPath);
  assert.ok(stored.isFile() && !stored.isSymbolicLink());

  const preview = await request(
    `/api/resources/${uploaded.id}/content`,
    jordan,
  );
  assert.equal(preview.status, 200, "inline preview must succeed");
  assert.match(preview.headers.get("content-disposition") ?? "", /^inline/);
  assert.match(preview.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(await preview.text(), "Permissive upload.\n");

  const replacement = await request(
    `/api/resources/${uploaded.id}/content?version=${uploaded.version}`,
    jordan,
    {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: "Persisted replacement.\n",
    },
  );
  const replaced = await resource(
    replacement,
    200,
    "container replacement must succeed",
  );
  assert.equal(replaced.version, uploaded.version + 1);

  const replacedPreview = await request(
    `/api/resources/${uploaded.id}/content`,
    jordan,
  );
  assert.equal(replacedPreview.status, 200);
  assert.equal(await replacedPreview.text(), "Persisted replacement.\n");

  const priya = session("user-priya");
  const notes = await resource(
    await request("/api/resources/res_01K3NOTESAAA", priya),
    200,
    "Priya must see the shared descendant",
  );
  const reshare = await resource(
    await request(`/api/resources/${notes.id}/shares`, priya, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: notes.version,
        userId: "user-lee",
        role: "editor",
      }),
    }),
    200,
    "editor reshare gap remains reachable",
  );
  const revoke = await request(
    `/api/resources/${notes.id}/shares/user-lee`,
    priya,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: reshare.version }),
    },
  );
  assert.equal(revoke.status, 200, "scenario share cleanup must succeed");
  const currentNotes = await resource(
    await request(`/api/resources/${notes.id}`, priya),
    200,
    "reshared descendant must remain addressable",
  );
  const deletedDescendant = await request(`/api/resources/${notes.id}`, priya, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: currentNotes.version }),
  });
  assert.equal(
    deletedDescendant.status,
    200,
    "editor descendant-delete gap remains reachable",
  );

  const lee = session("user-lee");
  const viewerFile = await resource(
    await request("/api/resources/res_01K3VIEWAAAA", lee),
    200,
    "Lee must see the viewer-shared file",
  );
  const viewerWrite = await resource(
    await request(
      `/api/resources/${viewerFile.id}/content?version=${viewerFile.version}`,
      lee,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: "Viewer write gap remains reachable.\n",
      },
    ),
    200,
    "viewer write gap remains reachable",
  );
  assert.equal(viewerWrite.version, viewerFile.version + 1);
  const sibling = await request("/api/resources/res_01K3PRIVATEA/content", lee);
  assert.equal(sibling.status, 200, "unshared sibling gap remains reachable");
  assert.match(await sibling.text(), /private/i);

  const otherWorkspace = await request(
    "/api/resources/res_01K3PRIVATEB/content",
    jordan,
  );
  assert.equal(
    otherWorkspace.status,
    200,
    "cross-workspace ID gap remains reachable",
  );

  const invalidName = await request("/api/folders", jordan, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentId: "res_01K3ROOTAAAA", name: "../escape" }),
  });
  assert.equal(invalidName.status, 400, "path traversal remains blocked");

  console.log(
    "P8 container exercise passed: upload, preview, replace, and three gaps",
  );
}

async function afterRestart(): Promise<void> {
  const jordan = session("user-jordan");
  const listing = await request("/api/resources", jordan);
  assert.equal(listing.status, 200);
  const body = (await listing.json()) as { resources: ResourceSummary[] };
  const persisted = body.resources.find(
    (item) => item.name === "scenario-proof.txt",
  );
  assert.ok(persisted, "uploaded metadata must persist across restart");

  const preview = await request(
    `/api/resources/${persisted.id}/content`,
    jordan,
  );
  assert.equal(
    preview.status,
    200,
    "replaced bytes must persist across restart",
  );
  assert.equal(await preview.text(), "Persisted replacement.\n");

  const deleted = await request(`/api/resources/${persisted.id}`, jordan, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: persisted.version }),
  });
  assert.equal(deleted.status, 200, "container delete must succeed");
  assert.equal(
    (
      (await deleted.json()) as {
        deleted: boolean;
        count: number;
      }
    ).deleted,
    true,
  );
  assert.equal(
    existsSync(path.join(config.dataRoot, "objects", persisted.id)),
    false,
    "deleted opaque bytes must leave the isolated data mount",
  );
  const missing = await request(
    `/api/resources/${persisted.id}/content`,
    jordan,
  );
  assert.equal(missing.status, 404);

  console.log("P8 restart exercise passed: persisted read and delete");
}

try {
  if (phase === "--exercise") await exercise();
  else await afterRestart();
} finally {
  database.close();
}
