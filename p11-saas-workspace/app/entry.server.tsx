import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { renderToPipeableStream } from "react-dom/server";
import { requestServicesContext } from "./context.ts";

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
): Promise<Response> | Response {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }
  const nonce = loadContext.get(requestServicesContext).nonce;
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} nonce={nonce} url={request.url} />,
      {
        nonce,
        onShellReady() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              if (timeout) clearTimeout(timeout);
              callback();
            },
          });
          responseHeaders.set("Content-Type", "text/html; charset=utf-8");
          pipe(body);
          resolve(
            new Response(createReadableStreamFromReadable(body), {
              status: responseStatusCode,
              headers: responseHeaders,
            }),
          );
        },
        onShellError: reject,
        onError(error) {
          responseStatusCode = 500;
          if (shellRendered) console.error("P11 render failed", error);
        },
      },
    );
    timeout = setTimeout(abort, streamTimeout);
  });
}
