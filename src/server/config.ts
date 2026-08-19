import type { IncomingMessage } from "node:http";

export interface ServerConfig {
  host: string;
  port: number;
  herdrBinary: string;
  allowedOrigins: Set<string>;
}

export function loadConfig(environment = process.env): ServerConfig {
  const port = Number.parseInt(environment.HERDR_CONTROL_PORT ?? "4173", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("HERDR_CONTROL_PORT must be a valid TCP port");
  }

  return {
    host: environment.HERDR_CONTROL_BIND ?? "127.0.0.1",
    port,
    herdrBinary: environment.HERDR_CONTROL_BIN ?? "herdr",
    allowedOrigins: new Set(
      (environment.HERDR_CONTROL_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  };
}

export function isOriginAllowed(request: IncomingMessage, allowedOrigins: Set<string>): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}
