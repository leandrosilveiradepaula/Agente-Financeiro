import { afterEach, describe, expect, it } from "vitest";
import {
  applyWhatsAppTriggerPrefix,
  evaluateWhatsAppSafety,
  getWhatsAppSafetyConfig,
  normalizePhoneCandidate
} from "../src/whatsapp-safety.js";

afterEach(() => {
  delete process.env.WHATSAPP_WEBJS_ENABLE_INBOUND;
  delete process.env.WHATSAPP_WEBJS_DRY_RUN;
  delete process.env.WHATSAPP_ALLOWED_NUMBERS;
  delete process.env.WHATSAPP_REQUIRE_TRIGGER;
  delete process.env.WHATSAPP_TRIGGER_PREFIX;
  delete process.env.WHATSAPP_IGNORE_GROUPS;
});

describe("WhatsApp WebJS safety", () => {
  it("blocks WebJS inbound by default", () => {
    expect(
      evaluateWhatsAppSafety({
        source: "webjs",
        from: "5551888888888",
        text: "AGENTE Pergunta"
      })
    ).toEqual({ allowed: false, reason: "inbound_disabled" });

    expect(getWhatsAppSafetyConfig()).toMatchObject({
      inboundEnabled: false,
      dryRun: true,
      requireTrigger: true,
      triggerPrefix: "AGENTE",
      allowedNumbersCount: 0,
      ignoreGroups: true
    });
  });

  it("requires allowlist and trigger prefix when inbound is enabled", () => {
    process.env.WHATSAPP_WEBJS_ENABLE_INBOUND = "true";
    process.env.WHATSAPP_ALLOWED_NUMBERS = "5551888888888";
    process.env.WHATSAPP_REQUIRE_TRIGGER = "true";
    process.env.WHATSAPP_TRIGGER_PREFIX = "AGENTE";

    expect(
      evaluateWhatsAppSafety({
        source: "webjs",
        from: "5551999999999",
        text: "AGENTE Pergunta"
      })
    ).toMatchObject({ allowed: false, reason: "not_allowed_number" });

    expect(
      evaluateWhatsAppSafety({
        source: "webjs",
        from: "5551888888888",
        text: "Pergunta"
      })
    ).toMatchObject({ allowed: false, reason: "missing_trigger_prefix" });

    expect(
      evaluateWhatsAppSafety({
        source: "webjs",
        from: "5551888888888",
        text: "AGENTE Pergunta"
      })
    ).toMatchObject({ allowed: true, sanitizedText: "Pergunta", matchedCandidate: "5551888888888" });
  });

  it("matches allowlist using message.from candidate", () => {
    process.env.WHATSAPP_WEBJS_ENABLE_INBOUND = "true";
    process.env.WHATSAPP_ALLOWED_NUMBERS = "+55 (51) 88888-8888";
    process.env.WHATSAPP_REQUIRE_TRIGGER = "true";

    expect(
      evaluateWhatsAppSafety({
        source: "webjs",
        from: "5551888888888@c.us",
        text: "AGENTE Pergunta"
      })
    ).toMatchObject({ allowed: true, matchedCandidate: "5551888888888" });
  });

  it("matches allowlist using contact.number candidate", () => {
    process.env.WHATSAPP_WEBJS_ENABLE_INBOUND = "true";
    process.env.WHATSAPP_ALLOWED_NUMBERS = "5551888888888";

    expect(
      evaluateWhatsAppSafety({
        source: "webjs",
        from: "7860123415@lid",
        senderCandidates: ["7860123415@lid", "5551888888888"],
        text: "AGENTE Pergunta"
      })
    ).toMatchObject({ allowed: true, matchedCandidate: "5551888888888" });
  });

  it("matches allowlist using contact id user candidate", () => {
    process.env.WHATSAPP_WEBJS_ENABLE_INBOUND = "true";
    process.env.WHATSAPP_ALLOWED_NUMBERS = "5551999999999";

    expect(
      evaluateWhatsAppSafety({
        source: "webjs",
        from: "7860123415@lid",
        senderCandidates: ["7860123415@lid", "5551999999999@s.whatsapp.net"],
        text: "AGENTE Pergunta"
      })
    ).toMatchObject({ allowed: true, matchedCandidate: "5551999999999" });
  });

  it("fails allowlist when no candidate matches", () => {
    process.env.WHATSAPP_WEBJS_ENABLE_INBOUND = "true";
    process.env.WHATSAPP_ALLOWED_NUMBERS = "5551888888888";

    expect(
      evaluateWhatsAppSafety({
        source: "webjs",
        from: "7860123415@lid",
        senderCandidates: ["7860123415@lid", "5551999999999"],
        text: "AGENTE Pergunta"
      })
    ).toMatchObject({
      allowed: false,
      reason: "not_allowed_number",
      normalizedCandidates: ["7860123415", "5551999999999"]
    });
  });

  it("ignores groups by default", () => {
    process.env.WHATSAPP_WEBJS_ENABLE_INBOUND = "true";
    process.env.WHATSAPP_ALLOWED_NUMBERS = "5551888888888";

    expect(
      evaluateWhatsAppSafety({
        source: "webjs",
        from: "5551888888888",
        text: "AGENTE Pergunta",
        isGroup: true
      })
    ).toEqual({ allowed: false, reason: "group_ignored" });
  });

  it("applies trigger prefix to demo text only once", () => {
    process.env.WHATSAPP_REQUIRE_TRIGGER = "true";
    process.env.WHATSAPP_TRIGGER_PREFIX = "AGENTE";

    expect(applyWhatsAppTriggerPrefix("Pergunta")).toBe("AGENTE Pergunta");
    expect(applyWhatsAppTriggerPrefix("AGENTE Pergunta")).toBe("AGENTE Pergunta");
  });

  it("normalizes WebJS phone candidates", () => {
    expect(normalizePhoneCandidate("5551888888888@c.us")).toBe("5551888888888");
    expect(normalizePhoneCandidate("5551888888888@s.whatsapp.net")).toBe("5551888888888");
    expect(normalizePhoneCandidate("7860123415@lid")).toBe("7860123415");
  });
});
