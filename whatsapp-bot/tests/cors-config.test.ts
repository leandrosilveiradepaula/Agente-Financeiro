import { afterEach, describe, expect, it } from "vitest";
import { createCorsOptions, getCorsAllowedOrigins } from "../src/cors-config.js";

function resolveOrigin(origin?: string) {
  const options = createCorsOptions();
  return new Promise<unknown>((resolve, reject) => {
    if (typeof options.origin !== "function") {
      reject(new Error("Origin callback is not configured."));
      return;
    }

    options.origin(origin, (error, allowed) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(allowed);
    });
  });
}

afterEach(() => {
  delete process.env.CORS_ALLOWED_ORIGINS;
});

describe("CORS config", () => {
  it("allows configured production origin and requests without origin", async () => {
    process.env.CORS_ALLOWED_ORIGINS =
      "https://agente-financeiro-dusky.vercel.app,http://localhost:3000";

    await expect(resolveOrigin("https://agente-financeiro-dusky.vercel.app")).resolves.toBe(true);
    await expect(resolveOrigin(undefined)).resolves.toBe(true);
    expect(getCorsAllowedOrigins()).toContain("https://agente-financeiro-dusky.vercel.app");
  });

  it("allows localhost origins and denies unknown origins", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://agente-financeiro-dusky.vercel.app";

    await expect(resolveOrigin("http://localhost:3000")).resolves.toBe(true);
    await expect(resolveOrigin("http://127.0.0.1:3001")).resolves.toBe(true);
    await expect(resolveOrigin("https://example.com")).resolves.toBe(false);
  });
});
