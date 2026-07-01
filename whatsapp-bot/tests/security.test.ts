import { createHmac } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import { isAllowedNumber, normalizePhoneNumber, validateMetaSignature } from "../src/security.js";
import type { RawBodyRequest } from "../src/security.js";

afterEach(() => {
  delete process.env.ALLOWED_WHATSAPP_NUMBERS;
  delete process.env.WHATSAPP_APP_SECRET;
});

describe("security", () => {
  it("normalizes and authorizes phone numbers when allow list is configured", () => {
    process.env.ALLOWED_WHATSAPP_NUMBERS = "+55 (11) 99999-9999";

    expect(normalizePhoneNumber("+55 (11) 99999-9999")).toBe("5511999999999");
    expect(isAllowedNumber("5511999999999")).toBe(true);
    expect(isAllowedNumber("5511888888888")).toBe(false);
  });

  it("validates Meta signature when app secret is configured", () => {
    process.env.WHATSAPP_APP_SECRET = "secret";
    const rawBody = Buffer.from(JSON.stringify({ ok: true }));
    const signature = createHmac("sha256", "secret").update(rawBody).digest("hex");
    const req = {
      rawBody,
      header: (name: string) => (name === "x-hub-signature-256" ? `sha256=${signature}` : undefined)
    } as RawBodyRequest;

    expect(validateMetaSignature(req)).toBe(true);
  });
});
