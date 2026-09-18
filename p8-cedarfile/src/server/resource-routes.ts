import express, { type Request } from "express";
import { z } from "zod";
import { capabilities, logCapabilitySeam } from "./capabilities.ts";
import { limits } from "./config.ts";
import type { Session } from "./models.ts";
import type { FileService } from "./service.ts";
import { contentDisposition, resourceIdPattern } from "./validation.ts";
import { type AuthBoundary, noStore } from "./auth-routes.ts";

const resourceIdSchema = z.string().regex(resourceIdPattern);
const folderSchema = z.object({
  parentId: resourceIdSchema,
  name: z.string().min(1).max(120),
});
const versionSchema = z.object({ version: z.number().int().positive() });
const shareSchema = versionSchema.extend({
  userId: z.enum(["user-jordan", "user-priya", "user-lee"]),
  role: z.enum(["viewer", "editor"]),
});
const moveSchema = versionSchema.extend({ destinationId: resourceIdSchema });
const uploadQuerySchema = z.object({
  parentId: resourceIdSchema,
  name: z.string().min(1).max(120),
});
const replaceQuerySchema = z.object({
  version: z.coerce.number().int().positive(),
});

type RequestWithId = Request & { requestId?: string };

function trace(
  request: RequestWithId,
  session: Session,
  capability: (typeof capabilities)[keyof typeof capabilities],
  resourceId: string,
  facts: Readonly<Record<string, string | number | boolean | null>>,
  effect: string,
): void {
  logCapabilitySeam({
    requestId: request.requestId ?? "unavailable",
    principalId: session.user.id,
    capability,
    resourceId,
    facts,
    effect,
  });
}

export function registerResourceRoutes(
  app: express.Express,
  auth: AuthBoundary,
  service: FileService,
): void {
  const { requireSession, requireMutation } = auth;
  app.get("/api/resources", async (request: RequestWithId, response) => {
    noStore(response);
    const session = await requireSession(request, response);
    if (!session) return;
    const parentId =
      typeof request.query.parentId === "string"
        ? request.query.parentId
        : undefined;
    const result = service.list(session.user, parentId);
    trace(
      request,
      session,
      capabilities.list,
      result.folder?.id ?? session.user.homeWorkspaceId,
      { resultCount: result.resources.length },
      "enumerate visible virtual resources",
    );
    response.json(result);
  });

  app.get("/api/resources/:id", async (request: RequestWithId, response) => {
    noStore(response);
    const session = await requireSession(request, response);
    if (!session) return;
    const result = service.details(
      session.user,
      resourceIdSchema.parse(request.params.id),
    );
    trace(
      request,
      session,
      capabilities.read,
      result.resource.id,
      {
        workspaceMatch:
          result.resource.workspaceId === session.user.homeWorkspaceId,
        effectiveAccess: result.resource.access,
        version: result.resource.version,
      },
      "return resource metadata",
    );
    response.json(result);
  });

  app.get(
    "/api/resources/:id/content",
    async (request: RequestWithId, response) => {
      noStore(response);
      const session = await requireSession(request, response);
      if (!session) return;
      const result = service.read(
        session.user,
        resourceIdSchema.parse(request.params.id),
        (resource) =>
          trace(
            request,
            session,
            capabilities.read,
            resource.id,
            {
              workspaceMatch:
                resource.workspaceId === session.user.homeWorkspaceId,
              effectiveAccess: resource.access,
              mediaType: resource.mediaType,
              byteSize: resource.size,
            },
            "stream authenticated file content",
          ),
      );
      response.setHeader(
        "Content-Type",
        result.resource.mediaType ?? "application/octet-stream",
      );
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader(
        "Content-Disposition",
        contentDisposition(
          result.resource.name,
          request.query.download === "1",
        ),
      );
      response.send(result.bytes);
    },
  );

  app.use("/api", express.json({ limit: "32kb", strict: true }));

  app.post("/api/folders", async (request: RequestWithId, response) => {
    const session = await requireSession(request, response);
    if (!session || !requireMutation(request, response, session)) return;
    const input = folderSchema.parse(request.body);
    response.status(201).json({
      resource: service.createFolder(
        session.user,
        input.parentId,
        input.name,
        (parent) =>
          trace(
            request,
            session,
            capabilities.create,
            parent.id,
            { kind: "folder", parentVersion: parent.version },
            "create folder metadata",
          ),
      ),
    });
  });

  app.post(
    "/api/files",
    express.raw({ type: "application/octet-stream", limit: limits.fileBytes }),
    async (request: RequestWithId, response) => {
      const session = await requireSession(request, response);
      if (!session || !requireMutation(request, response, session)) return;
      const query = uploadQuerySchema.parse(request.query);
      if (!Buffer.isBuffer(request.body)) {
        response.status(415).json({ error: "unsupported_content_type" });
        return;
      }
      const bytes = request.body;
      response.status(201).json({
        resource: await service.createFile(
          session.user,
          query.parentId,
          query.name,
          bytes,
          (parent) =>
            trace(
              request,
              session,
              capabilities.create,
              parent.id,
              {
                kind: "file",
                parentVersion: parent.version,
                byteSize: bytes.byteLength,
              },
              "store one validated opaque file",
            ),
        ),
      });
    },
  );

  app.put(
    "/api/resources/:id/content",
    express.raw({ type: "application/octet-stream", limit: limits.fileBytes }),
    async (request: RequestWithId, response) => {
      const session = await requireSession(request, response);
      if (!session || !requireMutation(request, response, session)) return;
      const query = replaceQuerySchema.parse(request.query);
      const resourceId = resourceIdSchema.parse(request.params.id);
      if (!Buffer.isBuffer(request.body)) {
        response.status(415).json({ error: "unsupported_content_type" });
        return;
      }
      const bytes = request.body;
      response.json({
        resource: await service.replace(
          session.user,
          resourceId,
          query.version,
          bytes,
          (current) =>
            trace(
              request,
              session,
              capabilities.write,
              current.id,
              {
                effectiveAccess: current.access,
                version: current.version,
                byteSize: bytes.byteLength,
              },
              "conditionally replace file content",
            ),
        ),
      });
    },
  );

  app.post(
    "/api/resources/:id/shares",
    async (request: RequestWithId, response) => {
      const session = await requireSession(request, response);
      if (!session || !requireMutation(request, response, session)) return;
      const input = shareSchema.parse(request.body);
      const resourceId = resourceIdSchema.parse(request.params.id);
      response.json({
        resource: service.share(
          session.user,
          resourceId,
          input.version,
          input.userId,
          input.role,
          (current) =>
            trace(
              request,
              session,
              capabilities.share,
              current.id,
              {
                effectiveAccess: current.access,
                version: current.version,
                role: input.role,
              },
              "upsert one current share",
            ),
        ),
      });
    },
  );

  app.delete(
    "/api/resources/:id/shares/:userId",
    async (request: RequestWithId, response) => {
      const session = await requireSession(request, response);
      if (!session || !requireMutation(request, response, session)) return;
      const input = versionSchema.parse(request.body);
      const resourceId = resourceIdSchema.parse(request.params.id);
      response.json({
        resource: service.revokeShare(
          session.user,
          resourceId,
          input.version,
          z.string().parse(request.params.userId),
          (current) =>
            trace(
              request,
              session,
              capabilities.share,
              current.id,
              { effectiveAccess: current.access, version: current.version },
              "revoke one current share",
            ),
        ),
      });
    },
  );

  app.post(
    "/api/resources/:id/move",
    async (request: RequestWithId, response) => {
      const session = await requireSession(request, response);
      if (!session || !requireMutation(request, response, session)) return;
      const input = moveSchema.parse(request.body);
      const resourceId = resourceIdSchema.parse(request.params.id);
      response.json({
        resource: service.move(
          session.user,
          resourceId,
          input.version,
          input.destinationId,
          (current) =>
            trace(
              request,
              session,
              capabilities.move,
              current.id,
              { version: current.version, destinationId: input.destinationId },
              "move virtual metadata",
            ),
        ),
      });
    },
  );

  app.delete("/api/resources/:id", async (request: RequestWithId, response) => {
    const session = await requireSession(request, response);
    if (!session || !requireMutation(request, response, session)) return;
    const input = versionSchema.parse(request.body);
    const resourceId = resourceIdSchema.parse(request.params.id);
    response.json(
      service.delete(session.user, resourceId, input.version, (current) =>
        trace(
          request,
          session,
          capabilities.delete,
          current.id,
          { effectiveAccess: current.access, version: current.version },
          "quarantine content and conditionally delete metadata",
        ),
      ),
    );
  });
}
