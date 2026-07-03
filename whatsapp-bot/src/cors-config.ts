import type { CorsOptions } from "cors";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://agente-financeiro-dusky.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001"
];

function parseAllowedOrigins() {
  const configured = process.env.CORS_ALLOWED_ORIGINS;
  const values = configured?.trim()
    ? configured.split(",").map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;

  return new Set(values);
}

function isLocalhostOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

export function getCorsAllowedOrigins() {
  return Array.from(parseAllowedOrigins());
}

export function createCorsOptions(): CorsOptions {
  return {
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const allowedOrigins = parseAllowedOrigins();
      const isAllowed = allowedOrigins.has(origin) || isLocalhostOrigin(origin);

      if (isAllowed) {
        callback(null, true);
        return;
      }

      callback(null, false);
    }
  };
}
