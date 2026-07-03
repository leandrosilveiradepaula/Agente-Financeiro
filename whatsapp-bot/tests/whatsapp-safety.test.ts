import { afterEach, describe, expect, it } from "vitest";
import {
  applyWhatsAppTriggerPrefix,
  evaluateWhatsAppSafety,
  getWhatsAppSafetyConfig
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
    ).toEqual({ allowed: false, reason: "not_allowed_number" });

    expect(
      evaluateWhatsAppSafety({
        source: "webjs",
        from: "5551888888888",
        text: "Pergunta"
      })
    ).toEqual({ allowed: false, reason: "missing_trigger_prefix" });

    expect(
      evaluateWhatsAppSafety({
        source: "webjs",
        from: "5551888888888",
        text: "AGENTE Pergunta"
      })
    ).toEqual({ allowed: true, sanitizedText: "Pergunta" });
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
});
