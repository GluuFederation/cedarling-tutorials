import type { FastifyInstance } from "fastify";

export async function listen(
  app: FastifyInstance,
  service: string,
  host: string,
  port: number,
  publicUrl?: string,
): Promise<void> {
  try {
    await app.listen({ host, port });
    console.info(
      publicUrl
        ? `${service} listening at ${publicUrl}`
        : `${service} listening on ${host}:${port}`,
    );
  } catch (error) {
    console.error(
      `${service} listener unavailable; check its configured loopback port.`,
    );
    throw error;
  }
}

export function shutdown(service: FastifyInstance, close?: () => void): void {
  const stop = async (signal: string) => {
    console.info(`Received ${signal}; stopping P10 CedarStock`);
    await service.close();
    close?.();
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}
