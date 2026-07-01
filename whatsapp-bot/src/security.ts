import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export function normalizePhoneNumber(phoneNumber: string) {
  return phoneNumber.replace(/\D/g, "");
}

export function maskPhoneNumber(phoneNumber: string) {
  const normalized = normalizePhoneNumber(phoneNumber);
  if (normalized.length <= 4) {
    return "****";
  }

  return `${normalized.slice(0, 4)}****${normalized.slice(-2)}`;
}

function allowedNumbers() {
  return (process.env.ALLOWED_WHATSAPP_NUMBERS || "")
    .split(",")
    .map((item) => normalizePhoneNumber(item))
    .filter(Boolean);
}

export function isAllowedNumber(phoneNumber: string) {
  const allowed = allowedNumbers();
  if (!allowed.length) {
    return true;
  }

  return allowed.includes(normalizePhoneNumber(phoneNumber));
}

export function isAuthorizationListActive() {
  return allowedNumbers().length > 0;
}

export type RawBodyRequest = Request & { rawBody?: Buffer };

export function validateMetaSignature(req: RawBodyRequest) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    return true;
  }

  const signature = req.header("x-hub-signature-256");
  if (!signature?.startsWith("sha256=") || !req.rawBody) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(req.rawBody).digest("hex");
  const actual = signature.slice("sha256=".length);

  try {
    return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
